use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThresholdsResponse {
    pub auto_tag_threshold: f32,
    pub suggest_threshold: f32,
    pub total_accepts: i32,
    pub total_rejects: i32,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReprocessingResponse {
    pub suggestions_created: usize,
    pub faces_auto_tagged: usize,
}
