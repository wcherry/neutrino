use std::sync::Arc;

use chrono::NaiveDateTime;
use uuid::Uuid;

use crate::drive::filesystem::repository::FilesystemRepository;
use crate::drive::permissions::service::PermissionsService;
use crate::drive::storage::dto::FileOrderField;
use crate::drive::storage::model::FileRecord;
use crate::drive::storage::service::StorageService;
use crate::shared::{ApiError, AuthenticatedUser, ListQuery};

#[derive(Debug)]
pub struct DriveListItem {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct DriveFileRecord {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
    pub your_role: String,
    pub storage_path: Option<String>,
    pub mime_type: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
}

fn to_drive_record(file: FileRecord, role: String) -> DriveFileRecord {
    DriveFileRecord {
        id: file.id,
        name: file.name,
        size_bytes: file.size_bytes,
        folder_id: file.folder_id,
        deleted_at: file.deleted_at,
        your_role: role,
        storage_path: if file.storage_path.is_empty() {
            None
        } else {
            Some(file.storage_path)
        },
        mime_type: if file.mime_type.is_empty() {
            None
        } else {
            Some(file.mime_type)
        },
        created_at: file.created_at,
        updated_at: file.updated_at,
        cover_thumbnail: file.cover_thumbnail,
        cover_thumbnail_mime_type: file.cover_thumbnail_mime_type,
    }
}

pub struct DriveClient {
    storage: Arc<StorageService>,
    permissions: Arc<PermissionsService>,
    fs_repo: Arc<FilesystemRepository>,
}

impl DriveClient {
    pub fn new(
        storage: Arc<StorageService>,
        permissions: Arc<PermissionsService>,
        fs_repo: Arc<FilesystemRepository>,
    ) -> Self {
        DriveClient {
            storage,
            permissions,
            fs_repo,
        }
    }

    pub async fn list_files(
        &self,
        user: &AuthenticatedUser,
        mime_type: &str,
    ) -> Result<Vec<DriveListItem>, ApiError> {
        let mut filters = std::collections::HashMap::new();
        filters.insert("mimeType".to_string(), mime_type.to_string());
        let query = ListQuery {
            limit: 200,
            offset: 0,
            order_by: None::<FileOrderField>,
            direction: None,
            filters,
        };
        let resp = self.storage.list_files(&user.user_id, &query)?;
        Ok(resp
            .files
            .into_iter()
            .map(|f| DriveListItem {
                id: f.id,
                name: f.name,
                folder_id: f.folder_id,
                created_at: f.created_at,
                updated_at: f.updated_at,
            })
            .collect())
    }

    pub async fn create_file(
        &self,
        user: &AuthenticatedUser,
        id: &str,
        name: &str,
        mime_type: &str,
        folder_id: Option<&str>,
    ) -> Result<DriveFileRecord, ApiError> {
        let file = self
            .storage
            .save_file(user, id, name, mime_type, folder_id)
            .await?;
        Ok(to_drive_record(file, "owner".to_string()))
    }

    pub async fn get_file(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        not_found_msg: &str,
    ) -> Result<DriveFileRecord, ApiError> {
        let file = self
            .storage
            .find_file_any_user(file_id)?
            .ok_or_else(|| ApiError::not_found(not_found_msg))?;
        let role = self
            .permissions
            .get_effective_role(&user.user_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
        Ok(to_drive_record(file, role))
    }

    pub async fn get_content(
        &self,
        file_id: &str,
        not_found_msg: &str,
    ) -> Result<String, ApiError> {
        let file = self
            .storage
            .find_file_any_user(file_id)?
            .ok_or_else(|| ApiError::not_found(not_found_msg))?;

        if file.storage_path.is_empty() {
            return Ok(String::new());
        }

        let path = self.storage.store().resolve(&file.storage_path);
        std::fs::read_to_string(&path).map_err(|e| {
            tracing::error!("Failed to read file {:?}: {:?}", path, e);
            ApiError::internal("Failed to read file content")
        })
    }

    pub async fn upload_content(
        &self,
        file_id: &str,
        content: &str,
        label: &str,
    ) -> Result<(), ApiError> {
        let file = self
            .storage
            .find_file_any_user(file_id)?
            .ok_or_else(|| ApiError::internal("File not found for upload"))?;

        let store = self.storage.store();
        store.ensure_user_dir(&file.user_id).map_err(|e| {
            tracing::error!("Drive client {} dir error: {}", label, e);
            ApiError::internal("Failed to prepare storage directory")
        })?;

        let temp_id = Uuid::new_v4().to_string();
        let temp_path = store.temp_path(&file.user_id, &temp_id);

        std::fs::write(&temp_path, content.as_bytes()).map_err(|e| {
            tracing::error!("Drive client {} write error: {:?}", label, e);
            ApiError::internal("Failed to write file content")
        })?;

        let size_bytes = content.len() as i64;
        self.storage
            .autosave(file_id, &temp_path, size_bytes)
            .map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                e
            })?;

