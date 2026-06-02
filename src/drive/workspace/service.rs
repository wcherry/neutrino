use crate::drive::workspace::{
    dto::{UpdateWorkspaceSettingsRequest, WorkspaceSettingsResponse},
    model::{UpdateWorkspaceSettingsRecord, WorkspaceSettingsRecord},
    repository::WorkspaceRepository,
};
use crate::shared::ApiError;
use chrono::Utc;
use std::sync::Arc;

pub struct WorkspaceService {
    repo: Arc<WorkspaceRepository>,
}

impl WorkspaceService {
    pub fn new(repo: Arc<WorkspaceRepository>) -> Self {
        WorkspaceService { repo }
    }

    pub fn get_settings(&self) -> Result<WorkspaceSettingsResponse, ApiError> {
        let record = self.repo.get_or_create()?;
        Ok(WorkspaceSettingsResponse::from(record))
    }

    pub fn update_settings(
        &self,
        req: UpdateWorkspaceSettingsRequest,
    ) -> Result<WorkspaceSettingsResponse, ApiError> {
        let changeset = UpdateWorkspaceSettingsRecord {
            allowed_domain: req.allowed_domain,
            restrict_shares_to_domain: req.restrict_shares_to_domain,
            block_external_link_sharing: req.block_external_link_sharing,
            domain_only_links: req.domain_only_links,
            updated_at: Utc::now().naive_utc(),
        };
        let record = self.repo.update(changeset)?;
        Ok(WorkspaceSettingsResponse::from(record))
    }

    /// Get the raw record for enforcement checks. Returns a default (all-false) record if none set.
    #[allow(dead_code)]
    pub fn get_raw(&self) -> Result<WorkspaceSettingsRecord, ApiError> {
        self.repo.get_or_create()
    }

    /// Check if sharing with a given email is allowed by domain policy.
    /// Returns an error if the domain is restricted and the email doesn't match.
    pub fn check_domain_for_sharing(&self, user_email: &str) -> Result<(), ApiError> {
        let settings = self.repo.get_or_create()?;
        if !settings.restrict_shares_to_domain {
            return Ok(());
        }
        let allowed_domain = match &settings.allowed_domain {
            Some(d) => d.clone(),
            None => return Ok(()), // No domain configured — allow all
        };
        let email_domain = user_email
            .split('@')
            .nth(1)
            .unwrap_or("");
        if !email_domain.eq_ignore_ascii_case(&allowed_domain) {
            return Err(ApiError::new(
                403,
                "DOMAIN_RESTRICTED",
                &format!(
                    "Sharing is restricted to @{} addresses only",
                    allowed_domain
                ),
            ));
        }
        Ok(())
    }

    /// Check whether external link sharing is blocked.
    pub fn check_link_sharing_allowed(&self) -> Result<(), ApiError> {
        let settings = self.repo.get_or_create()?;
        if settings.block_external_link_sharing {
            return Err(ApiError::new(
                403,
                "LINK_SHARING_BLOCKED",
                "External link sharing has been disabled by the workspace administrator",
            ));
        }
        Ok(())
    }

    /// Returns whether share links should be restricted to org-domain users only.
    pub fn is_domain_only_links(&self) -> Result<bool, ApiError> {
        let settings = self.repo.get_or_create()?;
        Ok(settings.domain_only_links)
    }

    /// Returns the allowed domain for the workspace, if set.
    pub fn get_allowed_domain(&self) -> Result<Option<String>, ApiError> {
        let settings = self.repo.get_or_create()?;
        Ok(settings.allowed_domain)
    }
}
