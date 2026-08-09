use crate::notes::{
    dto::{
        BacklinksResponse, CreateNoteRequest, ListNotesResponse, NoteLinkItem, NoteMetaResponse,
        NoteResponse, SaveNoteRequest,
    },
    model::{NewNoteRecord, UpdateNoteRecord},
    repository::NotesRepository,
};
use crate::shared::drive_client::DriveClient;
use crate::shared::{ApiError, AuthenticatedUser, ContentVersionCheck};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use reqwest::Client;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

const MIME_TYPE: &str = "application/x-neutrino-note";
const EMPTY_NOTE_CONTENT: &str = "";

/// Path to read a note's content directly from the drive API — same pattern
/// as docs' `content_urls` (src/docs/docs/service.rs). The client fetches raw
/// bytes from here instead of this service embedding content in JSON.
fn content_url(file_id: &str) -> String {
    format!("/api/v1/drive/files/{}", file_id)
}

/// Decodes a `SaveNoteRequest.content` string into the raw bytes storage
/// should hold, per its declared `content_encoding`.
///
/// Plain saves (`encoding` is `None`) write `content`'s UTF-8 bytes as-is.
/// E2EE saves declare `Some("base64url")`: the client encrypted the note body
/// and base64url-encoded the ciphertext to carry it in JSON, so this decodes
/// it back to the raw `[24-byte header]` + ciphertext bytes every reader
/// (mobile, version history, this app's own content query) expects on disk.
fn decode_note_content(content: &str, encoding: Option<&str>) -> Result<Vec<u8>, ApiError> {
    match encoding {
        Some("base64url") => URL_SAFE_NO_PAD
            .decode(content)
            .map_err(|_| ApiError::bad_request("content is not valid base64url")),
        _ => Ok(content.as_bytes().to_vec()),
    }
}

/// Extract all `[[title]]` wiki-link targets from `content`.
fn parse_wiki_links(content: &str) -> Vec<String> {
    let mut titles = Vec::new();
    let bytes = content.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i + 1 < len {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            i += 2;
            let start = i;
            while i + 1 < len && !(bytes[i] == b']' && bytes[i + 1] == b']') {
                i += 1;
            }
            if i + 1 < len {
                let title = content[start..i].trim().to_string();
                if !title.is_empty() {
                    titles.push(title);
                }
                i += 2; // skip closing ]]
            }
        } else {
            i += 1;
        }
    }
    titles
}

pub struct NotesService {
    repo: Arc<NotesRepository>,
    drive: Arc<DriveClient>,
    drive_base_url: String,
    http: Client,
}

impl NotesService {
    pub fn new(
        repo: Arc<NotesRepository>,
        drive: Arc<DriveClient>,
        drive_base_url: String,
    ) -> Self {
        NotesService {
            repo,
            drive,
            drive_base_url,
            http: Client::new(),
        }
    }

