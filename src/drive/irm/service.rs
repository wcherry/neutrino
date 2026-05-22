use crate::drive::irm::{
    dto::{IrmPolicyResponse, IrmRestrictions, SetIrmPolicyRequest},
    model::NewIrmPolicyRecord,
    repository::IrmRepository,
};
use crate::drive::permissions::service::PermissionsService;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct IrmService {
    repo: Arc<IrmRepository>,
    permissions: Arc<PermissionsService>,
}

impl IrmService {
    pub fn new(repo: Arc<IrmRepository>, permissions: Arc<PermissionsService>) -> Self {
        IrmService { repo, permissions }
    }

    /// Get the IRM policy for a resource. Returns a default (all-false) policy if none exists.
    /// Requires the caller to be owner.
    pub fn get_policy(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<IrmPolicyResponse>, ApiError> {
        self.require_owner(caller_id, resource_type, resource_id)?;
        let record = self.repo.find_by_resource(resource_type, resource_id)?;
        Ok(record.map(IrmPolicyResponse::from))
    }

    /// Create or replace the IRM policy for a resource. Requires owner.
    pub fn set_policy(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        req: SetIrmPolicyRequest,
    ) -> Result<IrmPolicyResponse, ApiError> {
        self.require_owner(caller_id, resource_type, resource_id)?;

        let id = Uuid::new_v4().to_string();
        let record = NewIrmPolicyRecord {
            id: &id,
            resource_type,
            resource_id,
            restrict_download_viewer: req.restrict_download_viewer,
            restrict_download_commenter: req.restrict_download_commenter,
            restrict_download_editor: req.restrict_download_editor,
            restrict_print_copy_viewer: req.restrict_print_copy_viewer,
            restrict_print_copy_commenter: req.restrict_print_copy_commenter,
            restrict_print_copy_editor: req.restrict_print_copy_editor,
        };

        let policy = self.repo.upsert_policy(&record)?;
        Ok(IrmPolicyResponse::from(policy))
    }

    /// Delete the IRM policy for a resource (resets to defaults). Requires owner.
    pub fn delete_policy(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        self.require_owner(caller_id, resource_type, resource_id)?;
        self.repo.delete_policy(resource_type, resource_id)?;
        Ok(())
    }

    /// Get IRM restrictions for a given role on a resource.
    /// Returns unrestricted if no policy exists.
    pub fn get_restrictions(
        &self,
        resource_type: &str,
        resource_id: &str,
        role: &str,
    ) -> Result<IrmRestrictions, ApiError> {
        let policy = match self.repo.find_by_resource(resource_type, resource_id)? {
            Some(p) => p,
            None => return Ok(IrmRestrictions::unrestricted()),
        };

        let (restrict_download, restrict_print_copy) = match role {
            "viewer" => (
                policy.restrict_download_viewer,
                policy.restrict_print_copy_viewer,
            ),
            "commenter" => (
                policy.restrict_download_commenter,
                policy.restrict_print_copy_commenter,
            ),
            "editor" => (
                policy.restrict_download_editor,
                policy.restrict_print_copy_editor,
            ),
            // Owners are never restricted
            _ => (false, false),
        };

        Ok(IrmRestrictions {
            restrict_download,
            restrict_print_copy,
        })
    }

    fn require_owner(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        let role = self
            .permissions
            .get_effective_role(caller_id, resource_type, resource_id)?;
        if role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can manage IRM policies",
            ));
        }
        Ok(())
    }
}
