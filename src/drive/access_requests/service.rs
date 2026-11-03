use crate::drive::access_requests::{
    dto::{
        AccessRequestResponse, ApproveAccessRequestRequest, CreateAccessRequestRequest,
        ListAccessRequestsResponse,
    },
    model::{AccessRequestRecord, NewAccessRequestRecord},
    repository::AccessRequestsRepository,
};
use crate::drive::permissions::{
    dto::{GrantPermissionRequest, Role},
    repository::PermissionsRepository,
    service::PermissionsService,
};
use crate::drive::filesystem::repository::FilesystemRepository;
use crate::drive::storage::repository::StorageRepository;
use crate::drive::teams::key_requests::Notice;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct AccessRequestsService {
    repo: Arc<AccessRequestsRepository>,
    permissions_repo: Arc<PermissionsRepository>,
    permissions_service: Arc<PermissionsService>,
    /// Where notices find the file or folder's name. `None` leaves it out,
    /// and the email looks a file's name up by id instead.
    names: Option<(Arc<StorageRepository>, Arc<FilesystemRepository>)>,
}

/// Who an access request notice goes to and what it carries.
fn notice(
    recipients: Vec<String>,
    event_type: &'static str,
    req: &AccessRequestRecord,
    role: &str,
    (name, mime): (Option<String>, Option<String>),
    actor_id: Option<&str>,
) -> Notice {
    let mut payload = serde_json::json!({
        "requestId": req.id,
        "resourceType": req.resource_type,
        "resourceId": req.resource_id,
        "role": role,
        "requesterName": req.requester_name,
        "requesterEmail": req.requester_email,
    });
    if req.resource_type == "file" {
        payload["fileId"] = req.resource_id.clone().into();
    }
    if let Some(name) = name {
        payload["resourceName"] = name.into();
    }
    if let Some(mime) = mime {
        payload["mimeType"] = mime.into();
    }
    if let Some(message) = req.message.as_deref().filter(|m| !m.trim().is_empty()) {
        payload["message"] = message.into();
    }
    match actor_id {
        // The owner who decided; the email looks their name up.
        Some(id) => payload["sharedById"] = id.into(),
        // The requester asked; they are the actor.
        None => payload["actorName"] = req.requester_name.clone().into(),
    }
    Notice {
        recipients,
        event_type,
        payload,
    }
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
            names: None,
        }
    }

    /// Name the file or folder in the notices this service returns.
    pub fn with_resource_names(
        mut self,
        storage: Arc<StorageRepository>,
        folders: Arc<FilesystemRepository>,
    ) -> Self {
        self.names = Some((storage, folders));
        self
    }

    /// The resource's name and, for a file, its MIME type. Best effort: a
    /// notice without a name still goes out.
    fn describe(&self, resource_type: &str, resource_id: &str) -> (Option<String>, Option<String>) {
        let Some((storage, folders)) = &self.names else {
            return (None, None);
        };
        if resource_type == "folder" {
            let name = folders.find_folder_by_id(resource_id).ok().flatten().map(|f| f.name);
            return (name, None);
        }
        match storage.find_file_by_id(resource_id).ok().flatten() {
            Some(f) => (Some(f.name), Some(f.mime_type)),
            None => (None, None),
        }
    }

    /// Everyone who can approve a request on the resource.
    fn owner_ids(&self, resource_type: &str, resource_id: &str) -> Result<Vec<String>, ApiError> {
        Ok(self
            .permissions_repo
            .list_permissions(resource_type, resource_id)?
            .into_iter()
            .filter(|p| p.role == "owner")
            .map(|p| p.user_id)
            .collect())
    }

    /// Submit an access request for a resource. The requester must not already have access.
    pub fn create_request(
        &self,
        requester_id: &str,
        requester_email: &str,
        resource_type: &str,
        resource_id: &str,
        req: CreateAccessRequestRequest,
    ) -> Result<(AccessRequestResponse, Notice), ApiError> {
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
        let owners = self.owner_ids(resource_type, resource_id)?;
        let notice = notice(
            owners,
            "access_requested",
            &result,
            &result.requested_role,
            self.describe(resource_type, resource_id),
            None,
        );
        Ok((AccessRequestResponse::from(result), notice))
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
        // Named, so the owner can tell what is being asked for without opening it.
        for r in &mut requests {
            let (name, mime) = self.describe(&r.resource_type, &r.resource_id);
            r.resource_name = name;
            r.mime_type = mime;
        }

        Ok(ListAccessRequestsResponse { requests })
    }

    /// Approve a pending access request, granting the requester the appropriate role.
    pub fn approve_request(
        &self,
        caller_id: &str,
        request_id: &str,
        req: ApproveAccessRequestRequest,
    ) -> Result<(AccessRequestResponse, Notice), ApiError> {
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
        let notice = notice(
            vec![updated.requester_id.clone()],
            "access_request_approved",
            &updated,
            role_str,
            self.describe(&updated.resource_type, &updated.resource_id),
            Some(caller_id),
        );
        Ok((AccessRequestResponse::from(updated), notice))
    }

    /// Deny a pending access request.
    pub fn deny_request(
        &self,
        caller_id: &str,
        request_id: &str,
    ) -> Result<(AccessRequestResponse, Notice), ApiError> {
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
        let notice = notice(
            vec![updated.requester_id.clone()],
            "access_request_denied",
            &updated,
            &updated.requested_role,
            self.describe(&updated.resource_type, &updated.resource_id),
            Some(caller_id),
        );
        Ok((AccessRequestResponse::from(updated), notice))
    }
}
