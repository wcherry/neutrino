use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionResponse {
    pub id: String,
    pub face_id: String,
    pub face_thumbnail: Option<String>,
    pub face_thumbnail_mime_type: Option<String>,
    pub person_id: String,
    pub person_name: Option<String>,
    pub person_thumbnail: Option<String>,
    pub person_thumbnail_mime_type: Option<String>,
    /// Similarity score: 1.0 − cosine_distance, in [0, 1]. Higher = better match.
    pub confidence: f32,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSuggestionsResponse {
    pub suggestions: Vec<SuggestionResponse>,
    pub total: usize,
}
