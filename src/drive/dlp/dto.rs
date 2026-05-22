use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDlpRuleRequest {
    pub name: String,
    pub description: Option<String>,
    pub pattern: String,
    pub pattern_type: String,
    pub action: String,
    pub severity: String,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDlpRuleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub pattern: Option<String>,
    pub action: Option<String>,
    pub severity: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DlpRuleResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub pattern: String,
    pub pattern_type: String,
    pub action: String,
    pub severity: String,
    pub is_active: bool,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DlpRuleListResponse {
    pub rules: Vec<DlpRuleResponse>,
    pub total: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DlpViolationResponse {
    pub id: String,
    pub file_id: String,
    pub rule_id: String,
    pub rule_name: String,
    pub matched_at: String,
    pub action_taken: Option<String>,
    pub dismissed_at: Option<String>,
    pub dismissed_by: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DlpViolationListResponse {
    pub violations: Vec<DlpViolationResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DlpViolationQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub file_id: Option<String>,
}
