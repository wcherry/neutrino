use crate::shared::{ApiError, AuthenticatedUser};
use crate::docs::docs::{
    dto::{CreateDocRequest, DocMetaResponse, DocResponse, ExportTextResponse, ListDocsResponse, PageSetup, SaveDocRequest},
    model::{NewDocRecord, UpdateDocRecord},
    repository::DocsRepository,
};

fn content_urls(file_id: &str) -> (String, String) {
    (
        format!("/api/v1/drive/files/{}", file_id),
        format!("/api/v1/drive/files/{}/versions", file_id),
    )
}
use crate::shared::drive_client::DriveClient;
use chrono::Utc;
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

const DEFAULT_PAGE_SETUP: &str = r#"{"marginTop":72,"marginBottom":72,"marginLeft":72,"marginRight":72,"orientation":"portrait","pageSize":"letter"}"#;
const EMPTY_DOC_CONTENT: &str = r#"{"type":"doc","content":[]}"#;
const MIME_TYPE: &str = "application/x-neutrino-doc";

pub struct DocsService {
    repo: Arc<DocsRepository>,
    drive: Arc<DriveClient>,
}

impl DocsService {
    pub fn new(repo: Arc<DocsRepository>, drive: Arc<DriveClient>) -> Self {
        DocsService { repo, drive }
    }

    pub async fn list_docs(&self, user: &AuthenticatedUser) -> Result<ListDocsResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let docs = items
            .into_iter()
            .map(|item| DocMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
            })
            .collect();
        Ok(ListDocsResponse { docs })
    }

    pub async fn create_doc(
        &self,
        user: &AuthenticatedUser,
        req: CreateDocRequest,
    ) -> Result<DocResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Document title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;
        let new_doc = NewDocRecord {
            file_id: &id,
            page_setup: DEFAULT_PAGE_SETUP,
        };
        self.repo.insert_doc(new_doc)?;

        // Upload initial empty content to drive storage
        self.drive
            .upload_content(&id, EMPTY_DOC_CONTENT, "upload_doc_content")
            .await?;

        let page_setup = default_page_setup();
        let (content_url, content_write_url) = content_urls(&id);
        Ok(DocResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            page_setup,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn get_doc(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
    ) -> Result<DocResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, doc_id, "Document not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Document is in trash"));
        }
        let doc = self.repo.get_doc(doc_id)?;
        let page_setup = serde_json::from_str::<PageSetup>(&doc.page_setup)
            .unwrap_or_else(|_| default_page_setup());
        let (content_url, content_write_url) = content_urls(doc_id);
        Ok(DocResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            page_setup,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_doc(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
        req: SaveDocRequest,
    ) -> Result<DocMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, doc_id, "Document not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Document is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, doc_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let new_page_setup = req
            .page_setup
            .as_ref()
            .and_then(|ps| serde_json::to_string(ps).ok());

        let now = Utc::now().naive_utc();
        let changes = UpdateDocRecord {
            page_setup: new_page_setup,
            updated_at: now,
        };
        self.repo.update_doc(doc_id, changes)?;

        Ok(DocMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    pub async fn write_content(
        &self,
        _user: &AuthenticatedUser,
        doc_id: &str,
        content: &str,
    ) -> Result<(), ApiError> {
        self.drive
            .upload_content(doc_id, content, "write_doc_content")
            .await
    }

    pub async fn export_text(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
    ) -> Result<ExportTextResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, doc_id, "Document not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Document is in trash"));
        }
        let content = self
            .drive
            .get_content(doc_id, "Document content not found")
            .await?;
        let text = extract_text_from_tiptap_json(&content);
        let word_count = count_words(&text);
        let char_count = text.chars().count() as u32;
        Ok(ExportTextResponse {
            text,
            word_count,
            char_count,
        })
    }
}

fn default_page_setup() -> PageSetup {
    PageSetup {
        margin_top: 72.0,
        margin_bottom: 72.0,
        margin_left: 72.0,
        margin_right: 72.0,
        orientation: "portrait".to_string(),
        page_size: "letter".to_string(),
    }
}

fn extract_text_from_tiptap_json(json_str: &str) -> String {
    let Ok(val) = serde_json::from_str::<Value>(json_str) else {
        return String::new();
    };
    let mut out = String::new();
    collect_text(&val, &mut out);
    out
}

fn collect_text(val: &Value, out: &mut String) {
    match val {
        Value::Object(map) => {
            if map.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(text) = map.get("text").and_then(|t| t.as_str()) {
                    out.push_str(text);
                }
            }
            if let Some(content) = map.get("content") {
                collect_text(content, out);
                out.push('\n');
            }
        }
        Value::Array(arr) => {
            for item in arr {
                collect_text(item, out);
            }
        }
        _ => {}
    }
}

fn count_words(text: &str) -> u32 {
    text.split_whitespace().count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── count_words ───────────────────────────────────────────────────────────

    #[test]
    fn count_words_empty_string() {
        assert_eq!(count_words(""), 0);
    }

    #[test]
    fn count_words_single_word() {
        assert_eq!(count_words("hello"), 1);
    }

    #[test]
    fn count_words_multiple_words() {
        assert_eq!(count_words("hello world foo"), 3);
    }

    #[test]
    fn count_words_ignores_extra_whitespace() {
        assert_eq!(count_words("  hello   world  "), 2);
    }

    // ── extract_text_from_tiptap_json ─────────────────────────────────────────

    #[test]
    fn extract_text_invalid_json_returns_empty() {
        assert!(extract_text_from_tiptap_json("not json").is_empty());
    }

    #[test]
    fn extract_text_from_simple_paragraph() {
        let json = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello world"}]}]}"#;
        let result = extract_text_from_tiptap_json(json);
        assert!(result.contains("Hello world"));
    }

    #[test]
    fn extract_text_from_multiple_paragraphs() {
        let json = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First"}]},{"type":"paragraph","content":[{"type":"text","text":"Second"}]}]}"#;
        let result = extract_text_from_tiptap_json(json);
        assert!(result.contains("First"));
        assert!(result.contains("Second"));
    }

    #[test]
    fn extract_text_empty_doc_has_no_visible_content() {
        let result = extract_text_from_tiptap_json(r#"{"type":"doc","content":[]}"#);
        let non_ws: String = result.chars().filter(|c| !c.is_whitespace()).collect();
        assert!(non_ws.is_empty(), "Expected no visible text, got: {:?}", result);
    }

    // ── default_page_setup ────────────────────────────────────────────────────

    #[test]
    fn default_page_setup_has_expected_values() {
        let setup = default_page_setup();
        assert_eq!(setup.orientation, "portrait");
        assert_eq!(setup.page_size, "letter");
        assert_eq!(setup.margin_top, 72.0);
        assert_eq!(setup.margin_bottom, 72.0);
        assert_eq!(setup.margin_left, 72.0);
        assert_eq!(setup.margin_right, 72.0);
    }

    #[test]
    fn default_page_setup_constant_is_valid_json() {
        let result: Result<PageSetup, _> = serde_json::from_str(DEFAULT_PAGE_SETUP);
        assert!(result.is_ok(), "DEFAULT_PAGE_SETUP should be valid JSON: {:?}", result.err());
    }
}
