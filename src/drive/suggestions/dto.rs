use crate::drive::suggestions::model::DocSuggestion;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSuggestionRequest {
    pub content_json: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionResponse {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub content_json: String,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub resolved_by: Option<String>,
}

impl From<DocSuggestion> for SuggestionResponse {
    fn from(s: DocSuggestion) -> Self {
        SuggestionResponse {
            id: s.id,
            file_id: s.file_id,
            user_id: s.user_id,
            user_name: s.user_name,
            content_json: s.content_json,
            status: s.status,
            created_at: s.created_at.to_string(),
            resolved_at: s.resolved_at.map(|d| d.to_string()),
            resolved_by: s.resolved_by,
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionListResponse {
    pub suggestions: Vec<SuggestionResponse>,
    pub total: i64,
}
