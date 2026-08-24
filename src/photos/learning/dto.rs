use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReprocessingResponse {
    pub suggestions_created: usize,
    pub faces_auto_tagged: usize,
}
