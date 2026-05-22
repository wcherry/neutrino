use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocRequest {
    pub title: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocRequest {
    pub page_setup: Option<PageSetup>,
    /// Optional new title for the document (renames the backing file record).
    pub title: Option<String>,
}

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

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocResponse {
    pub id: String,
    pub title: String,
    /// Path to read document content directly from the drive API.
    pub content_url: String,
    /// Path to write document content directly to the drive API (multipart POST).
    pub content_write_url: String,
    pub page_setup: PageSetup,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocMetaResponse {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDocsResponse {
    pub docs: Vec<DocMetaResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportTextResponse {
    pub text: String,
    pub word_count: u32,
    pub char_count: u32,
}
