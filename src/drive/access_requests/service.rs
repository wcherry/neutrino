use crate::drive::access_requests::{
    dto::{
        AccessRequestResponse, ApproveAccessRequestRequest, CreateAccessRequestRequest,
        ListAccessRequestsResponse,
    },
    model::NewAccessRequestRecord,
    repository::AccessRequestsRepository,
};
use crate::drive::permissions::{
    dto::{GrantPermissionRequest, Role},
    repository::PermissionsRepository,
    service::PermissionsService,
};
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct AccessRequestsService {
    repo: Arc<AccessRequestsRepository>,
    permissions_repo: Arc<PermissionsRepository>,
    permissions_service: Arc<PermissionsService>,
}

impl AccessRequestsService {
    pub fn new(
        repo: Arc<AccessRequestsRepository>,
        permissions_repo: Arc<PermissionsRepository>,
        permissions_service: Arc<PermissionsService>,
    ) -> Self {
        AccessRequestsService {
            repo,
            permissions_repo,
            permissions_service,
        }
    }

    /// Submit an access request for a resource. The requester must not already have access.
    pub fn create_request(
        &self,
        requester_id: &str,
        requester_email: &str,
        resource_type: &str,
        resource_id: &str,
        req: CreateAccessRequestRequest,
    ) -> Result<AccessRequestResponse, ApiError> {
        // Check if user already has access
        let existing_role = self.permissions_service.get_effective_role(
            requester_id,
            resource_type,
            resource_id,
        )?;
        if existing_role.is_some() {
            return Err(ApiError::bad_request(
                "You already have access to this resource",
            ));
        }

        // Check for existing pending request
        if self
            .repo
            .find_pending(resource_type, resource_id, requester_id)?
            .is_some()
        {
            return Err(ApiError::bad_request(
                "An access request is already pending for this resource",
            ));
        }

        let id = Uuid::new_v4().to_string();
        let record = NewAccessRequestRecord {
            id: &id,
            resource_type,
            resource_id,
            requester_id,
            requester_email,
            requester_name: &req.requester_name,
            message: req.message.as_deref(),
            requested_role: &req.requested_role,
            status: "pending",
        };
        let result = self.repo.create(&record)?;
        tracing::info!(
            "Access request notification: {} ({}) requested {} access to {} {}",
            req.requester_name,
            requester_email,
            req.requested_role,
            resource_type,
            resource_id
        );
        Ok(AccessRequestResponse::from(result))
    }

    /// List pending access requests for resources that the caller owns.
    pub fn list_pending_for_owner(
        &self,
        owner_id: &str,
    ) -> Result<ListAccessRequestsResponse, ApiError> {
        // Get all file and folder IDs the owner has 'owner' role on
        let file_ids = self
            .permissions_repo
            .list_owned_resource_ids(owner_id, "file")?;
        let folder_ids = self
            .permissions_repo
            .list_owned_resource_ids(owner_id, "folder")?;

        let mut requests = Vec::new();
        if !file_ids.is_empty() {
            let file_reqs = self
                .repo
                .list_pending_for_user_resources(&file_ids, "file")?;
            requests.extend(file_reqs.into_iter().map(AccessRequestResponse::from));
        }
        if !folder_ids.is_empty() {
            let folder_reqs = self
                .repo
                .list_pending_for_user_resources(&folder_ids, "folder")?;
            requests.extend(folder_reqs.into_iter().map(AccessRequestResponse::from));
        }

        Ok(ListAccessRequestsResponse { requests })
    }

    /// Approve a pending access request, granting the requester the appropriate role.
    pub fn approve_request(
        &self,
        caller_id: &str,
        request_id: &str,
        req: ApproveAccessRequestRequest,
    ) -> Result<AccessRequestResponse, ApiError> {
        let access_req = self
            .repo
            .find_by_id(request_id)?
            .ok_or_else(|| ApiError::not_found("Access request not found"))?;

        if access_req.status != "pending" {
            return Err(ApiError::bad_request(
                "This request has already been resolved",
            ));
        }

        // Check that caller owns the resource
        let caller_role = self.permissions_service.get_effective_role(
            caller_id,
            &access_req.resource_type,
            &access_req.resource_id,
        )?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can approve access requests",
            ));
        }

        let role_str = req.role.as_deref().unwrap_or(&access_req.requested_role);
        let grant_role = match role_str {
            "editor" => Role::Editor,
            "commenter" => Role::Commenter,
            _ => Role::Viewer,
        };

        self.permissions_service.grant_permission(
            caller_id,
            &access_req.resource_type,
            &access_req.resource_id,
            GrantPermissionRequest {
                user_id: access_req.requester_id.clone(),
                user_email: req.requester_email,
                user_name: req.requester_name,
                role: grant_role,
            },
        )?;

        self.repo.update_status(request_id, "approved")?;
        tracing::info!(
            "Access request approved: {} ({}) approved for {} {} with role {}",
            access_req.requester_name,
            access_req.requester_email,
            access_req.resource_type,
            access_req.resource_id,
            role_str
        );

        let updated = self
            .repo
            .find_by_id(request_id)?
            .ok_or_else(|| ApiError::internal("Request not found after update"))?;
        Ok(AccessRequestResponse::from(updated))
    }

    /// Deny a pending access request.
    pub fn deny_request(
        &self,
        caller_id: &str,
        request_id: &str,
    ) -> Result<AccessRequestResponse, ApiError> {
        let access_req = self
            .repo
            .find_by_id(request_id)?
            .ok_or_else(|| ApiError::not_found("Access request not found"))?;

        if access_req.status != "pending" {
            return Err(ApiError::bad_request(
                "This request has already been resolved",
            ));
        }

        let caller_role = self.permissions_service.get_effective_role(
            caller_id,
            &access_req.resource_type,
            &access_req.resource_id,
        )?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can deny access requests",
            ));
        }

        self.repo.update_status(request_id, "denied")?;
        tracing::info!(
            "Access request denied: {} for {} {}",
            access_req.requester_email,
            access_req.resource_type,
            access_req.resource_id
        );

        let updated = self
            .repo
            .find_by_id(request_id)?
            .ok_or_else(|| ApiError::internal("Request not found after update"))?;
        Ok(AccessRequestResponse::from(updated))
    }
}
