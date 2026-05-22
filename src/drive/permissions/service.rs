use crate::drive::{permissions::{
    dto::{
        GrantPermissionRequest, ListPermissionsResponse, PermissionResponse, Role,
        TransferOwnershipRequest, UpdatePermissionRequest,
    },
    model::NewPermissionRecord,
    repository::PermissionsRepository,
}};
use crate::shared::{ApiError, AuthenticatedUser, fetch_auth_profile};
use crate::drive::encryption::repository::EncryptionRepository;
use crate::drive::workspace::service::WorkspaceService;
use std::sync::Arc;
use uuid::Uuid;

pub struct PermissionsService {
    repo: Arc<PermissionsRepository>,
    workspace: Arc<WorkspaceService>,
    encryption: Arc<EncryptionRepository>,
}

impl PermissionsService {
    pub fn new(
        repo: Arc<PermissionsRepository>,
        workspace: Arc<WorkspaceService>,
        encryption: Arc<EncryptionRepository>,
    ) -> Self {
        PermissionsService { repo, workspace, encryption }
    }

    /// Auto-grants Owner role when a resource is created. Called internally by
    /// FilesystemService and StorageService.
    pub async fn grant_ownership(
        &self,
        user: &AuthenticatedUser,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        let profile = fetch_auth_profile(&user).await?;
        let user_email = profile.email.as_ref();
        let user_name = profile.name.as_ref();

        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &user.user_id,
            role: "owner",
            granted_by: &user.user_id,
            user_email,
            user_name,
        };
        self.repo.upsert_permission(&record)?;
        Ok(())
    }

    pub fn list_permissions(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<ListPermissionsResponse, ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can view permissions",
            ));
        }
        let records = self.repo.list_permissions(resource_type, resource_id)?;
        Ok(ListPermissionsResponse {
            permissions: records.into_iter().map(PermissionResponse::from).collect(),
        })
    }

    pub fn grant_permission(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        req: GrantPermissionRequest,
    ) -> Result<PermissionResponse, ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can grant permissions",
            ));
        }
        if req.role == Role::Owner {
            return Err(ApiError::bad_request(
                "Cannot grant Owner role directly. Use transfer-ownership instead.",
            ));
        }
        // Check workspace domain restriction before granting
        self.workspace.check_domain_for_sharing(&req.user_email)?;
        tracing::info!(
            "Sharing notification: granting {} role on {} {} to {} ({})",
            req.role.as_str(), resource_type, resource_id, req.user_email, req.user_id
        );
        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &req.user_id,
            role: req.role.as_str(),
            granted_by: caller_id,
            user_email: &req.user_email,
            user_name: &req.user_name,
        };
        let perm = self.repo.upsert_permission(&record)?;
        Ok(PermissionResponse::from(perm))
    }

    pub fn update_permission(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        target_user_id: &str,
        req: UpdatePermissionRequest,
    ) -> Result<PermissionResponse, ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can update permissions",
            ));
        }
        if req.role == Role::Owner {
            return Err(ApiError::bad_request(
                "Cannot set Owner role directly. Use transfer-ownership instead.",
            ));
        }
        let existing = self
            .repo
            .find_permission(resource_type, resource_id, target_user_id)?
            .ok_or_else(|| ApiError::not_found("Permission not found"))?;

        if existing.role == "owner" {
            let owner_count = self.repo.count_owners(resource_type, resource_id)?;
            if owner_count <= 1 {
                return Err(ApiError::bad_request(
                    "Cannot change the role of the last owner",
                ));
            }
        }
        self.repo.update_permission_role(
            resource_type,
            resource_id,
            target_user_id,
            req.role.as_str(),
        )?;
        let updated = self
            .repo
            .find_permission(resource_type, resource_id, target_user_id)?
            .ok_or_else(|| ApiError::internal("Permission not found after update"))?;
        Ok(PermissionResponse::from(updated))
    }

    pub fn revoke_permission(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        target_user_id: &str,
    ) -> Result<(), ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can revoke permissions",
            ));
        }
        let existing = self
            .repo
            .find_permission(resource_type, resource_id, target_user_id)?
            .ok_or_else(|| ApiError::not_found("Permission not found"))?;

        if existing.role == "owner" {
            let owner_count = self.repo.count_owners(resource_type, resource_id)?;
            if owner_count <= 1 {
                return Err(ApiError::bad_request(
                    "Cannot revoke the last owner's access",
                ));
            }
        }
        let deleted = self
            .repo
            .delete_permission(resource_type, resource_id, target_user_id)?;
        if deleted == 0 {
            return Err(ApiError::not_found("Permission not found"));
        }
        if resource_type == "file" {
            if let Err(e) = self.encryption.delete_file_key(resource_id, target_user_id) {
                tracing::warn!("Failed to delete file_key_ref on revocation: {:?}", e);
            }
        }
        Ok(())
    }

    pub fn transfer_ownership(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        req: TransferOwnershipRequest,
    ) -> Result<(), ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can transfer ownership",
            ));
        }
        if req.new_owner_id == caller_id {
            return Err(ApiError::bad_request("You are already the owner"));
        }
        // Downgrade caller to editor
        self.repo
            .update_permission_role(resource_type, resource_id, caller_id, "editor")?;
        // Grant new owner (upsert so it works whether or not they had a prior permission)
        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &req.new_owner_id,
            role: "owner",
            granted_by: caller_id,
            user_email: "",
            user_name: "",
        };
        self.repo.upsert_permission(&record)?;
        Ok(())
    }

    /// Grants a guest (share-link) user access to a resource without auth checks.
    pub fn grant_guest_access(
        &self,
        resource_type: &str,
        resource_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), ApiError> {
        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id,
            role,
            granted_by: "system",
            user_email: "",
            user_name: "Guest",
        };
        self.repo.upsert_permission(&record)?;
        Ok(())
    }

    /// Returns the effective role for a user on a resource, considering folder inheritance.
    /// Returns None if the user has no access at all.
    pub fn get_effective_role(
        &self,
        user_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<String>, ApiError> {
        if let Some(perm) = self.repo.find_permission(resource_type, resource_id, user_id)? {
            return Ok(Some(perm.role));
        }
        match resource_type {
            "file" => {
                if let Some(folder_id) = self.repo.get_file_folder_id(resource_id)? {
                    return self.get_effective_role_in_folder(user_id, &folder_id);
                }
            }
            "folder" => {
                if let Some(parent_id) = self.repo.get_folder_parent_id(resource_id)? {
                    return self.get_effective_role_in_folder(user_id, &parent_id);
                }
            }
            _ => {}
        }
        Ok(None)
    }

    fn get_effective_role_in_folder(
        &self,
        user_id: &str,
        folder_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let mut current_id = folder_id.to_string();
        // Walk up at most 50 levels to prevent infinite loops on corrupt data
        for _ in 0..50 {
            if let Some(perm) = self.repo.find_permission("folder", &current_id, user_id)? {
                return Ok(Some(perm.role));
            }
            match self.repo.get_folder_parent_id(&current_id)? {
                Some(parent_id) => current_id = parent_id,
                None => break,
            }
        }
        Ok(None)
    }
}
