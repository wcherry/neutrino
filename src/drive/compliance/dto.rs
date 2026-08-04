#![allow(dead_code)]

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
