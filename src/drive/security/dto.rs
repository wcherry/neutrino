use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RansomwareEventResponse {
    pub id: String,
    pub user_id: String,
    pub triggered_at: String,
    pub event_count: i32,
    pub status: String,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RansomwareEventListResponse {
    pub events: Vec<RansomwareEventResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSiemConfigRequest {
    pub endpoint_url: String,
    pub api_key: Option<String>,
    pub format: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSiemConfigRequest {
    pub endpoint_url: Option<String>,
    pub api_key: Option<String>,
    pub format: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiemConfigResponse {
    pub id: String,
    pub endpoint_url: String,
    pub format: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiemConfigListResponse {
    pub configs: Vec<SiemConfigResponse>,
}

/// CMEK stub request
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CmekKeyRequest {
    pub key_arn: String,
    pub provider: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CmekKeyResponse {
    pub key_arn: String,
    pub provider: String,
    pub status: String,
}
