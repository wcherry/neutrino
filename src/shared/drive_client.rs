use std::sync::Arc;

use chrono::NaiveDateTime;

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
    /// Server-side content revision. Clients echo it back on their next save so
    /// a stale write is rejected — see `shared::content_version`.
    pub content_version: i32,
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
    pub content_version: i32,
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
        content_version: file.content_version,
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

    /// Lists every file type the user owns (no `mimeType` filter) — used by
    /// the links resolver, which must match wiki-link titles against files
    /// of any type, not just one app's own MIME type.
    pub async fn list_all_files(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<Vec<DriveListItem>, ApiError> {
        let query = ListQuery {
            limit: 200,
            offset: 0,
            order_by: None::<FileOrderField>,
            direction: None,
            filters: std::collections::HashMap::new(),
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
                content_version: f.content_version,
            })
            .collect())
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

    /// Removes a file for good — the row and the bytes on disk.
    ///
    /// What a permanently deleted photograph needs, as opposed to a trash: a photo purged from
    /// the Photos trash would otherwise leave its blob sitting on the user's quota with nothing
    /// left pointing at it. Trashing first is not a formality — `permanently_delete_file` only
    /// matches a row whose `deleted_at` is set, so a file that was still live would otherwise be
    /// a silent no-op.
    ///
    /// Idempotent: a file already gone is `Ok(())`, since the caller's goal is that it not exist.
    pub fn delete_file_permanently(&self, file_id: &str) -> Result<(), ApiError> {
        let Some(file) = self.storage.find_file_any_user(file_id)? else {
            return Ok(());
        };
        let user_id = file.user_id.clone();
        self.fs_repo.trash_file(file_id, &user_id)?;

        if let Some(record) = self.fs_repo.permanently_delete_file(file_id, &user_id)? {
            let path = self.storage.store().resolve(&record.storage_path);
            if let Err(e) = std::fs::remove_file(&path) {
                // The row is already gone, so the file is unreachable either way. Logged rather
                // than returned: failing here would leave the caller believing the delete did not
                // happen, and retrying it would find nothing to delete.
                tracing::warn!("Failed to remove file from disk {:?}: {:?}", path, e);
            }
        }
        Ok(())
    }
}
