//! Document state Drive has no notion of: page setup, and plain-text export.
//!
//! Document CRUD used to live here as a pass-through to `DriveClient`; it now
//! goes straight to the generic drive file endpoints, with
//! `application/x-neutrino-doc` (see `drive::storage::native_types`) marking a
//! file as a document.

use crate::docs::docs::{
    dto::{ExportTextResponse, PageSetup},
    repository::DocsRepository,
};
use crate::shared::drive_client::DriveClient;
use crate::shared::{ApiError, AuthenticatedUser};
use serde_json::Value;
use std::sync::Arc;

pub struct DocsService {
    repo: Arc<DocsRepository>,
    drive: Arc<DriveClient>,
}

impl DocsService {
    pub fn new(repo: Arc<DocsRepository>, drive: Arc<DriveClient>) -> Self {
        DocsService { repo, drive }
    }

    /// A document with no stored page setup gets the default rather than a
    /// 404 — no row is created when a document is created, so "absent" is the
    /// normal state for a document nobody has changed the margins on.
    pub async fn get_page_setup(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
    ) -> Result<PageSetup, ApiError> {
        let file = self.drive.get_file(user, doc_id, "Document not found").await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Document is in trash"));
        }
        Ok(self
            .repo
            .find_page_setup(doc_id)?
            .and_then(|d| serde_json::from_str::<PageSetup>(&d.page_setup).ok())
            .unwrap_or_else(default_page_setup))
    }

    pub async fn update_page_setup(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
        page_setup: &PageSetup,
    ) -> Result<PageSetup, ApiError> {
        let file = self.drive.get_file(user, doc_id, "Document not found").await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Document is in trash"));
        }
        let json = serde_json::to_string(page_setup)
            .map_err(|_| ApiError::bad_request("Invalid page setup"))?;
        self.repo.upsert_page_setup(doc_id, &json)?;
        Ok(page_setup.clone())
    }

    pub async fn export_text(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
    ) -> Result<ExportTextResponse, ApiError> {
        let file = self.drive.get_file(user, doc_id, "Document not found").await?;
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
        assert!(
            non_ws.is_empty(),
            "Expected no visible text, got: {:?}",
            result
        );
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

    /// The stored form must round-trip: `update_page_setup` serialises to
    /// JSON and `get_page_setup` parses it back, so a shape mismatch between
    /// the two would silently hand every document the defaults.
    #[test]
    fn default_page_setup_round_trips_through_json() {
        let json = serde_json::to_string(&default_page_setup()).expect("serialise");
        let parsed: PageSetup = serde_json::from_str(&json).expect("parse back");
        assert_eq!(parsed.orientation, "portrait");
        assert_eq!(parsed.page_size, "letter");
        assert_eq!(parsed.margin_top, 72.0);
    }
}
