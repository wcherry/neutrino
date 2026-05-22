use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSharedDriveRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSharedDriveRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

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

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddMemberRequest {
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub role: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemberRoleRequest {
    pub role: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SharedDriveMemberResponse {
    pub id: String,
    pub shared_drive_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub role: String,
    pub added_by: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberListResponse {
    pub members: Vec<SharedDriveMemberResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContributorStats {
    pub user_id: String,
    pub file_count: i64,
    pub storage_bytes: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SharedDriveAnalyticsResponse {
    pub id: String,
    pub name: String,
    pub storage_used_bytes: i64,
    pub member_count: i64,
    pub file_count: i64,
}
