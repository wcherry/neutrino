use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::drive::irm::model::IrmPolicyRecord;

/// IRM restrictions for a specific resource and role.
#[derive(Debug, Clone)]
pub struct IrmRestrictions {
    pub restrict_download: bool,
    pub restrict_print_copy: bool,
}

impl IrmRestrictions {
    pub fn unrestricted() -> Self {
        IrmRestrictions {
            restrict_download: false,
            restrict_print_copy: false,
        }
    }
}

/// Full IRM policy response.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IrmPolicyResponse {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    /// Restrict download for Viewer role
    pub restrict_download_viewer: bool,
    /// Restrict download for Commenter role
    pub restrict_download_commenter: bool,
    /// Restrict download for Editor role (admin-controlled)
    pub restrict_download_editor: bool,
    /// Restrict print and copy for Viewer role
    pub restrict_print_copy_viewer: bool,
    /// Restrict print and copy for Commenter role
    pub restrict_print_copy_commenter: bool,
    /// Restrict print and copy for Editor role (admin-controlled)
    pub restrict_print_copy_editor: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl From<IrmPolicyRecord> for IrmPolicyResponse {
    fn from(r: IrmPolicyRecord) -> Self {
        IrmPolicyResponse {
            id: r.id,
            resource_type: r.resource_type,
            resource_id: r.resource_id,
            restrict_download_viewer: r.restrict_download_viewer,
            restrict_download_commenter: r.restrict_download_commenter,
            restrict_download_editor: r.restrict_download_editor,
            restrict_print_copy_viewer: r.restrict_print_copy_viewer,
            restrict_print_copy_commenter: r.restrict_print_copy_commenter,
            restrict_print_copy_editor: r.restrict_print_copy_editor,
            created_at: r.created_at.to_string(),
            updated_at: r.updated_at.to_string(),
        }
    }
}

/// Request body for setting IRM policy.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetIrmPolicyRequest {
    #[serde(default)]
    pub restrict_download_viewer: bool,
    #[serde(default)]
    pub restrict_download_commenter: bool,
    /// Editor restriction is admin-controlled; defaults to false
    #[serde(default)]
    pub restrict_download_editor: bool,
    #[serde(default)]
    pub restrict_print_copy_viewer: bool,
    #[serde(default)]
    pub restrict_print_copy_commenter: bool,
    #[serde(default)]
    pub restrict_print_copy_editor: bool,
}
