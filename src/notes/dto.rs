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
    /// How `content` is encoded on the wire. Defaults to `"utf8"` (plain
    /// text, written to storage as-is). E2EE notes must set this to
    /// `"base64url"` — the client encrypts the body and base64url-encodes
    /// the ciphertext to fit it into this JSON request, but storage must
    /// hold the *raw* ciphertext bytes (matching the `[24-byte header]` +
    /// ciphertext format every other reader — mobile, version history, the
    /// web app's own content query — expects). Without this the base64url
    /// text itself would be written to disk verbatim, and every reader
    /// downstream would fail to decrypt it.
    pub content_encoding: Option<String>,
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
    /// Server-side content revision at the time of this read. The editor sends
    /// it back as `expectedContentVersion` on its first save, so a document
    /// changed by another device since it was opened is caught immediately
    /// rather than on the second save.
    pub content_version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetaResponse {
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
