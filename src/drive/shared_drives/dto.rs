use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SharedDriveResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_by: String,
    pub storage_used_bytes: i64,
    pub created_at: String,
    pub updated_at: String,
    pub member_count: i64,
    pub user_role: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SharedDriveListResponse {
    pub drives: Vec<SharedDriveResponse>,
    pub total: i64,
}
