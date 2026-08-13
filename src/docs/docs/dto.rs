use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Per-document page layout. The one piece of document state that isn't a
/// property of the underlying Drive file.
#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub orientation: String,
    pub page_size: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportTextResponse {
    pub text: String,
    pub word_count: u32,
    pub char_count: u32,
}
