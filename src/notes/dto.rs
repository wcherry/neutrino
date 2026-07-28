use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    pub title: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteRequest {
    /// New content for the note. Omitted for a pure rename (title-only save)
    /// — content and its wiki-links are left untouched in that case. When
    /// present and the note is E2EE-encrypted this is ciphertext, not
    /// markdown, so the server can no longer parse it for `[[wiki links]]`
    /// — see `linked_titles`.
    pub content: Option<String>,
    /// Optional new title (renames the backing drive file).
    pub title: Option<String>,
    /// Wiki-link target titles extracted client-side from the plaintext
    /// content. Required once content is encrypted, since the server can't
    /// read ciphertext to find `[[links]]` itself. When omitted, the server
    /// falls back to parsing `content` directly (unencrypted notes).
    pub linked_titles: Option<Vec<String>>,
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NoteResponse {
    pub id: String,
    pub title: String,
    /// Path to read note content directly from the drive API (GET), same
    /// pattern as `DocResponse::content_url` — the client fetches raw bytes
    /// from here rather than this response embedding content in JSON.
    pub content_url: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetaResponse {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesResponse {
    pub notes: Vec<NoteMetaResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinkItem {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BacklinksResponse {
    pub backlinks: Vec<NoteLinkItem>,
}
