use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::drive::workspace::model::WorkspaceSettingsRecord;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettingsResponse {
    /// The organization domain (e.g. "acme.com"). Null means no domain restriction.
    pub allowed_domain: Option<String>,
    /// When true, permissions can only be granted to users with `allowedDomain` email addresses.
    pub restrict_shares_to_domain: bool,
    /// When true, public/anyone-with-link sharing is blocked for all resources.
    pub block_external_link_sharing: bool,
    /// When true, share links are only accessible to authenticated users with the org domain.
    pub domain_only_links: bool,
    pub updated_at: String,
}

impl From<WorkspaceSettingsRecord> for WorkspaceSettingsResponse {
    fn from(r: WorkspaceSettingsRecord) -> Self {
        WorkspaceSettingsResponse {
            allowed_domain: r.allowed_domain,
            restrict_shares_to_domain: r.restrict_shares_to_domain,
            block_external_link_sharing: r.block_external_link_sharing,
            domain_only_links: r.domain_only_links,
            updated_at: r.updated_at.to_string(),
        }
    }
}

/// Request body for updating workspace settings.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceSettingsRequest {
    /// Set to a domain string (e.g. "acme.com") to restrict sharing to that domain.
    /// Set to null to remove the domain restriction.
    pub allowed_domain: Option<Option<String>>,
    pub restrict_shares_to_domain: Option<bool>,
    pub block_external_link_sharing: Option<bool>,
    pub domain_only_links: Option<bool>,
}
