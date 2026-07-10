use crate::shared::{ApiError, AuthenticatedUser};
use crate::sheets::sheets::{
    dto::{
        CreateSheetRequest, ListSheetsResponse, SaveSheetRequest, SheetMetaResponse, SheetResponse,
    },
    model::{NewSheetRecord, UpdateSheetRecord},
    repository::SheetsRepository,
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
        let (content_url, versions_url) = content_urls("file-abc");
        assert_eq!(content_url, "/api/v1/drive/files/file-abc");
        assert_eq!(versions_url, "/api/v1/drive/files/file-abc/versions");
    }

    #[test]
    fn mime_type_constant_is_correct() {
        assert_eq!(MIME_TYPE, "application/x-neutrino-sheet");
    }

    #[test]
    fn empty_sheet_content_is_valid_json() {
        let result = serde_json::from_str::<serde_json::Value>(EMPTY_SHEET_CONTENT);
        assert!(
            result.is_ok(),
            "EMPTY_SHEET_CONTENT should be valid JSON: {:?}",
            result.err()
        );
    }

    #[test]
    fn empty_sheet_content_is_array_with_one_sheet() {
        let parsed: serde_json::Value = serde_json::from_str(EMPTY_SHEET_CONTENT).unwrap();
        assert!(parsed.is_array(), "Sheet content should be a JSON array");
        assert_eq!(parsed.as_array().unwrap().len(), 1);
    }

    #[test]
    fn empty_sheet_has_name_and_celldata() {
        let parsed: serde_json::Value = serde_json::from_str(EMPTY_SHEET_CONTENT).unwrap();
        let sheet = &parsed[0];
        assert!(sheet["name"].is_string(), "Sheet should have a name");
        assert!(
            sheet["celldata"].is_array(),
            "Sheet should have celldata array"
        );
    }

    // ── promote (issue #43 — in-place editing of MS Office docs) ─────────────
    //
    // `SheetsService::promote` does not exist yet (TDD red phase). Mirrors
    // the contract tested for docs::docs::service::promote: validates file
    // existence/edit-access/mime type, rejects an already-promoted file,
    // uploads content + flips mime type + inserts the sheets row on success,
    // and gives a viewer a clean 403. These tests reference `promote`
    // directly, so this file (and the crate) will fail to *compile* until it
    // exists — the expected/normal shape of Rust TDD red phase for a method
    // that doesn't exist yet. Run with
    // `cargo test --lib sheets::sheets::service::tests`.

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

    const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const OTHER_MIME: &str = "text/plain";
    const PROMOTE_CONTENT: &str = EMPTY_SHEET_CONTENT;

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
        sheets_service: SheetsService,
        storage_repo: StorageRepository,
        sheets_repo: SheetsRepository,
        permissions_repo: PermissionsRepository,
        base_dir: PathBuf,
    }

    fn build_promote_harness() -> PromoteHarness {
        let pool = promote_test_pool();
        let base = std::env::temp_dir().join(format!("neutrino_sheets_promote_test_{}", uuid::Uuid::new_v4()));
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

        let sheets_repo_for_assertions = SheetsRepository::new(pool.clone());
        let sheets_repo = Arc::new(SheetsRepository::new(pool));
        let sheets_service = SheetsService::new(sheets_repo, drive_client);

        PromoteHarness {
            sheets_service,
            storage_repo: storage_repo_for_assertions,
            sheets_repo: sheets_repo_for_assertions,
            permissions_repo: permissions_repo_for_assertions,
            base_dir: base,
        }
    }

    fn insert_office_file(repo: &StorageRepository, id: &str, owner_id: &str, mime_type: &str) {
        repo.insert_file(NewFileRecord {
            id,
            user_id: owner_id,
            name: "budget.xlsx",
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
    async fn promote_succeeds_for_the_owner_of_a_raw_xlsx_file() {
        let h = build_promote_harness();
        let owner = promote_test_user("owner-1");
        insert_office_file(&h.storage_repo, "sheet-1", &owner.user_id, XLSX_MIME);
        grant_role(&h.permissions_repo, "sheet-1", &owner.user_id, "owner");

        let result = h
            .sheets_service
            .promote(&owner, "sheet-1", PROMOTE_CONTENT)
            .await
            .expect("promote should succeed for the owner of a raw xlsx file");

        assert_eq!(result.id, "sheet-1");
        let file = h.storage_repo.find_file_by_id("sheet-1").unwrap().unwrap();
        assert_eq!(file.mime_type, MIME_TYPE);
        assert!(h.sheets_repo.get_sheet("sheet-1").is_ok());
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_succeeds_for_a_non_owner_with_edit_access() {
        let h = build_promote_harness();
        insert_office_file(&h.storage_repo, "sheet-2", "owner-1", XLSX_MIME);
        grant_role(&h.permissions_repo, "sheet-2", "owner-1", "owner");
        let editor = promote_test_user("editor-1");
        grant_role(&h.permissions_repo, "sheet-2", &editor.user_id, "editor");

        let result = h.sheets_service.promote(&editor, "sheet-2", PROMOTE_CONTENT).await;

        assert!(
            result.is_ok(),
            "a non-owner editor should be able to promote the file: {:?}",
            result.err()
        );
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_rejects_when_a_sheets_row_already_exists() {
        let h = build_promote_harness();
        let owner = promote_test_user("owner-1");
        insert_office_file(&h.storage_repo, "sheet-3", &owner.user_id, XLSX_MIME);
        grant_role(&h.permissions_repo, "sheet-3", &owner.user_id, "owner");
        h.sheets_repo
            .insert_sheet(NewSheetRecord { file_id: "sheet-3" })
            .expect("pre-insert sheets row to simulate an already-promoted file");

        let result = h.sheets_service.promote(&owner, "sheet-3", PROMOTE_CONTENT).await;

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
        insert_office_file(&h.storage_repo, "sheet-4", &owner.user_id, OTHER_MIME);
        grant_role(&h.permissions_repo, "sheet-4", &owner.user_id, "owner");

        let result = h.sheets_service.promote(&owner, "sheet-4", PROMOTE_CONTENT).await;

        assert!(
            result.is_err(),
            "promote must reject a file whose mime type is not the expected office type"
        );
        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn promote_gives_a_viewer_a_clean_403_not_a_corrupted_write() {
        let h = build_promote_harness();
        insert_office_file(&h.storage_repo, "sheet-5", "owner-1", XLSX_MIME);
        grant_role(&h.permissions_repo, "sheet-5", "owner-1", "owner");
        let viewer = promote_test_user("viewer-1");
        grant_role(&h.permissions_repo, "sheet-5", &viewer.user_id, "viewer");

        let result = h.sheets_service.promote(&viewer, "sheet-5", PROMOTE_CONTENT).await;

        let err = result.expect_err("a viewer must not be able to promote the file");
        assert_eq!(err.status, 403);
        let file = h.storage_repo.find_file_by_id("sheet-5").unwrap().unwrap();
        assert_eq!(file.mime_type, XLSX_MIME);
        assert!(h.sheets_repo.get_sheet("sheet-5").is_err());
        let _ = std::fs::remove_dir_all(h.base_dir);
    }
}
use crate::shared::drive_client::DriveClient;
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// Default empty FortuneSheet workbook: one sheet named "Sheet1".
const EMPTY_SHEET_CONTENT: &str = r#"[{"index":"0","name":"Sheet1","celldata":[],"row":100,"column":26,"order":0,"status":1,"config":{}}]"#;
const MIME_TYPE: &str = "application/x-neutrino-sheet";
const OFFICE_MIME_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

pub struct SheetsService {
    repo: Arc<SheetsRepository>,
    drive: Arc<DriveClient>,
}

impl SheetsService {
    pub fn new(repo: Arc<SheetsRepository>, drive: Arc<DriveClient>) -> Self {
        SheetsService { repo, drive }
    }

    pub async fn list_sheets(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListSheetsResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let sheets = items
            .into_iter()
            .map(|item| SheetMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
            })
            .collect();
        Ok(ListSheetsResponse { sheets })
    }

    pub async fn create_sheet(
        &self,
        user: &AuthenticatedUser,
        req: CreateSheetRequest,
    ) -> Result<SheetResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Spreadsheet title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;
        let new_sheet = NewSheetRecord { file_id: &id };
        self.repo.insert_sheet(new_sheet)?;

        self.drive
            .upload_content(&id, EMPTY_SHEET_CONTENT, "upload_sheet_content")
            .await?;

        let (content_url, content_write_url) = content_urls(&id);
        Ok(SheetResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
            your_role: file.your_role,
        })
    }

    pub async fn get_sheet(
        &self,
        user: &AuthenticatedUser,
        sheet_id: &str,
    ) -> Result<SheetResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, sheet_id, "Spreadsheet not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }
        self.repo.get_sheet(sheet_id)?;
        let (content_url, content_write_url) = content_urls(sheet_id);
        Ok(SheetResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
            your_role: file.your_role,
        })
    }

    pub async fn autosave(
        &self,
        user: &AuthenticatedUser,
        sheet_id: &str,
        bytes: &[u8],
        title: Option<&str>,
    ) -> Result<SheetMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, sheet_id, "Spreadsheet not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }

        self.drive.upload_content_bytes(sheet_id, bytes)?;

        let new_title = if let Some(t) = title {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                self.drive
                    .update_file_name(user, sheet_id, &trimmed)
                    .await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSheetRecord { updated_at: now };
        self.repo.update_sheet(sheet_id, changes)?;

        Ok(SheetMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_sheet(
        &self,
        user: &AuthenticatedUser,
        sheet_id: &str,
        req: SaveSheetRequest,
    ) -> Result<SheetMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, sheet_id, "Spreadsheet not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive
                    .update_file_name(user, sheet_id, &trimmed)
                    .await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSheetRecord { updated_at: now };
        self.repo.update_sheet(sheet_id, changes)?;

        Ok(SheetMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    /// Promotes a raw `.xlsx` Drive file into a native Neutrino sheet in
    /// place (same file id, mime type flipped). Used by the "convert on
    /// open" flow and the manual "Convert to Neutrino Sheet" action.
    /// `content` is already-converted native sheet JSON — no OOXML parsing
    /// happens here.
    ///
    /// Order matters for safety: content is written first while the mime
    /// type is still the office type (the safe rollback point, since if this
    /// step fails nothing has changed yet), then the mime type is flipped,
    /// then the sheets row is inserted.
    pub async fn promote(
        &self,
        user: &AuthenticatedUser,
        sheet_id: &str,
        content: &str,
    ) -> Result<SheetResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, sheet_id, "Spreadsheet not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }
        if file.mime_type.as_deref() != Some(OFFICE_MIME_TYPE) {
            return Err(ApiError::bad_request(
                "File is not an Excel (.xlsx) spreadsheet",
            ));
        }
        if self.repo.get_sheet(sheet_id).is_ok() {
            return Err(ApiError::conflict("Spreadsheet has already been promoted"));
        }

        self.drive
            .upload_content(sheet_id, content, "promote_sheet_content")
            .await?;
        self.drive
            .update_file_mime_type(user, sheet_id, MIME_TYPE)
            .await?;

        let new_sheet = NewSheetRecord { file_id: sheet_id };
        self.repo.insert_sheet(new_sheet)?;

        let (content_url, content_write_url) = content_urls(sheet_id);
        Ok(SheetResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: Utc::now().naive_utc().and_utc().to_rfc3339(),
            your_role: file.your_role,
        })
    }
}
