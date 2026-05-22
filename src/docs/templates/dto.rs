use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system: bool,
    pub is_default: bool,
    pub category: Option<String>,
    pub content_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTemplatesResponse {
    pub templates: Vec<TemplateResponse>,
}

#[derive(Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplateRequest {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub content_json: Option<String>,
}

#[derive(Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplateRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_default: Option<bool>,
    pub category: Option<String>,
}

#[derive(Serialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UseTemplateResponse {
    pub doc_id: String,
}
