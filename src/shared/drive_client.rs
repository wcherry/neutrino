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
