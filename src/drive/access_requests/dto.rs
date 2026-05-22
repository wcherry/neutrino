use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::drive::access_requests::model::AccessRequestRecord;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequestResponse {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub requester_id: String,
    pub requester_email: String,
    pub requester_name: String,
    pub message: Option<String>,
    pub requested_role: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<AccessRequestRecord> for AccessRequestResponse {
    fn from(r: AccessRequestRecord) -> Self {
        AccessRequestResponse {
            id: r.id,
            resource_type: r.resource_type,
            resource_id: r.resource_id,
            requester_id: r.requester_id,
            requester_email: r.requester_email,
            requester_name: r.requester_name,
            message: r.message,
            requested_role: r.requested_role,
            status: r.status,
            created_at: r.created_at.to_string(),
            updated_at: r.updated_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAccessRequestsResponse {
    pub requests: Vec<AccessRequestResponse>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccessRequestRequest {
    /// Optional message to the owner explaining the request.
    pub message: Option<String>,
    /// Desired role. Defaults to "viewer".
    #[serde(default = "default_requested_role")]
    pub requested_role: String,
    /// Requester's display name (from auth service).
    pub requester_name: String,
}

fn default_requested_role() -> String {
    "viewer".to_string()
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApproveAccessRequestRequest {
    /// Override the role for approval. Defaults to the originally requested role.
    pub role: Option<String>,
    /// Requester's email for permission grant.
    pub requester_email: String,
    /// Requester's display name for permission grant.
    pub requester_name: String,
}
