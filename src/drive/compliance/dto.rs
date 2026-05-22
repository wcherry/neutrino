use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateLegalHoldRequest {
    pub name: String,
    pub description: Option<String>,
    pub custodian_ids: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLegalHoldRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub custodian_ids: Option<Vec<String>>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LegalHoldResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_by: String,
    pub custodian_ids: Vec<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LegalHoldListResponse {
    pub holds: Vec<LegalHoldResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRetentionPolicyRequest {
    pub name: String,
    pub retain_for_days: i32,
    pub applies_to_mime_type: Option<String>,
    pub applies_to_user_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRetentionPolicyRequest {
    pub name: Option<String>,
    pub retain_for_days: Option<i32>,
    pub applies_to_mime_type: Option<String>,
    pub applies_to_user_id: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicyResponse {
    pub id: String,
    pub name: String,
    pub retain_for_days: i32,
    pub applies_to_mime_type: Option<String>,
    pub applies_to_user_id: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicyListResponse {
    pub policies: Vec<RetentionPolicyResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EDiscoverySearchRequest {
    pub query: String,
    pub custodian_ids: Option<Vec<String>>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub mime_type: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EDiscoveryResult {
    pub file_id: String,
    pub file_name: String,
    pub owner_id: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub created_at: String,
    pub updated_at: String,
    pub snippet: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EDiscoverySearchResponse {
    pub results: Vec<EDiscoveryResult>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}
