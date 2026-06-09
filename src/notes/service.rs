use crate::notes::{
    dto::{
        BacklinksResponse, CreateNoteRequest, ListNotesResponse, NoteLinkItem, NoteMetaResponse,
        NoteResponse, SaveNoteRequest,
    },
    model::{NewNoteRecord, UpdateNoteRecord},
    repository::NotesRepository,
};
use crate::shared::drive_client::DriveClient;
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::Utc;
use reqwest::Client;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

const MIME_TYPE: &str = "application/x-neutrino-note";
const EMPTY_NOTE_CONTENT: &str = "";

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

        self.drive
            .upload_content(&id, EMPTY_NOTE_CONTENT, "create_note_content")
            .await?;

        Ok(NoteResponse {
            id: file.id,
            title: file.name,
            content: EMPTY_NOTE_CONTENT.to_string(),
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
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
        let content = self
            .drive
            .get_content(note_id, "Note content not found")
            .await
            .unwrap_or_default();
        Ok(NoteResponse {
            id: file.id,
            title: file.name,
            content,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_note(
        &self,
        user: &AuthenticatedUser,
        note_id: &str,
        req: SaveNoteRequest,
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

        self.drive
            .upload_content(note_id, &req.content, "save_note_content")
            .await?;

        // Parse [[wiki links]] and update note_links table.
        let linked_titles = parse_wiki_links(&req.content);
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

        let now = Utc::now().naive_utc();
        let changes = UpdateNoteRecord { updated_at: now };
        self.repo.update_note(note_id, changes)?;

        Ok(NoteMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
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
