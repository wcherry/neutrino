use crate::shared::{ApiError, AuthenticatedUser};
use crate::slides::slides::{
    dto::{
        CreateSlideRequest, CreateThemeRequest, ListSlidesResponse, ListThemesResponse,
        SaveSlideRequest, SlideMetaResponse, SlideResponse, ThemeResponse, UpdateThemeRequest,
    },
    model::{NewSlideRecord, NewThemeRecord, UpdateSlideRecord, UpdateThemeRecord},
    repository::SlidesRepository,
};

fn content_urls(file_id: &str) -> (String, String) {
    (
        format!("/api/v1/drive/files/{}", file_id),
        format!("/api/v1/drive/files/{}/versions", file_id),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_urls_returns_correct_paths() {
        let (content_url, versions_url) = content_urls("slide-xyz");
        assert_eq!(content_url, "/api/v1/drive/files/slide-xyz");
        assert_eq!(versions_url, "/api/v1/drive/files/slide-xyz/versions");
    }

    #[test]
    fn mime_type_constant_is_correct() {
        assert_eq!(MIME_TYPE, "application/x-neutrino-slide");
    }

    #[test]
    fn empty_slides_content_is_nonempty_and_contains_slides_key() {
        assert!(!EMPTY_SLIDES_CONTENT.is_empty());
        assert!(EMPTY_SLIDES_CONTENT.contains("slides"));
        assert!(EMPTY_SLIDES_CONTENT.contains("theme"));
    }

    // ── promote (issue #43 — in-place editing of MS Office docs) ─────────────
    //
    // `SlidesService::promote` does not exist yet (TDD red phase). Mirrors
    // the contract tested for docs::docs::service::promote and
    // sheets::sheets::service::promote: validates file existence/edit-access/
    // mime type, rejects an already-promoted file, uploads content + flips
    // mime type + inserts the slides row on success, and gives a viewer a
    // clean 403. These tests reference `promote` directly, so this file (and
    // the crate) will fail to *compile* until it exists — the expected/normal
    // shape of Rust TDD red phase for a method that doesn't exist yet. Run
    // with `cargo test --lib slides::slides::service::tests`.

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

    const PPTX_MIME: &str =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const OTHER_MIME: &str = "text/plain";
    const PROMOTE_CONTENT: &str = EMPTY_SLIDES_CONTENT;

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

    struct PromoteHarness {
        slides_service: SlidesService,
        storage_repo: StorageRepository,
        slides_repo: SlidesRepository,
        permissions_repo: PermissionsRepository,
        base_dir: PathBuf,
    }

    fn build_promote_harness() -> PromoteHarness {
        let pool = promote_test_pool();
        let base = std::env::temp_dir().join(format!("neutrino_slides_promote_test_{}", uuid::Uuid::new_v4()));
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

        let slides_repo_for_assertions = SlidesRepository::new(pool.clone());
        let slides_repo = Arc::new(SlidesRepository::new(pool));
        let slides_service = SlidesService::new(slides_repo, drive_client);

        PromoteHarness {
            slides_service,
            storage_repo: storage_repo_for_assertions,
            slides_repo: slides_repo_for_assertions,
            permissions_repo: permissions_repo_for_assertions,
            base_dir: base,
        }
    }

    fn insert_office_file(repo: &StorageRepository, id: &str, owner_id: &str, mime_type: &str) {
        repo.insert_file(NewFileRecord {
            id,
            user_id: owner_id,
            name: "deck.pptx",
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
    async fn promote_succeeds_for_the_owner_of_a_raw_pptx_file() {
        let h = build_promote_harness();
        let owner = promote_test_user("owner-1");
        insert_office_file(&h.storage_repo, "slide-1", &owner.user_id, PPTX_MIME);
        grant_role(&h.permissions_repo, "slide-1", &owner.user_id, "owner");

        let result = h
            .slides_service
            .promote(&owner, "slide-1", PROMOTE_CONTENT)
            .await
            .expect("promote should succeed for the owner of a raw pptx file");

        assert_eq!(result.id, "slide-1");
        let file = h.storage_repo.find_file_by_id("slide-1").unwrap().unwrap();
        assert_eq!(file.mime_type, MIME_TYPE);
        assert!(h.slides_repo.get_slide("slide-1").is_ok());
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_succeeds_for_a_non_owner_with_edit_access() {
        let h = build_promote_harness();
        insert_office_file(&h.storage_repo, "slide-2", "owner-1", PPTX_MIME);
        grant_role(&h.permissions_repo, "slide-2", "owner-1", "owner");
        let editor = promote_test_user("editor-1");
        grant_role(&h.permissions_repo, "slide-2", &editor.user_id, "editor");

        let result = h.slides_service.promote(&editor, "slide-2", PROMOTE_CONTENT).await;

        assert!(
            result.is_ok(),
            "a non-owner editor should be able to promote the file: {:?}",
            result.err()
        );
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_rejects_when_a_slides_row_already_exists() {
        let h = build_promote_harness();
        let owner = promote_test_user("owner-1");
        insert_office_file(&h.storage_repo, "slide-3", &owner.user_id, PPTX_MIME);
        grant_role(&h.permissions_repo, "slide-3", &owner.user_id, "owner");
        h.slides_repo
            .insert_slide(NewSlideRecord { file_id: "slide-3" })
            .expect("pre-insert slides row to simulate an already-promoted file");

        let result = h.slides_service.promote(&owner, "slide-3", PROMOTE_CONTENT).await;

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
        insert_office_file(&h.storage_repo, "slide-4", &owner.user_id, OTHER_MIME);
        grant_role(&h.permissions_repo, "slide-4", &owner.user_id, "owner");

        let result = h.slides_service.promote(&owner, "slide-4", PROMOTE_CONTENT).await;

        assert!(
            result.is_err(),
            "promote must reject a file whose mime type is not the expected office type"
        );
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_gives_a_viewer_a_clean_403_not_a_corrupted_write() {
        let h = build_promote_harness();
        insert_office_file(&h.storage_repo, "slide-5", "owner-1", PPTX_MIME);
        grant_role(&h.permissions_repo, "slide-5", "owner-1", "owner");
        let viewer = promote_test_user("viewer-1");
        grant_role(&h.permissions_repo, "slide-5", &viewer.user_id, "viewer");

        let result = h.slides_service.promote(&viewer, "slide-5", PROMOTE_CONTENT).await;

        let err = result.expect_err("a viewer must not be able to promote the file");
        assert_eq!(err.status, 403);
        let file = h.storage_repo.find_file_by_id("slide-5").unwrap().unwrap();
        assert_eq!(file.mime_type, PPTX_MIME);
        assert!(h.slides_repo.get_slide("slide-5").is_err());
        let _ = std::fs::remove_dir_all(h.base_dir);
    }
}
use crate::shared::drive_client::DriveClient;
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// Default empty presentation: one blank title slide.
const EMPTY_SLIDES_CONTENT: &str = r#"{"slides":[{"id":"s1","background":{"type":"color","value":"\#ffffff"},"elements":[{"id":"e1","type":"text","x":10,"y":30,"w":80,"h":20,"content":"Click to add title","style":{"fontSize":40,"bold":true,"italic":false,"underline":false,"color":"\#1f2937","align":"center","fontFamily":"Inter"}},{"id":"e2","type":"text","x":15,"y":55,"w":70,"h":15,"content":"Click to add subtitle","style":{"fontSize":24,"bold":false,"italic":false,"underline":false,"color":"\#6b7280","align":"center","fontFamily":"Inter"}}],"notes":"","transition":"fade"}],"theme":{"name":"default","primaryColor":"\#4f46e5","backgroundColor":"\#ffffff","textColor":"\#1f2937","accentColor":"\#818cf8","fontFamily":"Inter","defaultTransition":"fade"}}"#;
const MIME_TYPE: &str = "application/x-neutrino-slide";
const OFFICE_MIME_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";

pub struct SlidesService {
    repo: Arc<SlidesRepository>,
    drive: Arc<DriveClient>,
}

impl SlidesService {
    pub fn new(repo: Arc<SlidesRepository>, drive: Arc<DriveClient>) -> Self {
        SlidesService { repo, drive }
    }

    pub async fn list_slides(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListSlidesResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let slides = items
            .into_iter()
            .map(|item| SlideMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
            })
            .collect();
        Ok(ListSlidesResponse { slides })
    }

    pub async fn create_slide(
        &self,
        user: &AuthenticatedUser,
        req: CreateSlideRequest,
    ) -> Result<SlideResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Presentation title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;
        let new_slide = NewSlideRecord { file_id: &id };
        self.repo.insert_slide(new_slide)?;

        self.drive
            .upload_content(&id, EMPTY_SLIDES_CONTENT, "upload_slide_content")
            .await?;

        let (content_url, content_write_url) = content_urls(&id);
        Ok(SlideResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn get_slide(
        &self,
        user: &AuthenticatedUser,
        slide_id: &str,
    ) -> Result<SlideResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, slide_id, "Presentation not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Presentation is in trash"));
        }
        self.repo.get_slide(slide_id)?;
        let (content_url, content_write_url) = content_urls(slide_id);
        Ok(SlideResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    // ── Theme methods ───────────────────────────────────────────────────────

    pub fn list_themes(&self, user: &AuthenticatedUser) -> Result<ListThemesResponse, ApiError> {
        let records = self.repo.list_themes_for_user(&user.user_id)?;
        let themes = records.into_iter().map(theme_record_to_response).collect();
        Ok(ListThemesResponse { themes })
    }

    pub fn create_theme(
        &self,
        user: &AuthenticatedUser,
        req: CreateThemeRequest,
    ) -> Result<ThemeResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Theme name cannot be empty"));
        }
        validate_hex_color(&req.primary_color, "primaryColor")?;
        validate_hex_color(&req.background_color, "backgroundColor")?;
        validate_hex_color(&req.text_color, "textColor")?;
        validate_hex_color(&req.accent_color, "accentColor")?;

        let id = Uuid::new_v4().to_string();
        let new_theme = NewThemeRecord {
            id: &id,
            user_id: &user.user_id,
            name: &name,
            primary_color: &req.primary_color,
            background_color: &req.background_color,
            text_color: &req.text_color,
            accent_color: &req.accent_color,
            font_family: &req.font_family,
            background_image: req.background_image.as_deref(),
            gradient_background: req.gradient_background.as_deref(),
            default_transition: &req.default_transition,
            is_system: false,
        };
        let record = self.repo.insert_theme(new_theme)?;
        Ok(theme_record_to_response(record))
    }

    pub fn update_theme(
        &self,
        user: &AuthenticatedUser,
        theme_id: &str,
        req: UpdateThemeRequest,
    ) -> Result<ThemeResponse, ApiError> {
        if let Some(ref name) = req.name {
            if name.trim().is_empty() {
                return Err(ApiError::bad_request("Theme name cannot be empty"));
            }
        }
        if let Some(ref c) = req.primary_color {
            validate_hex_color(c, "primaryColor")?;
        }
        if let Some(ref c) = req.background_color {
            validate_hex_color(c, "backgroundColor")?;
        }
        if let Some(ref c) = req.text_color {
            validate_hex_color(c, "textColor")?;
        }
        if let Some(ref c) = req.accent_color {
            validate_hex_color(c, "accentColor")?;
        }

        let changes = UpdateThemeRecord {
            name: req.name.map(|n| n.trim().to_string()),
            primary_color: req.primary_color,
            background_color: req.background_color,
            text_color: req.text_color,
            accent_color: req.accent_color,
            font_family: req.font_family,
            background_image: req.background_image,
            gradient_background: req.gradient_background,
            default_transition: req.default_transition,
            updated_at: Utc::now().naive_utc(),
        };
        let record = self.repo.update_theme(theme_id, &user.user_id, changes)?;
        Ok(theme_record_to_response(record))
    }

    pub fn delete_theme(&self, user: &AuthenticatedUser, theme_id: &str) -> Result<(), ApiError> {
        self.repo.delete_theme(theme_id, &user.user_id)
    }

    pub async fn autosave(
        &self,
        user: &AuthenticatedUser,
        slide_id: &str,
        bytes: &[u8],
        title: Option<&str>,
    ) -> Result<SlideMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, slide_id, "Presentation not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Presentation is in trash"));
        }

        self.drive.upload_content_bytes(slide_id, bytes)?;

        let new_title = if let Some(t) = title {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                self.drive
                    .update_file_name(user, slide_id, &trimmed)
                    .await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSlideRecord { updated_at: now };
        self.repo.update_slide(slide_id, changes)?;

        Ok(SlideMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_slide(
        &self,
        user: &AuthenticatedUser,
        slide_id: &str,
        req: SaveSlideRequest,
    ) -> Result<SlideMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, slide_id, "Presentation not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Presentation is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive
                    .update_file_name(user, slide_id, &trimmed)
                    .await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSlideRecord { updated_at: now };
        self.repo.update_slide(slide_id, changes)?;

        Ok(SlideMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    /// Promotes a raw `.pptx` Drive file into a native Neutrino presentation
    /// in place (same file id, mime type flipped). Used by the "convert on
    /// open" flow and the manual "Convert to Neutrino Slides" action.
    /// `content` is already-converted native slides JSON — no OOXML parsing
    /// happens here.
    ///
    /// Order matters for safety: content is written first while the mime
    /// type is still the office type (the safe rollback point, since if this
    /// step fails nothing has changed yet), then the mime type is flipped,
    /// then the slides row is inserted.
    pub async fn promote(
        &self,
        user: &AuthenticatedUser,
        slide_id: &str,
        content: &str,
    ) -> Result<SlideResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, slide_id, "Presentation not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Presentation is in trash"));
        }
        if file.mime_type.as_deref() != Some(OFFICE_MIME_TYPE) {
            return Err(ApiError::bad_request(
                "File is not a PowerPoint (.pptx) presentation",
            ));
        }
        if self.repo.get_slide(slide_id).is_ok() {
            return Err(ApiError::conflict("Presentation has already been promoted"));
        }

        self.drive
            .upload_content(slide_id, content, "promote_slide_content")
            .await?;
        self.drive
            .update_file_mime_type(user, slide_id, MIME_TYPE)
            .await?;

        let new_slide = NewSlideRecord { file_id: slide_id };
        self.repo.insert_slide(new_slide)?;

        let (content_url, content_write_url) = content_urls(slide_id);
        Ok(SlideResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: Utc::now().naive_utc().and_utc().to_rfc3339(),
        })
    }
}

// ── Free helpers ────────────────────────────────────────────────────────────

use crate::slides::slides::model::ThemeRecord;

fn theme_record_to_response(r: ThemeRecord) -> ThemeResponse {
    ThemeResponse {
        id: r.id,
        name: r.name,
        primary_color: r.primary_color,
        background_color: r.background_color,
        text_color: r.text_color,
        accent_color: r.accent_color,
        font_family: r.font_family,
        background_image: r.background_image,
        gradient_background: r.gradient_background,
        default_transition: r.default_transition,
        is_system: r.is_system,
        created_at: r.created_at.and_utc().to_rfc3339(),
        updated_at: r.updated_at.and_utc().to_rfc3339(),
    }
}

/// Reject obviously non-hex values to prevent garbage data in the DB.
fn validate_hex_color(value: &str, field: &str) -> Result<(), ApiError> {
    let s = value.trim();
    if s.starts_with('#')
        && (s.len() == 7 || s.len() == 4)
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        Ok(())
    } else {
        Err(ApiError::bad_request(&format!(
            "{field} must be a valid hex colour (e.g. #ff0000)"
        )))
    }
}
