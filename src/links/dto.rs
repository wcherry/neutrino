use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLinksRequest {
    /// Wiki-link target titles extracted client-side from a file's plaintext
    /// content. Resolved case-insensitively against the caller's own files;
    /// titles that don't resolve, resolve to a deleted file, or resolve to a
    /// file the caller can't read are silently dropped — that's normal, not
    /// an error.
    pub linked_titles: Option<Vec<String>>,
    /// Not implemented yet — reserved so the request shape doesn't need to
    /// change when a future phase adds resolving links by file ID directly.
    /// Setting this returns 400.
    pub linked_ids: Option<Vec<String>>,
    /// Not implemented yet — reserved for links anchored to a specific text
    /// range within the source file. Setting this returns 400.
    pub linked_ranges: Option<Vec<serde_json::Value>>,
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileLinkItem {
    pub id: String,
    pub title: String,
    /// Short label derived from the linked file's drive MIME type, e.g.
    /// "note", "doc", "sheet" — "file" for any type without a known mapping.
    pub file_type: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BacklinksResponse {
    pub backlinks: Vec<FileLinkItem>,
}