        Ok(())
    }

    pub async fn update_file_name(
        &self,
        _user: &AuthenticatedUser,
        file_id: &str,
        name: &str,
    ) -> Result<(), ApiError> {
        // The file's user_id in the DB is always the owner's, not the current
        // user's. For shared files the caller has already verified edit permission,
        // so we must look up the owner id to satisfy the repository's filter.
        let file = self
            .storage
            .find_file_any_user(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;
        self.fs_repo
            .update_file(file_id, &file.user_id, Some(name), None, None)?;
        Ok(())
    }

    /// Flips a file's stored mime type (used by the per-app `promote` flow to
    /// convert a raw office file into a native Neutrino doc/sheet/slide once
    /// its content has already been rewritten in the native format).
    /// Mime type is a content-lifecycle concern, so this delegates to the
    /// storage layer (`StorageService::update_mime_type`) rather than
    /// `fs_repo`, which owns filesystem metadata like name/folder/star.
    /// Caller edit-permission must already be verified by the caller (same
    /// contract as `update_file_name` above).
    pub async fn update_file_mime_type(
        &self,
        _user: &AuthenticatedUser,
        file_id: &str,
        mime_type: &str,
    ) -> Result<(), ApiError> {
        self.storage.update_mime_type(file_id, mime_type)?;
        Ok(())
    }

    pub fn delete_file(&self, file_id: &str) -> Result<(), ApiError> {
        let file = self
            .storage
            .find_file_any_user(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;
        self.fs_repo.trash_file(file_id, &file.user_id)?;
        Ok(())
    }

    /// Autosave raw bytes as the file's current content without creating a version snapshot.
    /// Used by per-app autosave endpoints that receive multipart binary data.
    pub fn upload_content_bytes(&self, file_id: &str, bytes: &[u8]) -> Result<(), ApiError> {
        let file = self
            .storage
            .find_file_any_user(file_id)?
            .ok_or_else(|| ApiError::internal("File not found"))?;
        let store = self.storage.store();
        store.ensure_user_dir(&file.user_id).map_err(|e| {
            tracing::error!("upload_content_bytes dir error: {:?}", e);
            ApiError::internal("Failed to prepare storage directory")
        })?;
        let temp_id = Uuid::new_v4().to_string();
        let temp_path = store.temp_path(&file.user_id, &temp_id);
        std::fs::write(&temp_path, bytes).map_err(|e| {
            tracing::error!("upload_content_bytes write error: {:?}", e);
            ApiError::internal("Failed to write content")
        })?;
        let size_bytes = bytes.len() as i64;
        self.storage
            .autosave(file_id, &temp_path, size_bytes)
            .map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                e
            })?;
        Ok(())
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────
//
// Covers `DriveClient::update_file_mime_type` (issue #43 — in-place editing of
// MS Office docs), the top of the chain used by the per-app `promote` service
// methods to flip a raw office file's mimetype to the matching native
// Neutrino type. Per the plan this resolves the file's owner first (same
// "resolve owner, then mutate" shape as `update_file_name` above) and then
// delegates to the storage layer (`StorageService::update_mime_type` /
// `StorageRepository::update_file_mime_type`) rather than the filesystem repo,
// since mime type is a content-lifecycle concern.
//
// `update_file_mime_type` does not exist yet (TDD red phase) — referencing it
// here means this file (and the crate) will fail to *compile* until it's
// implemented, which is the expected/normal shape of Rust TDD red phase for a
// method that doesn't exist yet. Run with
// `cargo test --lib shared::drive_client::tests`.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{repository::AuthRepository, service::AuthService};
    use crate::drive::encryption::repository::EncryptionRepository;
    use crate::drive::permissions::repository::PermissionsRepository;
    use crate::drive::storage::model::NewFileRecord;
    use crate::drive::storage::repository::StorageRepository;
    use crate::drive::storage::store::LocalFileStore;
    use crate::drive::workspace::{repository::WorkspaceRepository, service::WorkspaceService};
    use crate::shared::TokenService;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;
    use std::path::PathBuf;

    const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const NATIVE_DOC_MIME: &str = "application/x-neutrino-doc";

    fn test_pool() -> crate::drive::storage::repository::DbPool {
        use crate::MIGRATIONS;
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn test_user(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
    }

    /// Builds a real DriveClient (storage + permissions + filesystem repo),
    /// backed by an in-memory sqlite DB and a scratch directory on disk —
    /// the same dependency wiring as main.rs, minus the HTTP layer.
    fn test_drive_client() -> (DriveClient, StorageRepository, PermissionsRepository, PathBuf) {
        let pool = test_pool();
        let base = std::env::temp_dir().join(format!("neutrino_drive_client_test_{}", uuid::Uuid::new_v4()));
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
        let storage_service = Arc::new(StorageService::new(storage_repo, store, permissions_service.clone()));
        let fs_repo = Arc::new(FilesystemRepository::new(pool));

        let client = DriveClient::new(storage_service, permissions_service, fs_repo);
        (client, storage_repo_for_assertions, permissions_repo_for_assertions, base)
    }

    fn insert_test_file(repo: &StorageRepository, id: &str, user_id: &str, mime_type: &str) -> FileRecord {
        repo.insert_file(NewFileRecord {
            id,
            user_id,
            name: "report.docx",
            size_bytes: 0,
            mime_type,
            storage_path: "",
            folder_id: None,
            encrypted_metadata: None,
        })
        .expect("insert file")
    }

    #[tokio::test]
    async fn update_file_mime_type_flips_the_stored_mime_type() {
        let (client, storage_repo, _perms, base) = test_drive_client();
        let owner = test_user("owner-1");
        insert_test_file(&storage_repo, "file-1", &owner.user_id, DOCX_MIME);

        client
            .update_file_mime_type(&owner, "file-1", NATIVE_DOC_MIME)
            .await
            .expect("update mime type");

        let updated = storage_repo
            .find_file_by_id("file-1")
            .expect("find file")
            .expect("file exists");
        assert_eq!(updated.mime_type, NATIVE_DOC_MIME);
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn update_file_mime_type_resolves_the_owner_for_a_shared_editor_caller() {
        // Mirrors update_file_name's comment: the file's user_id in the DB is
        // always the owner's, not necessarily the current caller's. A caller
        // who only has edit access (not ownership) must still be able to
        // flip the mime type — resolution must go through find_file_any_user,
        // not assume caller.user_id == file owner.
        let (client, storage_repo, _perms, base) = test_drive_client();
        insert_test_file(&storage_repo, "file-2", "owner-1", DOCX_MIME);
        let editor = test_user("editor-1");

        client
            .update_file_mime_type(&editor, "file-2", NATIVE_DOC_MIME)
            .await
            .expect("update mime type for a non-owner caller with edit access");

        let updated = storage_repo
            .find_file_by_id("file-2")
            .expect("find file")
            .expect("file exists");
        assert_eq!(updated.mime_type, NATIVE_DOC_MIME);
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn update_file_mime_type_on_unknown_file_returns_not_found() {
        let (client, _storage_repo, _perms, base) = test_drive_client();
        let user = test_user("user-1");

        let result = client
            .update_file_mime_type(&user, "does-not-exist", NATIVE_DOC_MIME)
            .await;

        assert!(result.is_err());
        assert_eq!(result.unwrap_err().status, 404);
        let _ = std::fs::remove_dir_all(base);
    }
}