    pub async fn list_notes(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListNotesResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let notes = items
            .into_iter()
            .map(|item| NoteMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
                content_version: item.content_version,
            })
            .collect();
        Ok(ListNotesResponse { notes })
    }

    pub async fn create_note(
        &self,
        user: &AuthenticatedUser,
        req: CreateNoteRequest,
    ) -> Result<NoteResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Note title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;

        let new_note = NewNoteRecord { file_id: &id };
        self.repo.insert_note(new_note)?;

        let content_version = self
            .drive
            .upload_content(
                &id,
                EMPTY_NOTE_CONTENT,
                "create_note_content",
                ContentVersionCheck::UNCHECKED,
            )
            .await?;

        Ok(NoteResponse {
            id: file.id.clone(),
            title: file.name,
            content_url: content_url(&file.id),
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
            content_version,
        })
    }

    pub async fn get_note(
        &self,
        user: &AuthenticatedUser,
        note_id: &str,
    ) -> Result<NoteResponse, ApiError> {
        let file = self.drive.get_file(user, note_id, "Note not found").await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Note is in trash"));
        }
        Ok(NoteResponse {
            id: file.id.clone(),
            title: file.name,
            content_url: content_url(&file.id),
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
            content_version: file.content_version,
        })
    }

    pub async fn save_note(
        &self,
        user: &AuthenticatedUser,
        note_id: &str,
        req: SaveNoteRequest,
        check: ContentVersionCheck,
    ) -> Result<NoteMetaResponse, ApiError> {
        let file = self.drive.get_file(user, note_id, "Note not found").await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Note is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, note_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        // `content` is omitted for a pure rename (title-only save) — leave
        // content and its wiki-links untouched in that case rather than
        // overwriting them with nothing.
        // A title-only save writes no content, so it leaves the revision alone.
        let mut content_version = file.content_version;
        if let Some(ref content) = req.content {
            let decoded = decode_note_content(content, req.content_encoding.as_deref())?;
            content_version = self.drive.upload_content_bytes(note_id, &decoded, check)?;

            // Parse [[wiki links]] and update note_links table. Prefer the
            // client-supplied titles (required once content is E2EE ciphertext,
            // since the server can no longer read [[links]] out of it) and fall
            // back to parsing `content` directly for unencrypted notes.
            let linked_titles = req
                .linked_titles
                .clone()
                .unwrap_or_else(|| parse_wiki_links(content));
            let target_ids = if linked_titles.is_empty() {
                Vec::new()
            } else {
                let all_files = self.drive.list_files(user, MIME_TYPE).await?;
                let title_to_id: HashMap<String, String> = all_files
                    .into_iter()
                    .filter(|f| f.id != note_id) // exclude self-links
                    .map(|f| (f.name.to_lowercase(), f.id))
                    .collect();
                linked_titles
                    .iter()
                    .filter_map(|t| title_to_id.get(&t.to_lowercase()).cloned())
                    .collect::<std::collections::HashSet<_>>()
                    .into_iter()
                    .collect()
            };
            self.repo.replace_links(note_id, &target_ids)?;
        }

        let now = Utc::now().naive_utc();
        let changes = UpdateNoteRecord { updated_at: now };
        self.repo.update_note(note_id, changes)?;

        Ok(NoteMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
            content_version,
        })
    }

    pub async fn get_backlinks(
        &self,
        user: &AuthenticatedUser,
        note_id: &str,
    ) -> Result<BacklinksResponse, ApiError> {
        // Verify the user can see this note.
        let file = self.drive.get_file(user, note_id, "Note not found").await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Note is in trash"));
        }

        let source_ids = self.repo.get_backlink_source_ids(note_id)?;
        let mut backlinks = Vec::new();
        for source_id in &source_ids {
            if let Ok(source_file) = self.drive.get_file(user, source_id, "").await {
                if source_file.deleted_at.is_none() {
                    backlinks.push(NoteLinkItem {
                        id: source_file.id,
                        title: source_file.name,
                    });
                }
            }
        }
        Ok(BacklinksResponse { backlinks })
    }

    pub async fn delete_note(
        &self,
        user: &AuthenticatedUser,
        note_id: &str,
    ) -> Result<(), ApiError> {
        let file = self.drive.get_file(user, note_id, "Note not found").await?;
        match file.your_role.as_str() {
            "owner" => {}
            _ => {
                return Err(ApiError::new(
                    403,
                    "FORBIDDEN",
                    "Only the owner can delete a note",
                ))
            }
        }

        let url = format!("{}/api/v1/drive/files/{}", self.drive_base_url, note_id);
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(&user.token)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Drive trash note error: {:?}", e);
                ApiError::internal("Failed to reach drive service")
            })?;
        if !resp.status().is_success() {
            tracing::error!("Drive trash note returned {}", resp.status());
            return Err(ApiError::internal("Drive service error"));
        }

        self.repo.delete_links_for_note(note_id)?;
        self.repo.delete_note(note_id)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Regression coverage for https://github.com/wcherry/neutrino_notes_ios_mobile/issues/7 —
    // the notes editor E2EE-encrypts content client-side and sends the
    // ciphertext's base64url text over JSON. Without decoding it back to raw
    // bytes before writing to storage, every non-web reader (mobile, version
    // history) fails to decrypt the note because the file on disk holds
    // base64url text instead of the `[24-byte header]` + ciphertext format
    // they all expect.

    #[test]
    fn decode_note_content_plain_writes_utf8_bytes_as_is() {
        let decoded = decode_note_content("hello world", None).unwrap();
        assert_eq!(decoded, b"hello world");
    }

    #[test]
    fn decode_note_content_base64url_decodes_to_raw_bytes() {
        // Bytes that are NOT valid UTF-8 on their own, to prove this is a
        // true binary decode and not just round-tripping text.
        let raw: &[u8] = &[0, 1, 2, 253, 254, 255, b'h', b'i'];
        let encoded = URL_SAFE_NO_PAD.encode(raw);

        let decoded = decode_note_content(&encoded, Some("base64url")).unwrap();

        assert_eq!(decoded, raw);
    }

    #[test]
    fn decode_note_content_invalid_base64url_is_a_bad_request() {
        let err = decode_note_content("not valid base64!!", Some("base64url")).unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn parse_wiki_links_basic() {
        let content = "See [[Alpha]] and [[Beta]] for more.";
        let links = parse_wiki_links(content);
        assert_eq!(links, vec!["Alpha", "Beta"]);
    }

    #[test]
    fn parse_wiki_links_empty() {
        assert!(parse_wiki_links("no links here").is_empty());
    }

    #[test]
    fn parse_wiki_links_trims_whitespace() {
        let links = parse_wiki_links("[[ My Note ]]");
        assert_eq!(links, vec!["My Note"]);
    }

    #[test]
    fn parse_wiki_links_skips_empty_brackets() {
        assert!(parse_wiki_links("[[]]").is_empty());
    }
}
