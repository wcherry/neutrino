use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDrawingRequest {
    pub title: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveDrawingRequest {
    pub title: Option<String>,
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DrawingResponse {
    pub id: String,
    pub title: String,
    pub content_url: String,
    pub content_write_url: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Server-side content revision at the time of this read. The editor sends
    /// it back as `expectedContentVersion` on its first save, so a document
    /// changed by another device since it was opened is caught immediately
    /// rather than on the second save.
    pub content_version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DrawingMetaResponse {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Server-side content revision, bumped on every content write. Send it back
    /// as `expectedContentVersion` on the next save so a stale write is rejected
    /// instead of silently overwriting a newer revision.
    pub content_version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDrawingsResponse {
    pub drawings: Vec<DrawingMetaResponse>,
}
