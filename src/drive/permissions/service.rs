use crate::auth::service::AuthService;
use crate::drive::encryption::repository::EncryptionRepository;
use crate::drive::permissions::{
    dto::{
        GrantPermissionRequest, ListPermissionsResponse, PermissionResponse, Role,
        TransferOwnershipRequest, UpdatePermissionRequest,
    },
    model::NewPermissionRecord,
    repository::PermissionsRepository,
};
use crate::drive::workspace::service::WorkspaceService;
use crate::shared::{fetch_auth_profile, ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct PermissionsService {
    repo: Arc<PermissionsRepository>,
    workspace: Arc<WorkspaceService>,
    encryption: Arc<EncryptionRepository>,
    auth_service: Arc<AuthService>,
}

impl PermissionsService {
    pub fn new(
        repo: Arc<PermissionsRepository>,
        workspace: Arc<WorkspaceService>,
        encryption: Arc<EncryptionRepository>,
        auth_service: Arc<AuthService>,
    ) -> Self {
        PermissionsService {
            repo,
            workspace,
            encryption,
            auth_service,
        }
    }

    /// Auto-grants Owner role when a resource is created. Called internally by
    /// FilesystemService and StorageService.
    pub async fn grant_ownership(
        &self,
        user: &AuthenticatedUser,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        // Profile lookup is best-effort — email/name are display metadata only.
        // A failure here must not block ownership from being recorded.
        let (email, name) = match fetch_auth_profile(user, &self.auth_service) {
            Ok(profile) => (profile.email, profile.name),
            Err(e) => {
                tracing::warn!(
                    "Could not fetch profile for user {} during grant_ownership: {:?}",
                    user.user_id,
                    e
                );
                (String::new(), String::new())
            }
        };

        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &user.user_id,
            role: "owner",
            granted_by: &user.user_id,
            user_email: &email,
            user_name: &name,
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
        if req.user_id == caller_id {
            return Err(ApiError::bad_request(
                "Cannot change your own permission role.",
            ));
        }
        // Check workspace domain restriction before granting
        self.workspace.check_domain_for_sharing(&req.user_email)?;
        tracing::info!(
            "Sharing notification: granting {} role on {} {} to {} ({})",
            req.role.as_str(),
            resource_type,
            resource_id,
            req.user_email,
            req.user_id
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
        // A team-owned file or folder is governed by the team, and nothing else (issue #185).
        //
        // Checked *first*, ahead of the explicit grants, because otherwise the grants outlive the
        // move. Every upload writes its uploader an `owner` permission row, so a file claimed into
        // a team would leave the person who happened to press upload as its Drive owner —
        // able to reshare a team's file outside the team, and holding an authority over it that
        // even the team's own Owner does not have. Any share made before the file joined the team
        // is stale for the same reason, and this makes it inert rather than honoured.
        //
        // The consequence, and it is intended: nobody is `owner` of a team file, so the individual
        // sharing endpoints refuse to operate on one. Sharing out of a team is not something this
        // phase does, and refusing is a better answer than a share that outlives the team's
        // membership.
        if let Some(team_role) = self.team_role_for_resource(user_id, resource_type, resource_id)? {
            return Ok(team_role);
        }

        if let Some(perm) = self
            .repo
            .find_permission(resource_type, resource_id, user_id)?
        {
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

    /// The caller's role over a resource, *if* it belongs to a team.
    ///
    /// The two levels of `Option` carry two different facts, and collapsing them is the bug this
    /// shape exists to prevent:
    ///
    /// - `None` — not a team resource. Carry on to the grants and folder inheritance.
    /// - `Some(None)` — a team resource the caller is not a member of. **Stop.** No access, and
    ///   emphatically not a fall-through to the grants, where a stale personal share would let
    ///   them straight back in.
    /// - `Some(Some(role))` — a team resource and the caller's role in it.
    fn team_role_for_resource(
        &self,
        user_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<Option<String>>, ApiError> {
        let team_id = match resource_type {
            "file" => self.repo.get_file_team_id(resource_id)?,
            "folder" => self.repo.get_folder_team_id(resource_id)?,
            _ => None,
        };
        let Some(team_id) = team_id else {
            return Ok(None);
        };
        Ok(Some(self.role_from_team_membership(user_id, &team_id)?))
    }

    /// The Drive role a team member holds over the team's files and folders (issue #185).
    ///
    /// A team's library lives in the same `files` and `folders` tables as everything else, so
    /// letting membership answer here is what makes download, preview, thumbnails, file info and
    /// every other read that already asks this question work for a team's members — without any of
    /// them learning that teams exist.
    ///
    /// Checked *before* folder inheritance, and it short-circuits: a file in a team is governed by
    /// the team, and walking up to a personal folder's grants from inside a team's tree would let
    /// a share made before the file joined the team outlive the move.
    ///
    /// The six team roles collapse to the three Drive roles because that is all this vocabulary
    /// has. The mapping is deliberately conservative — `owner` is not granted to anyone, not even
    /// a team Owner, because a Drive "owner" may reshare a file and change its permissions, and
    /// authority over a team is not authority to hand its files to people outside it. Destructive
    /// team actions are checked against the real six-role matrix in `teams::service`, which is
    /// where deleting a team file is authorised; this only decides who may read and write one.
    fn role_from_team_membership(
        &self,
        user_id: &str,
        team_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let Some(team_role) = self.repo.find_team_role(team_id, user_id)? else {
            return Ok(None);
        };
        Ok(match team_role.as_str() {
            "owner" | "admin" | "editor" | "contributor" => Some("editor".to_string()),
            "viewer" | "guest" => Some("viewer".to_string()),
            // A role nothing recognises grants nothing — the same rule `teams::roles::Role::parse`
            // applies, for the same reason.
            _ => None,
        })
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
