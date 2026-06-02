use crate::drive::permissions::service::PermissionsService;
use crate::shared::{ApiError, AuthenticatedUser, ListQuery, ListQueryParams, OrderDirection, apply_list_query};
use crate::drive::storage::{
    dto::{
        FileMetadataResponse, FileOrderField, FileVersionResponse, ListFilesResponse,
        ListVersionsResponse, QuotaResponse, VersionOrderField,
    },
    model::{AutosaveFileContent, FileRecord, NewFileRecord, NewFileVersionRecord, UpdateFileContent},
    repository::StorageRepository,
    store::LocalFileStore,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chrono::Utc;
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

#[allow(dead_code)]
const MAX_VERSIONS: i64 = 100;

pub struct StorageService {
    repo: Arc<StorageRepository>,
    store: Arc<LocalFileStore>,
    permissions: Arc<PermissionsService>,
}

impl StorageService {
    pub fn new(
        repo: Arc<StorageRepository>,
        store: Arc<LocalFileStore>,
        permissions: Arc<PermissionsService>,
    ) -> Self {
        StorageService {
            repo,
            store,
            permissions,
        }
    }

    /// Called after a file has been streamed to `temp_path`.
    /// Enforces per-user quota and daily cap, then commits the upload.
    /// Automatically creates version 1 for the new file.
    pub async fn finalize_upload(
        &self,
        user: &AuthenticatedUser,
        temp_path: &Path,
        file_name: &str,
        mime_type: &str,
        size_bytes: i64,
        folder_id: Option<&str>,
        encrypted_metadata: Option<&str>,
    ) -> Result<FileMetadataResponse, ApiError> {
        let quota = self.repo.get_or_create_quota(&user.user_id)?;

        let now = Utc::now().naive_utc();
        let today = now.date();
        let reset_daily = quota.daily_reset_at.date() < today;
        let current_daily = if reset_daily { 0 } else { quota.daily_upload_bytes };

        if let Some(limit) = quota.quota_bytes {
            if quota.used_bytes + size_bytes > limit {
                return Err(ApiError::new(413, "QUOTA_EXCEEDED", "Storage quota exceeded"));
            }
        }
        if let Some(cap) = quota.daily_cap_bytes {
            if current_daily + size_bytes > cap {
                return Err(ApiError::new(
                    429,
                    "DAILY_LIMIT_EXCEEDED",
                    "Daily upload limit exceeded",
                ));
            }
        }

        let file_id = Uuid::new_v4().to_string();
        let final_path = self.store.file_path(&user.user_id, &file_id);
        let storage_key = self.store.file_key(&user.user_id, &file_id);

        std::fs::rename(temp_path, &final_path).map_err(|e| {
            tracing::error!("Failed to move temp file to final path: {:?}", e);
            ApiError::internal("Failed to save uploaded file")
        })?;

        let new_file = NewFileRecord {
            id: &file_id,
            user_id: &user.user_id,
            name: file_name,
            size_bytes,
            mime_type,
            storage_path: &storage_key,
            folder_id,
            encrypted_metadata,
        };

        let file = self.repo.insert_file(new_file).inspect_err(|_| {
            let _ = std::fs::remove_file(&final_path);
        })?;

        if let Err(e) = self.permissions.grant_ownership(user, "file", &file_id).await {
            tracing::error!("Failed to grant ownership for file {}: {:?}", file_id, e);
        }

        if let Err(e) = self.repo.update_quota_after_upload(
            &user.user_id,
            size_bytes,
            quota.used_bytes,
            quota.daily_upload_bytes,
            now,
            reset_daily,
        ) {
            tracing::error!("Quota update failed for user {}: {:?}", &user.user_id, e);
        }

        // Create version 1 snapshot (best-effort; failure doesn't block upload)
        self.create_version_snapshot(&user.user_id, &file_id, &final_path, size_bytes, 1, false);

        Ok(FileMetadataResponse::from(file))
    }

    /// Autosave: overwrite the file's current content without necessarily creating a version.
    /// A version snapshot is created automatically when either:
    ///   - More than 10 minutes have elapsed since the last version, or
    ///   - The content size changed by more than 50 KB.
    /// Permission check (owner/editor) must be enforced by the caller before calling this.
    pub fn autosave(
        &self,
        file_id: &str,
        temp_path: &Path,
        size_bytes: i64,
    ) -> Result<FileMetadataResponse, ApiError> {
        let file = self
            .repo
            .find_file_by_id(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let owner_id = &file.user_id;
        let main_path = self.store.file_path(owner_id, file_id);

        std::fs::rename(temp_path, &main_path).map_err(|e| {
            tracing::error!("Failed to move autosave content to main path: {:?}", e);
            ApiError::internal("Failed to autosave file")
        })?;

        let now = Utc::now().naive_utc();
        let updated = self.repo.update_file_autosave(
            file_id,
            owner_id,
            AutosaveFileContent {
                size_bytes,
                storage_path: self.store.file_key(owner_id, file_id),
                updated_at: now,
            },
        )?;

        Ok(FileMetadataResponse::from(updated))
    }

    /// Save a named version: always creates a snapshot marked is_named = true.
    /// Named versions are never pruned automatically.
    /// Permission check (owner/editor) must be enforced by the caller before calling this.
    pub fn save_named_version(
        &self,
        file_id: &str,
        temp_path: &Path,
        size_bytes: i64,
        label: Option<&str>,
    ) -> Result<FileVersionResponse, ApiError> {
        let file = self
            .repo
            .find_file_by_id(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let owner_id = &file.user_id;

        // If the file has no version history, snapshot the current content as v1 first.
        let existing_count = self.repo.count_versions(file_id)?;
        if existing_count == 0 && !file.storage_path.is_empty() {
            let current_path = self.store.resolve(&file.storage_path);
            self.create_version_snapshot(owner_id, file_id, &current_path, file.size_bytes, 1, false);
        }

        // Overwrite the main file with new content.
        let main_path = self.store.file_path(owner_id, file_id);
        std::fs::rename(temp_path, &main_path).map_err(|e| {
            tracing::error!("Failed to move named version to main path: {:?}", e);
            ApiError::internal("Failed to save named version")
        })?;

        let now = Utc::now().naive_utc();
        self.repo.update_file_content(
            file_id,
            owner_id,
            UpdateFileContent {
                size_bytes,
                storage_path: self.store.file_key(owner_id, file_id),
                updated_at: now,
            },
        )?;

        // Create the named snapshot.
        let next_num = self.repo.max_version_number(file_id)? + 1;
        let version = self.create_version_snapshot_record(
            owner_id, file_id, &main_path, size_bytes, next_num, true, label,
        )?;

        Ok(FileVersionResponse::from(version))
    }

    pub fn list_versions(
        &self,
        user_id: &str,
        file_id: &str,
        query: &ListQueryParams<VersionOrderField>,
    ) -> Result<ListVersionsResponse, ApiError> {
        self.repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let versions = self.repo.list_versions(file_id)?;
        let total = versions.len();
        let versions = apply_list_query(
            versions,
            query,
            VersionOrderField::VersionNumber,
            OrderDirection::Desc,
            |a, b, order_by| match order_by {
                VersionOrderField::VersionNumber => a.version_number.cmp(&b.version_number),
                VersionOrderField::CreatedAt => a.created_at.cmp(&b.created_at),
                VersionOrderField::Size => a.size_bytes.cmp(&b.size_bytes),
            },
        );
        Ok(ListVersionsResponse {
            versions: versions.into_iter().map(FileVersionResponse::from).collect(),
            total,
        })
    }

    pub fn get_version(
        &self,
        user_id: &str,
        file_id: &str,
        version_id: &str,
    ) -> Result<FileVersionResponse, ApiError> {
        self.repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let version = self
            .repo
            .find_version(version_id, file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        Ok(FileVersionResponse::from(version))
    }

    pub fn restore_version(
        &self,
        user_id: &str,
        file_id: &str,
        version_id: &str,
    ) -> Result<FileMetadataResponse, ApiError> {
        let current = self
            .repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let version = self
            .repo
            .find_version(version_id, file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        let main_path = self.store.file_path(user_id, file_id);

        // Snapshot the current content before restoring (best-effort)
        let next_num = self.repo.max_version_number(file_id)? + 1;
        self.create_version_snapshot(
            user_id,
            file_id,
            &self.store.resolve(&current.storage_path),
            current.size_bytes,
            next_num,
            false,
        );

        // Copy version snapshot content to the main file path
        std::fs::copy(self.store.resolve(&version.storage_path), &main_path).map_err(|e| {
            tracing::error!(
                "Failed to restore version {} to main path: {:?}",
                version_id,
                e
            );
            ApiError::internal("Failed to restore version")
        })?;

        let now = Utc::now().naive_utc();
        let updated = self.repo.update_file_content(
            file_id,
            user_id,
            UpdateFileContent {
                size_bytes: version.size_bytes,
                storage_path: self.store.file_key(user_id, file_id),
                updated_at: now,
            },
        )?;

        Ok(FileMetadataResponse::from(updated))
    }

    pub fn update_version_label(
        &self,
        user_id: &str,
        file_id: &str,
        version_id: &str,
        label: Option<String>,
    ) -> Result<FileVersionResponse, ApiError> {
        self.repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        self.repo
            .find_version(version_id, file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        let updated = self
            .repo
            .update_version_label(version_id, file_id, user_id, label)?;

        Ok(FileVersionResponse::from(updated))
    }

    pub fn delete_version(
        &self,
        user_id: &str,
        file_id: &str,
        version_id: &str,
    ) -> Result<(), ApiError> {
        self.repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let storage_key = self
            .repo
            .delete_version(version_id, file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        let abs_path = self.store.resolve(&storage_key);
        if let Err(e) = std::fs::remove_file(&abs_path) {
            tracing::warn!("Failed to remove version file {:?}: {:?}", abs_path, e);
        }

        Ok(())
    }

    pub fn list_files(
        &self,
        user_id: &str,
        query: &ListQuery<FileOrderField>,
    ) -> Result<ListFilesResponse, ApiError> {
        let files = self.repo.list_files_by_user(user_id, query)?;
        let total = files.len();
        Ok(ListFilesResponse {
            files: files.into_iter().map(FileMetadataResponse::from).collect(),
            total,
            limit: query.limit,
            offset: query.offset,
        })
    }

    pub fn get_file_metadata(
        &self,
        user_id: &str,
        file_id: &str,
    ) -> Result<FileMetadataResponse, ApiError> {
        let file = self
            .repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;
        Ok(FileMetadataResponse::from(file))
    }

    /// Returns the absolute filesystem path for serving the file.
    #[allow(dead_code)]
    pub fn resolve_file_path(
        &self,
        user_id: &str,
        file_id: &str,
    ) -> Result<(std::path::PathBuf, String, String), ApiError> {
        let file = self
            .repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;
        Ok((
            self.store.resolve(&file.storage_path),
            file.mime_type,
            file.name,
        ))
    }

    /// Resolve a file path without an authenticated user (public share link).
    pub fn resolve_file_path_by_id(
        &self,
        file_id: &str,
    ) -> Result<(std::path::PathBuf, String, String), ApiError> {
        let file = self
            .repo
            .find_file_by_id(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;
        Ok((
            self.store.resolve(&file.storage_path),
            file.mime_type,
            file.name,
        ))
    }

    pub fn get_quota(&self, user_id: &str) -> Result<QuotaResponse, ApiError> {
        let quota = self.repo.get_or_create_quota(user_id)?;
        Ok(QuotaResponse {
            used_bytes: quota.used_bytes,
            daily_upload_bytes: quota.daily_upload_bytes,
            quota_bytes: quota.quota_bytes,
            daily_cap_bytes: quota.daily_cap_bytes,
        })
    }

    pub fn store(&self) -> &LocalFileStore {
        &self.store
    }

    pub async fn save_file(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        name: &str,
        mime_type: &str,
        folder_id: Option<&str>,
    ) -> Result<FileRecord, ApiError> {
        let new_file = NewFileRecord {
            id: file_id,
            user_id: &user.user_id,
            name,
            size_bytes: 0,
            mime_type,
            storage_path: "",
            folder_id,
            encrypted_metadata: None,
        };
        let file = self.repo.insert_file(new_file)?;
        if let Err(e) = self.permissions.grant_ownership(user, "file", file_id).await {
            tracing::error!("Failed to grant ownership for doc {}: {:?}", file_id, e);
        }
        Ok(file)
    }

    pub fn find_file_any_user(&self, file_id: &str) -> Result<Option<FileRecord>, ApiError> {
        self.repo.find_file_by_id(file_id)
    }

    /// Decode an image file, resize it to fit within 512×512, and return base64 JPEG + MIME type.
    /// Returns None if the file cannot be decoded (e.g. unsupported format or encrypted).
    #[allow(dead_code)]
    pub fn generate_image_thumbnail(path: &Path) -> Option<(String, String)> {
        let img = image::open(path).ok()?;
        let thumb = img.thumbnail(512, 512);
        let mut buf: Vec<u8> = Vec::new();
        thumb.write_to(
            &mut std::io::Cursor::new(&mut buf),
            image::ImageFormat::Jpeg,
        ).ok()?;
        Some((BASE64.encode(&buf), "image/jpeg".to_string()))
    }

    pub fn set_cover_thumbnail(
        &self,
        file_id: &str,
        thumbnail: String,
        mime_type: String,
    ) -> Result<(), ApiError> {
        self.repo.set_cover_thumbnail(file_id, thumbnail, mime_type)
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /// Copies `source` to a new version snapshot and inserts the DB record.
    /// Best-effort: logs errors but does not propagate them.
    fn create_version_snapshot(
        &self,
        user_id: &str,
        file_id: &str,
        source: &Path,
        size_bytes: i64,
        version_number: i32,
        is_named: bool,
    ) {
        if let Err(e) = self.create_version_snapshot_record(
            user_id,
            file_id,
            source,
            size_bytes,
            version_number,
            is_named,
            None,
        ) {
            tracing::error!(
                "Failed to create version {} snapshot for file {}: {:?}",
                version_number,
                file_id,
                e
            );
        }
    }

    fn create_version_snapshot_record(
        &self,
        user_id: &str,
        file_id: &str,
        source: &Path,
        size_bytes: i64,
        version_number: i32,
        is_named: bool,
        label: Option<&str>,
    ) -> Result<crate::drive::storage::model::FileVersionRecord, ApiError> {
        if let Err(e) = self.store.ensure_versions_dir(user_id, file_id) {
            return Err(ApiError::internal(e));
        }

        let version_id = Uuid::new_v4().to_string();
        let version_abs_path = self.store.version_path(user_id, file_id, &version_id);
        let version_key = self.store.version_key(user_id, file_id, &version_id);

        std::fs::copy(source, &version_abs_path).map_err(|e| {
            tracing::error!("Failed to copy file to version snapshot: {:?}", e);
            ApiError::internal("Failed to create version snapshot")
        })?;

        self.repo.insert_version(NewFileVersionRecord {
            id: &version_id,
            file_id,
            user_id,
            version_number,
            size_bytes,
            storage_path: &version_key,
            label,
            is_named,
        })
    }
}
