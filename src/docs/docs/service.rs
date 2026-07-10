use crate::docs::docs::{
    dto::{
        CreateDocRequest, DocMetaResponse, DocResponse, ExportTextResponse, ListDocsResponse,
        PageSetup, SaveDocRequest,
    },
    model::{NewDocRecord, UpdateDocRecord},
    repository::DocsRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};

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
const OFFICE_MIME_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

    pub async fn autosave(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
        bytes: &[u8],
        title: Option<&str>,
        page_setup: Option<&PageSetup>,
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

        self.drive.upload_content_bytes(doc_id, bytes)?;

        let new_title = if let Some(t) = title {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, doc_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let page_setup_json = page_setup.and_then(|ps| serde_json::to_string(ps).ok());
        let now = Utc::now().naive_utc();
        let changes = UpdateDocRecord {
            page_setup: page_setup_json,
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

    /// Promotes a raw `.docx` Drive file into a native Neutrino doc in place
    /// (same file id, mime type flipped). Used by the "convert on open" flow
    /// and the manual "Convert to Neutrino Doc" action. `content` is
    /// already-converted native doc JSON — no OOXML parsing happens here.
    ///
    /// Order matters for safety: content is written first while the mime
    /// type is still the office type (the safe rollback point, since if this
    /// step fails nothing has changed yet), then the mime type is flipped,
    /// then the docs row is inserted.
    pub async fn promote(
        &self,
        user: &AuthenticatedUser,
        doc_id: &str,
        content: &str,
    ) -> Result<DocResponse, ApiError> {
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
        if file.mime_type.as_deref() != Some(OFFICE_MIME_TYPE) {
            return Err(ApiError::bad_request("File is not a Word (.docx) document"));
        }
        if self.repo.get_doc(doc_id).is_ok() {
            return Err(ApiError::conflict("Document has already been promoted"));
        }

        self.drive
            .upload_content(doc_id, content, "promote_doc_content")
            .await?;
        self.drive
            .update_file_mime_type(user, doc_id, MIME_TYPE)
            .await?;

        let new_doc = NewDocRecord {
            file_id: doc_id,
            page_setup: DEFAULT_PAGE_SETUP,
        };
        self.repo.insert_doc(new_doc)?;

        let page_setup = default_page_setup();
        let (content_url, content_write_url) = content_urls(doc_id);
        let now = Utc::now().naive_utc();
        Ok(DocResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            page_setup,
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

    #[test]
    fn default_page_setup_constant_is_valid_json() {
        let result: Result<PageSetup, _> = serde_json::from_str(DEFAULT_PAGE_SETUP);
        assert!(
            result.is_ok(),
            "DEFAULT_PAGE_SETUP should be valid JSON: {:?}",
            result.err()
        );
    }

    // ── promote (issue #43 — in-place editing of MS Office docs) ─────────────
    //
    // `DocsService::promote` does not exist yet (TDD red phase). Per the plan
    // it must: (a) validate via drive that the file exists, the caller has
    // edit access, and the mime type is the expected raw-office type — else
    // error; (b) reject if a `docs` row already exists for this file id;
    // (c) on success, write content via drive.upload_content, flip the mime
    // type, insert the docs row, and return the normal DocResponse shape;
    // (d) give a viewer a clean 403, not a partial/corrupted write. These
    // tests reference `promote` directly, so this file (and the crate) will
    // fail to *compile* until it exists — the expected/normal shape of Rust
    // TDD red phase for a method that doesn't exist yet, not a runtime
    // assertion failure. Run with `cargo test --lib docs::docs::service::tests`.

    use crate::auth::{repository::AuthRepository, service::AuthService};
    use crate::drive::encryption::repository::EncryptionRepository;
    use crate::drive::filesystem::repository::FilesystemRepository;
    use crate::drive::permissions::repository::PermissionsRepository;
    use crate::drive::permissions::service::PermissionsService;
    use crate::drive::storage::model::NewFileRecord;
    use crate::drive::storage::repository::StorageRepository;
    use crate::drive::storage::service::StorageService;
    use crate::drive::storage::store::LocalFileStore;
    use crate::drive::workspace::{repository::WorkspaceRepository, service::WorkspaceService};
    use crate::shared::TokenService;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;
    use std::path::PathBuf;

    const DOCX_MIME: &str =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const OTHER_MIME: &str = "text/plain";
    const PROMOTE_CONTENT: &str = r#"{"type":"doc","content":[]}"#;

    fn promote_test_pool() -> crate::drive::storage::repository::DbPool {
        use crate::MIGRATIONS;
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn promote_test_user(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
    }

    /// Full DocsService wired against a real (in-memory) DB + scratch storage
    /// dir, following the exact dependency graph main.rs builds for the docs
    /// app (minus the HTTP layer). Returns handles needed to set up fixtures
    /// and assert on DB state directly.
    struct PromoteHarness {
        docs_service: DocsService,
        storage_repo: StorageRepository,
        docs_repo: DocsRepository,
        permissions_repo: PermissionsRepository,
        base_dir: PathBuf,
    }

    fn build_promote_harness() -> PromoteHarness {
        let pool = promote_test_pool();
        let base = std::env::temp_dir().join(format!("neutrino_docs_promote_test_{}", uuid::Uuid::new_v4()));
        let store = Arc::new(LocalFileStore::new(&base).expect("create store"));

        let workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
        let workspace_service = Arc::new(WorkspaceService::new(workspace_repo));
        let encryption_repo = Arc::new(EncryptionRepository::new(pool.clone()));
        let auth_repo = Arc::new(AuthRepository::new(pool.clone()));
        let token_service = Arc::new(TokenService::new("test-secret".to_string()));
        let auth_service = Arc::new(AuthService::new(auth_repo, token_service));
        let permissions_repo_for_assertions = PermissionsRepository::new(pool.clone());
        let permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
        let permissions_service = Arc::new(PermissionsService::new(
            permissions_repo,
            workspace_service,
            encryption_repo,
            auth_service,
        ));

        let storage_repo_for_assertions = StorageRepository::new(pool.clone());
        let storage_repo = Arc::new(StorageRepository::new(pool.clone()));
        let storage_service = Arc::new(StorageService::new(
            storage_repo,
            store,
            permissions_service.clone(),
        ));
        let fs_repo = Arc::new(FilesystemRepository::new(pool.clone()));
        let drive_client = Arc::new(DriveClient::new(storage_service, permissions_service, fs_repo));

        let docs_repo_for_assertions = DocsRepository::new(pool.clone());
        let docs_repo = Arc::new(DocsRepository::new(pool));
        let docs_service = DocsService::new(docs_repo, drive_client);

        PromoteHarness {
            docs_service,
            storage_repo: storage_repo_for_assertions,
            docs_repo: docs_repo_for_assertions,
            permissions_repo: permissions_repo_for_assertions,
            base_dir: base,
        }
    }

    fn insert_office_file(repo: &StorageRepository, id: &str, owner_id: &str, mime_type: &str) {
        repo.insert_file(NewFileRecord {
            id,
            user_id: owner_id,
            name: "report.docx",
            size_bytes: 0,
            mime_type,
            storage_path: "",
            folder_id: None,
            encrypted_metadata: None,
        })
        .expect("insert file");
    }

    fn grant_role(repo: &PermissionsRepository, resource_id: &str, user_id: &str, role: &str) {
        use crate::drive::permissions::model::NewPermissionRecord;
        repo.upsert_permission(&NewPermissionRecord {
            id: &uuid::Uuid::new_v4().to_string(),
            resource_type: "file",
            resource_id,
            user_id,
            role,
            granted_by: user_id,
            user_email: &format!("{user_id}@example.com"),
            user_name: user_id,
        })
        .expect("grant role");
    }

    #[tokio::test]
    async fn promote_succeeds_for_the_owner_of_a_raw_docx_file() {
        let h = build_promote_harness();
        let owner = promote_test_user("owner-1");
        insert_office_file(&h.storage_repo, "doc-1", &owner.user_id, DOCX_MIME);
        grant_role(&h.permissions_repo, "doc-1", &owner.user_id, "owner");

        let result = h
            .docs_service
            .promote(&owner, "doc-1", PROMOTE_CONTENT)
            .await
            .expect("promote should succeed for the owner of a raw docx file");

        assert_eq!(result.id, "doc-1");
        // The file's mime type must be flipped to the native docs type.
        let file = h.storage_repo.find_file_by_id("doc-1").unwrap().unwrap();
        assert_eq!(file.mime_type, MIME_TYPE);
        // A docs row must now exist for this file id.
        assert!(h.docs_repo.get_doc("doc-1").is_ok());
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_succeeds_for_a_non_owner_with_edit_access() {
        let h = build_promote_harness();
        insert_office_file(&h.storage_repo, "doc-2", "owner-1", DOCX_MIME);
        grant_role(&h.permissions_repo, "doc-2", "owner-1", "owner");
        let editor = promote_test_user("editor-1");
        grant_role(&h.permissions_repo, "doc-2", &editor.user_id, "editor");

        let result = h.docs_service.promote(&editor, "doc-2", PROMOTE_CONTENT).await;

        assert!(
            result.is_ok(),
            "a non-owner editor should be able to promote the file: {:?}",
            result.err()
        );
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_rejects_when_a_docs_row_already_exists() {
        let h = build_promote_harness();
        let owner = promote_test_user("owner-1");
        insert_office_file(&h.storage_repo, "doc-3", &owner.user_id, DOCX_MIME);
        grant_role(&h.permissions_repo, "doc-3", &owner.user_id, "owner");
        h.docs_repo
            .insert_doc(NewDocRecord {
                file_id: "doc-3",
                page_setup: DEFAULT_PAGE_SETUP,
            })
            .expect("pre-insert docs row to simulate an already-promoted file");

        let result = h.docs_service.promote(&owner, "doc-3", PROMOTE_CONTENT).await;

        assert!(
            result.is_err(),
            "promote must reject a file that has already been promoted"
        );
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_rejects_a_file_with_the_wrong_mime_type() {
        let h = build_promote_harness();
        let owner = promote_test_user("owner-1");
        insert_office_file(&h.storage_repo, "doc-4", &owner.user_id, OTHER_MIME);
        grant_role(&h.permissions_repo, "doc-4", &owner.user_id, "owner");

        let result = h.docs_service.promote(&owner, "doc-4", PROMOTE_CONTENT).await;

        assert!(
            result.is_err(),
            "promote must reject a file whose mime type is not the expected office type"
        );
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_gives_a_viewer_a_clean_403_not_a_corrupted_write() {
        let h = build_promote_harness();
        insert_office_file(&h.storage_repo, "doc-5", "owner-1", DOCX_MIME);
        grant_role(&h.permissions_repo, "doc-5", "owner-1", "owner");
        let viewer = promote_test_user("viewer-1");
        grant_role(&h.permissions_repo, "doc-5", &viewer.user_id, "viewer");

        let result = h.docs_service.promote(&viewer, "doc-5", PROMOTE_CONTENT).await;

        let err = result.expect_err("a viewer must not be able to promote the file");
        assert_eq!(err.status, 403);
        // The mime type must be unchanged — no partial/corrupted write.
        let file = h.storage_repo.find_file_by_id("doc-5").unwrap().unwrap();
        assert_eq!(file.mime_type, DOCX_MIME);
        assert!(h.docs_repo.get_doc("doc-5").is_err());
        let _ = std::fs::remove_dir_all(h.base_dir);
    }
}
