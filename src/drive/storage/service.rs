use crate::drive::permissions::service::PermissionsService;
use crate::drive::storage::{
    dto::{
        parse_import_timestamp, FileMetadataResponse, FileOrderField, FileVersionResponse,
        ImportMetadataRequest, ListFilesResponse, ListVersionsResponse, QuotaResponse,
        VersionOrderField,
    },
    model::{
        AutosaveFileContent, FileRecord, ImportProvenance, NewFileRecord, NewFileVersionRecord,
        UpdateFileContent,
    },
    repository::StorageRepository,
    store::{LocalFileStore, ServeResolveError},
};
use crate::shared::{
    apply_list_query, ApiError, AuthenticatedUser, ContentVersionCheck, ListQuery, ListQueryParams,
    OrderDirection,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chrono::Utc;
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

#[allow(dead_code)]
const MAX_VERSIONS: i64 = 100;

/// Map a path-resolution failure to a client error instead of handing a
/// directory (or the storage root) to the file streamer, which crashes the
/// actix response stream with `IsADirectory (Os code 21)`.
///
/// `Missing` gets its own code: unlike the other two — which mean content was
/// never uploaded — it means the file row outlived its blob, and reporting that
/// as `NO_CONTENT` would tell a syncing client to expect bytes that will never
/// arrive. Both stay 409 (the file resource exists; only its content doesn't).
/// `Missing` is also logged with its key, since an orphaned row is an operator
/// problem that no amount of client retrying will fix.
fn no_content_error(err: ServeResolveError, key: &str) -> ApiError {
    match err {
        ServeResolveError::Missing => {
            tracing::warn!(
                "Storage blob missing for key {:?}; file row is orphaned",
                key
            );
            ApiError::new(
                409,
                "CONTENT_MISSING",
                "File content is missing from storage",
            )
        }
        ServeResolveError::EmptyKey | ServeResolveError::IsDirectory => {
            ApiError::new(409, "NO_CONTENT", "File has no uploaded content")
        }
    }
}

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
        let current_daily = if reset_daily {
            0
        } else {
            quota.daily_upload_bytes
        };

        if let Some(limit) = quota.quota_bytes {
            // Derived, not read off the row: the stored counter only ever
            // counted uploaded file bytes, so it under-reported by every
            // version snapshot and never shrank on delete.
            let used_bytes = self
                .repo
                .refresh_used_bytes(&user.user_id, quota.used_bytes)?;
            if used_bytes + size_bytes > limit {
                return Err(ApiError::new(
                    413,
                    "QUOTA_EXCEEDED",
                    "Storage quota exceeded",
                ));
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

        if let Err(e) = self
            .permissions
            .grant_ownership(user, "file", &file_id)
            .await
        {
            let _ = std::fs::remove_file(&final_path);
            return Err(e);
        }

        if let Err(e) = self.repo.record_daily_upload(
            &user.user_id,
            size_bytes,
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
    ///
    /// `check` carries the client's optimistic-concurrency guard; pass
    /// `ContentVersionCheck::UNCHECKED` for writes with no client-held version.
    /// A rejected check fails with 409 and leaves the stored content alone.
    pub fn autosave(
        &self,
        file_id: &str,
        temp_path: &Path,
        size_bytes: i64,
        check: ContentVersionCheck,
    ) -> Result<FileMetadataResponse, ApiError> {
        let file = self
            .repo
            .find_file_by_id(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        // Reject before touching the filesystem. Renaming first and rolling
        // back on a 409 would leave a window where the file on disk and the
        // version in the database disagree, which is what other readers use to
        // decide their copy is current.
        if let Some(expected) = check.enforced() {
            if file.content_version != expected {
                return Err(crate::shared::content_version::conflict_error(
                    file_id,
                    expected,
                    file.content_version,
                ));
            }
        }

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
            check,
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
            self.create_version_snapshot(
                owner_id,
                file_id,
                &current_path,
                file.size_bytes,
                1,
                false,
            );
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
            versions: versions
                .into_iter()
                .map(FileVersionResponse::from)
                .collect(),
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

    /// Returns the absolute filesystem path for serving a specific version's content.
    pub fn resolve_version_path(
        &self,
        user_id: &str,
        file_id: &str,
        version_id: &str,
    ) -> Result<(std::path::PathBuf, String, String), ApiError> {
        self.repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let version = self
            .repo
            .find_version(version_id, file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        let path = self
            .store
            .resolve_for_serving(&version.storage_path)
            .map_err(|e| no_content_error(e, &version.storage_path))?;
        Ok((
            path,
            "application/json".to_string(),
            format!("version-{}.json", version.version_number),
        ))
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

    /// Give an imported file back the dates its source file had, and record
    /// where they came from.
    ///
    /// Called once per file by an import run, after the content write — the
    /// write is what stamps `updated_at` with the current time, so anything
    /// set before it would not survive.
    ///
    /// Scoped to the owner rather than to any role that can edit the file: a
    /// date rewrite is not an edit, and an importer only ever writes files it
    /// has just created itself.
    pub fn apply_import_metadata(
        &self,
        user_id: &str,
        file_id: &str,
        request: ImportMetadataRequest,
    ) -> Result<FileMetadataResponse, ApiError> {
        let import_source = request.import_source.trim().to_string();
        if import_source.is_empty() {
            return Err(ApiError::bad_request("importSource cannot be empty"));
        }

        let created_at = request
            .created_at
            .as_deref()
            .map(parse_import_timestamp)
            .transpose()?;
        let updated_at = request
            .updated_at
            .as_deref()
            .map(parse_import_timestamp)
            .transpose()?;
        let imported_at = match request.imported_at.as_deref() {
            Some(value) => parse_import_timestamp(value)?,
            None => Utc::now().naive_utc(),
        };

        let updated = self.repo.apply_import_provenance(
            file_id,
            user_id,
            ImportProvenance {
                created_at,
                updated_at,
                imported_at,
                import_source,
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
        let path = self
            .store
            .resolve_for_serving(&file.storage_path)
            .map_err(|e| no_content_error(e, &file.storage_path))?;
        Ok((path, file.mime_type, file.name))
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
        let path = self
            .store
            .resolve_for_serving(&file.storage_path)
            .map_err(|e| no_content_error(e, &file.storage_path))?;
        Ok((path, file.mime_type, file.name))
    }

    /// Current occupancy and limits for a user.
    ///
    /// `used_bytes` is recomputed from the file and version rows on every read
    /// rather than trusted from the quota row, which self-heals stores whose
    /// counter drifted while it was maintained by hand (#101).
    pub fn get_quota(&self, user_id: &str) -> Result<QuotaResponse, ApiError> {
        let quota = self.repo.get_or_create_quota(user_id)?;
        let used_bytes = self.repo.refresh_used_bytes(user_id, quota.used_bytes)?;
        Ok(QuotaResponse {
            used_bytes,
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
        self.permissions
            .grant_ownership(user, "file", file_id)
            .await?;
        Ok(file)
    }

    pub fn find_file_any_user(&self, file_id: &str) -> Result<Option<FileRecord>, ApiError> {
        self.repo.find_file_by_id(file_id)
    }

    /// Flips a file's stored mime type (used by the per-app `promote` flow).
    /// Resolves the file's owner first, the same "resolve owner, then
    /// mutate" shape used by `autosave`/`restore_version` above, since the
    /// repository's update is scoped to the owning `user_id`.
    pub fn update_mime_type(&self, file_id: &str, mime_type: &str) -> Result<FileRecord, ApiError> {
        let file = self
            .repo
            .find_file_by_id(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;
        self.repo
            .update_file_mime_type(file_id, &file.user_id, mime_type)
    }

    /// Write text over a file's current content, returning the new content version.
    ///
    /// Used for the two server-originated writes that aren't a client upload:
    /// seeding a newly created native file with its default content, and
    /// rewriting an office file's body during `convert`. Both pass
    /// `ContentVersionCheck::UNCHECKED` — there is no client-held version to
    /// guard against at those points.
    pub fn write_text_content(
        &self,
        file_id: &str,
        content: &str,
        check: ContentVersionCheck,
    ) -> Result<i32, ApiError> {
        let file = self
            .repo
            .find_file_by_id(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        self.store.ensure_user_dir(&file.user_id).map_err(|e| {
            tracing::error!("write_text_content dir error: {:?}", e);
            ApiError::internal("Failed to prepare storage directory")
        })?;

        let temp = self
            .store
            .temp_upload(&file.user_id, &Uuid::new_v4().to_string());
        std::fs::write(temp.path(), content.as_bytes()).map_err(|e| {
            tracing::error!("write_text_content write error: {:?}", e);
            ApiError::internal("Failed to write file content")
        })?;

        let saved = self.autosave(file_id, temp.path(), content.len() as i64, check)?;
        temp.commit();
        Ok(saved.content_version)
    }

    /// Convert a raw office file in place into the native Neutrino type that
    /// can edit it — same file id, mime type flipped, body replaced with
    /// `content` (already converted to the native format by the client; the
    /// backend never parses OOXML).
    ///
    /// Order matters for safety: content is written first while the mime type
    /// is still the office type, so a failure there leaves the file exactly as
    /// it was. Only once the body is native does the mime type flip to match.
    /// Doing it the other way round would leave a file that claims to be a
    /// native sheet but still holds xlsx bytes — unopenable by either editor.
    pub async fn convert_to_native(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        target_mime: &str,
        content: &str,
    ) -> Result<FileRecord, ApiError> {
        let file = self
            .repo
            .find_file_by_id(file_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let role = self
            .permissions
            .get_effective_role(&user.user_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
        if role != "owner" && role != "editor" {
            return Err(ApiError::new(403, "FORBIDDEN", "Edit access required"));
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("File is in trash"));
        }
        if super::native_types::lookup(target_mime).is_none() {
            return Err(ApiError::bad_request(
                "Target type is not a native Neutrino document type",
            ));
        }
        if super::native_types::lookup(&file.mime_type).is_some() {
            return Err(ApiError::conflict("File has already been converted"));
        }
        if !super::native_types::can_convert(&file.mime_type, target_mime) {
            return Err(ApiError::bad_request(
                "File type cannot be converted into the requested type",
            ));
        }

        self.write_text_content(file_id, content, ContentVersionCheck::UNCHECKED)?;
        self.update_mime_type(file_id, target_mime)
    }

    /// Decode an image file, resize it to fit within 512×512, and return base64 JPEG + MIME type.
    /// Returns None if the file cannot be decoded (e.g. unsupported format or encrypted).
    #[allow(dead_code)]
    pub fn generate_image_thumbnail(path: &Path) -> Option<(String, String)> {
        let img = image::open(path).ok()?;
        let thumb = img.thumbnail(512, 512);
        let mut buf: Vec<u8> = Vec::new();
        thumb
            .write_to(
                &mut std::io::Cursor::new(&mut buf),
                image::ImageFormat::Jpeg,
            )
            .ok()?;
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

// ── Tests ──────────────────────────────────────────────────────────────────────
//
// Covers `update_mime_type` (issue #43 — in-place editing of MS Office docs),
// the service-level wrapper around StorageRepository::update_file_mime_type
// that resolves the file's owner via `find_file_any_user` first (mirroring
// how `autosave`/other content-mutating methods on this service resolve
// ownership before writing). Neither `update_mime_type` nor the repository
// method it wraps exist yet (TDD red phase) — referencing them here means
// this file (and the crate) will fail to *compile* until they're implemented,
// which is the expected/normal shape of Rust TDD red phase for a method that
// doesn't exist yet. Run with `cargo test --lib drive::storage::service::tests`.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{repository::AuthRepository, service::AuthService};
    use crate::drive::encryption::repository::EncryptionRepository;
    use crate::drive::permissions::repository::PermissionsRepository;
    use crate::drive::workspace::{repository::WorkspaceRepository, service::WorkspaceService};
    use crate::drive::storage::repository::DbPool;
    use crate::shared::TokenService;
    use diesel::prelude::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;
    use std::path::PathBuf;

    const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const NATIVE_DOC_MIME: &str = "application/x-neutrino-doc";

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    /// Builds a real StorageService backed by an in-memory sqlite DB and a
    /// scratch directory on disk, wired the same way as main.rs (minus HTTP).
    fn test_storage_service() -> (StorageService, StorageRepository, PathBuf) {
        let pool = test_pool();
        let base = std::env::temp_dir().join(format!("neutrino_storage_svc_test_{}", uuid::Uuid::new_v4()));
        let store = Arc::new(LocalFileStore::new(&base).expect("create store"));

        let workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
        let workspace_service = Arc::new(WorkspaceService::new(workspace_repo));
        let encryption_repo = Arc::new(EncryptionRepository::new(pool.clone()));
        let auth_repo = Arc::new(AuthRepository::new(pool.clone()));
        let token_service = Arc::new(TokenService::new("test-secret".to_string()));
        let auth_service = Arc::new(AuthService::new(auth_repo, token_service));
        let permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
        let permissions_service = Arc::new(PermissionsService::new(
            permissions_repo,
            workspace_service,
            encryption_repo,
            auth_service,
        ));

        let repo_for_assertions = StorageRepository::new(pool.clone());
        let repo = Arc::new(StorageRepository::new(pool));
        let service = StorageService::new(repo, store, permissions_service);
        (service, repo_for_assertions, base)
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

    #[test]
    fn update_mime_type_resolves_owner_and_updates_the_file() {
        let (service, repo, base) = test_storage_service();
        insert_test_file(&repo, "file-1", "user-1", DOCX_MIME);

        let updated = service
            .update_mime_type("file-1", NATIVE_DOC_MIME)
            .expect("update mime type");

        assert_eq!(updated.mime_type, NATIVE_DOC_MIME);
        let _ = std::fs::remove_dir_all(base);
    }

    // ── Import provenance (issue #110) ────────────────────────────────────────

    fn import_request(source: &str) -> ImportMetadataRequest {
        ImportMetadataRequest {
            import_source: source.to_string(),
            created_at: Some("2014-03-01T12:00:00Z".to_string()),
            updated_at: Some("2016-07-04T09:30:00Z".to_string()),
            imported_at: None,
        }
    }

    /// The bug: an imported file used to carry the date of the import run in
    /// every date field, so a library imported in one afternoon sorted as
    /// though every file in it was written that afternoon.
    #[test]
    fn import_metadata_gives_a_file_back_the_dates_of_its_source() {
        let (service, repo, base) = test_storage_service();
        let before = insert_test_file(&repo, "file-1", "user-1", DOCX_MIME);

        let updated = service
            .apply_import_metadata("user-1", "file-1", import_request("Takeout/Drive/Q3.docx"))
            .expect("apply import metadata");

        assert_eq!(updated.created_at.to_string(), "2014-03-01 12:00:00");
        assert_eq!(updated.updated_at.to_string(), "2016-07-04 09:30:00");
        assert_ne!(updated.created_at, before.created_at);
        // The import's own moment is not lost — it moves to `imported_at`,
        // which is now the only way to tell an imported file from a native one.
        assert_eq!(
            updated.import_source.as_deref(),
            Some("Takeout/Drive/Q3.docx")
        );
        assert!(updated.imported_at.is_some());
        let _ = std::fs::remove_dir_all(base);
    }

    /// An export that records only one of the two dates must not have the
    /// other one rewritten — least of all with the import's clock.
    #[test]
    fn import_metadata_leaves_out_a_date_the_export_did_not_have() {
        let (service, repo, base) = test_storage_service();
        let before = insert_test_file(&repo, "file-1", "user-1", DOCX_MIME);

        let updated = service
            .apply_import_metadata(
                "user-1",
                "file-1",
                ImportMetadataRequest {
                    import_source: "Takeout/Drive/Q3.docx".to_string(),
                    created_at: None,
                    updated_at: Some("2016-07-04T09:30:00Z".to_string()),
                    imported_at: None,
                },
            )
            .expect("apply import metadata");

        assert_eq!(updated.created_at, before.created_at);
        assert_eq!(updated.updated_at.to_string(), "2016-07-04 09:30:00");
        let _ = std::fs::remove_dir_all(base);
    }

    /// Silently dropping an unreadable date is the failure mode issue #110 was
    /// about, so the request is rejected rather than half-applied.
    #[test]
    fn import_metadata_rejects_a_timestamp_it_cannot_read() {
        let (service, repo, base) = test_storage_service();
        let before = insert_test_file(&repo, "file-1", "user-1", DOCX_MIME);

        let err = service
            .apply_import_metadata(
                "user-1",
                "file-1",
                ImportMetadataRequest {
                    import_source: "Takeout/Drive/Q3.docx".to_string(),
                    created_at: Some("last Tuesday".to_string()),
                    updated_at: None,
                    imported_at: None,
                },
            )
            .expect_err("an unreadable timestamp must not be accepted");

        assert_eq!(err.status, 400);
        let after = repo
            .find_file_by_id("file-1")
            .expect("find file")
            .expect("file still there");
        assert_eq!(after.created_at, before.created_at);
        assert!(after.import_source.is_none(), "nothing was written");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn import_metadata_will_not_rewrite_another_users_file() {
        let (service, repo, base) = test_storage_service();
        let before = insert_test_file(&repo, "file-1", "user-1", DOCX_MIME);

        let err = service
            .apply_import_metadata("user-2", "file-1", import_request("Takeout/Drive/Q3.docx"))
            .expect_err("a file belonging to someone else must not be touched");

        assert_eq!(err.status, 404);
        let after = repo
            .find_file_by_id("file-1")
            .expect("find file")
            .expect("file still there");
        assert_eq!(after.created_at, before.created_at);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn import_metadata_requires_a_source_to_justify_the_rewrite() {
        let (service, repo, base) = test_storage_service();
        insert_test_file(&repo, "file-1", "user-1", DOCX_MIME);

        let err = service
            .apply_import_metadata("user-1", "file-1", import_request("   "))
            .expect_err("an empty importSource must not be accepted");

        assert_eq!(err.status, 400);
        let _ = std::fs::remove_dir_all(base);
    }

    /// The three sources the importer reads dates from format them
    /// differently, and none of them should have to know what the others do.
    #[test]
    fn import_timestamps_are_read_in_every_shape_the_importer_sends() {
        // `toISOString()` output: UTC with milliseconds.
        assert_eq!(
            parse_import_timestamp("2014-03-01T12:00:00.123Z")
                .expect("iso with millis")
                .to_string(),
            "2014-03-01 12:00:00.123"
        );
        // An offset is converted rather than kept as a wall clock — 23:30+02:00
        // is the 1st in UTC, and keeping the local time would move the date.
        assert_eq!(
            parse_import_timestamp("2014-03-01T23:30:00+02:00")
                .expect("offset")
                .to_string(),
            "2014-03-01 21:30:00"
        );
        // The naive shape the photos endpoint accepts.
        assert_eq!(
            parse_import_timestamp("2014-03-01T12:00:00")
                .expect("naive")
                .to_string(),
            "2014-03-01 12:00:00"
        );
        // A bare date, which some Drive sidecars carry.
        assert_eq!(
            parse_import_timestamp("2014-03-01").expect("date").to_string(),
            "2014-03-01 00:00:00"
        );
        assert!(parse_import_timestamp("not a date").is_err());
        assert!(parse_import_timestamp("").is_err());
    }

    #[test]
    fn update_mime_type_on_unknown_file_returns_error() {
        let (service, _repo, base) = test_storage_service();

        let result = service.update_mime_type("does-not-exist", NATIVE_DOC_MIME);

        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    /// A vanished blob must be distinguishable from content that was never
    /// uploaded — a syncing client should not keep waiting on bytes that are
    /// gone — and must not reach the streamer as a 500.
    #[test]
    fn missing_blob_maps_to_content_missing_not_internal_error() {
        let err = no_content_error(ServeResolveError::Missing, "user-1/file-1");
        assert_eq!(err.status, 409);
        assert_eq!(err.code, "CONTENT_MISSING");
    }

    #[test]
    fn never_uploaded_content_still_maps_to_no_content() {
        for variant in [ServeResolveError::EmptyKey, ServeResolveError::IsDirectory] {
            let err = no_content_error(variant, "user-1/file-1");
            assert_eq!(err.status, 409);
            assert_eq!(err.code, "NO_CONTENT");
        }
    }

    /// End-to-end through the real resolver: a file row pointing at a path with
    /// nothing on disk surfaces as CONTENT_MISSING, which is exactly the shape
    /// of the rows that were returning HTTP 500 on download.
    #[test]
    fn resolving_an_orphaned_file_row_returns_content_missing() {
        let (service, repo, base) = test_storage_service();
        // A populated storage_path pointing at a blob that isn't on disk — an
        // empty path would be the different, already-handled NO_CONTENT case.
        repo.insert_file(NewFileRecord {
            id: "file-1",
            user_id: "user-1",
            name: "report.docx",
            size_bytes: 0,
            mime_type: DOCX_MIME,
            storage_path: "user-1/file-1",
            folder_id: None,
            encrypted_metadata: None,
        })
        .expect("insert file");

        let err = service
            .resolve_file_path_by_id("file-1")
            .expect_err("orphaned row must not resolve");

        assert_eq!(err.status, 409);
        assert_eq!(err.code, "CONTENT_MISSING");
        let _ = std::fs::remove_dir_all(base);
    }

    // ── convert_to_native ────────────────────────────────────────────────────
    //
    // These replace the four per-app `promote` suites (docs/sheets/slides) that
    // each re-tested the same contract against their own service. The contract
    // is unchanged: validate access, source mime and prior-conversion state,
    // then write content *before* flipping the mime type so a failure can't
    // leave a file whose declared type and body disagree.

    const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const NATIVE_SHEET_MIME: &str = "application/x-neutrino-sheet";
    const SHEET_CONTENT: &str = r#"[{"index":"0","name":"Sheet1","celldata":[]}]"#;

    /// Same wiring as `test_storage_service`, but also hands back the
    /// permissions repository so a test can grant the roles `convert_to_native`
    /// checks.
    fn test_service_with_permissions(
    ) -> (StorageService, StorageRepository, PermissionsRepository, DbPool, PathBuf) {
        let pool = test_pool();
        let base = std::env::temp_dir()
            .join(format!("neutrino_convert_test_{}", uuid::Uuid::new_v4()));
        let store = Arc::new(LocalFileStore::new(&base).expect("create store"));

        let workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
        let workspace_service = Arc::new(WorkspaceService::new(workspace_repo));
        let encryption_repo = Arc::new(EncryptionRepository::new(pool.clone()));
        let auth_repo = Arc::new(AuthRepository::new(pool.clone()));
        let token_service = Arc::new(TokenService::new("test-secret".to_string()));
        let auth_service = Arc::new(AuthService::new(auth_repo, token_service));
        let perms_for_assertions = PermissionsRepository::new(pool.clone());
        let permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
        let permissions_service = Arc::new(PermissionsService::new(
            permissions_repo,
            workspace_service,
            encryption_repo,
            auth_service,
        ));

        let repo_for_assertions = StorageRepository::new(pool.clone());
        let pool_for_assertions = pool.clone();
        let repo = Arc::new(StorageRepository::new(pool));
        let service = StorageService::new(repo, store, permissions_service);
        (service, repo_for_assertions, perms_for_assertions, pool_for_assertions, base)
    }

    fn convert_test_user(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
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
    async fn convert_succeeds_for_the_owner_of_a_raw_xlsx_file() {
        let (service, repo, perms, _pool, base) = test_service_with_permissions();
        let owner = convert_test_user("owner-1");
        insert_test_file(&repo, "sheet-1", &owner.user_id, XLSX_MIME);
        grant_role(&perms, "sheet-1", &owner.user_id, "owner");

        let result = service
            .convert_to_native(&owner, "sheet-1", NATIVE_SHEET_MIME, SHEET_CONTENT)
            .await
            .expect("convert should succeed for the owner of a raw xlsx file");

        assert_eq!(result.id, "sheet-1");
        assert_eq!(result.mime_type, NATIVE_SHEET_MIME);
        let stored = repo.find_file_by_id("sheet-1").unwrap().unwrap();
        assert_eq!(stored.mime_type, NATIVE_SHEET_MIME);
        assert!(stored.content_version > 0, "content write must bump the version");
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn convert_succeeds_for_a_non_owner_with_edit_access() {
        let (service, repo, perms, _pool, base) = test_service_with_permissions();
        insert_test_file(&repo, "sheet-2", "owner-1", XLSX_MIME);
        grant_role(&perms, "sheet-2", "owner-1", "owner");
        let editor = convert_test_user("editor-1");
        grant_role(&perms, "sheet-2", &editor.user_id, "editor");

        let result = service
            .convert_to_native(&editor, "sheet-2", NATIVE_SHEET_MIME, SHEET_CONTENT)
            .await;

        assert!(
            result.is_ok(),
            "a non-owner editor should be able to convert the file: {:?}",
            result.err()
        );
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn convert_rejects_a_file_that_is_already_native() {
        let (service, repo, perms, _pool, base) = test_service_with_permissions();
        let owner = convert_test_user("owner-1");
        insert_test_file(&repo, "sheet-3", &owner.user_id, NATIVE_SHEET_MIME);
        grant_role(&perms, "sheet-3", &owner.user_id, "owner");

        let err = service
            .convert_to_native(&owner, "sheet-3", NATIVE_SHEET_MIME, SHEET_CONTENT)
            .await
            .expect_err("converting an already-native file must be rejected");

        assert_eq!(err.status, 409);
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn convert_rejects_a_file_with_the_wrong_source_mime_type() {
        let (service, repo, perms, _pool, base) = test_service_with_permissions();
        let owner = convert_test_user("owner-1");
        insert_test_file(&repo, "sheet-4", &owner.user_id, "text/plain");
        grant_role(&perms, "sheet-4", &owner.user_id, "owner");

        let err = service
            .convert_to_native(&owner, "sheet-4", NATIVE_SHEET_MIME, SHEET_CONTENT)
            .await
            .expect_err("a text/plain file is not convertible into a spreadsheet");

        assert_eq!(err.status, 400);
        let _ = std::fs::remove_dir_all(base);
    }

    /// An .xlsx is convertible — but only into a spreadsheet. Targeting a
    /// different native type has to fail, or the registry's per-type source
    /// list would be decorative.
    #[tokio::test]
    async fn convert_rejects_a_source_that_does_not_match_the_target_type() {
        let (service, repo, perms, _pool, base) = test_service_with_permissions();
        let owner = convert_test_user("owner-1");
        insert_test_file(&repo, "sheet-5", &owner.user_id, XLSX_MIME);
        grant_role(&perms, "sheet-5", &owner.user_id, "owner");

        let err = service
            .convert_to_native(&owner, "sheet-5", NATIVE_DOC_MIME, SHEET_CONTENT)
            .await
            .expect_err("an xlsx must not convert into a native doc");

        assert_eq!(err.status, 400);
        let stored = repo.find_file_by_id("sheet-5").unwrap().unwrap();
        assert_eq!(stored.mime_type, XLSX_MIME);
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn convert_rejects_an_unknown_target_type() {
        let (service, repo, perms, _pool, base) = test_service_with_permissions();
        let owner = convert_test_user("owner-1");
        insert_test_file(&repo, "sheet-6", &owner.user_id, XLSX_MIME);
        grant_role(&perms, "sheet-6", &owner.user_id, "owner");

        let err = service
            .convert_to_native(&owner, "sheet-6", "application/zip", SHEET_CONTENT)
            .await
            .expect_err("a non-native target type must be rejected");

        assert_eq!(err.status, 400);
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn convert_gives_a_viewer_a_clean_403_not_a_corrupted_write() {
        let (service, repo, perms, _pool, base) = test_service_with_permissions();
        insert_test_file(&repo, "sheet-7", "owner-1", XLSX_MIME);
        grant_role(&perms, "sheet-7", "owner-1", "owner");
        let viewer = convert_test_user("viewer-1");
        grant_role(&perms, "sheet-7", &viewer.user_id, "viewer");
        let before = repo.find_file_by_id("sheet-7").unwrap().unwrap();

        let err = service
            .convert_to_native(&viewer, "sheet-7", NATIVE_SHEET_MIME, SHEET_CONTENT)
            .await
            .expect_err("a viewer must not be able to convert the file");

        assert_eq!(err.status, 403);
        let stored = repo.find_file_by_id("sheet-7").unwrap().unwrap();
        assert_eq!(stored.mime_type, XLSX_MIME);
        assert_eq!(
            stored.content_version, before.content_version,
            "a rejected convert must not write content"
        );
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn convert_rejects_a_trashed_file() {
        let (service, repo, perms, pool, base) = test_service_with_permissions();
        let owner = convert_test_user("owner-1");
        insert_test_file(&repo, "sheet-8", &owner.user_id, XLSX_MIME);
        grant_role(&perms, "sheet-8", &owner.user_id, "owner");
        crate::drive::filesystem::repository::FilesystemRepository::new(pool)
            .trash_file("sheet-8", &owner.user_id)
            .expect("trash the file");

        let err = service
            .convert_to_native(&owner, "sheet-8", NATIVE_SHEET_MIME, SHEET_CONTENT)
            .await
            .expect_err("a trashed file must not be convertible");

        assert_eq!(err.status, 404);
        let _ = std::fs::remove_dir_all(base);
    }

    // ── write_text_content ───────────────────────────────────────────────────

    #[test]
    fn write_text_content_persists_the_body_and_bumps_the_version() {
        let (service, repo, base) = test_storage_service();
        insert_test_file(&repo, "file-9", "user-1", NATIVE_SHEET_MIME);

        let version = service
            .write_text_content("file-9", SHEET_CONTENT, ContentVersionCheck::UNCHECKED)
            .expect("write content");

        let stored = repo.find_file_by_id("file-9").unwrap().unwrap();
        assert_eq!(stored.content_version, version);
        assert_eq!(stored.size_bytes, SHEET_CONTENT.len() as i64);
        let on_disk = std::fs::read_to_string(base.join(&stored.storage_path)).expect("read blob");
        assert_eq!(on_disk, SHEET_CONTENT);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn write_text_content_on_unknown_file_returns_not_found() {
        let (service, _repo, base) = test_storage_service();

        let err = service
            .write_text_content("nope", SHEET_CONTENT, ContentVersionCheck::UNCHECKED)
            .expect_err("unknown file");

        assert_eq!(err.status, 404);
        let _ = std::fs::remove_dir_all(base);
    }

    // ── Quota accounting (issue #101) ────────────────────────────────────────
    //
    // The reported usage has to match what the store actually holds. It didn't:
    // `used_bytes` was a counter incremented by one call site (`finalize_upload`)
    // with the uploaded size, while `finalize_upload` also writes a full v1
    // snapshot, so a store of freshly uploaded files reported half its real
    // footprint. These tests measure the scratch directory on disk and compare.

    /// Total bytes of every regular file under `dir`, versions included.
    fn bytes_on_disk(dir: &Path) -> i64 {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return 0;
        };
        entries.flatten().fold(0, |total, entry| {
            let path = entry.path();
            if path.is_dir() {
                total + bytes_on_disk(&path)
            } else {
                total + entry.metadata().map(|m| m.len() as i64).unwrap_or(0)
            }
        })
    }

    /// Stage `content` as an upload and commit it through `finalize_upload`.
    async fn upload(
        service: &StorageService,
        user: &AuthenticatedUser,
        name: &str,
        content: &[u8],
    ) -> FileMetadataResponse {
        service.store().ensure_user_dir(&user.user_id).expect("mkdir");
        let temp = service
            .store()
            .temp_upload(&user.user_id, &uuid::Uuid::new_v4().to_string());
        std::fs::write(temp.path(), content).expect("stage upload");
        let saved = service
            .finalize_upload(
                user,
                temp.path(),
                name,
                "image/jpeg",
                content.len() as i64,
                None,
                None,
            )
            .await
            .expect("finalize upload");
        temp.commit();
        saved
    }

    #[tokio::test]
    async fn reported_usage_counts_the_version_snapshot_written_by_every_upload() {
        let (service, _repo, _perms, _pool, base) = test_service_with_permissions();
        let user = convert_test_user("user-1");
        let content = vec![7u8; 4096];

        upload(&service, &user, "photo.jpg", &content).await;

        let quota = service.get_quota(&user.user_id).expect("quota");
        assert_eq!(
            quota.used_bytes,
            bytes_on_disk(&base),
            "reported usage must match the bytes the upload actually wrote"
        );
        assert_eq!(
            quota.used_bytes,
            content.len() as i64 * 2,
            "an upload stores the content plus its v1 snapshot"
        );
        let _ = std::fs::remove_dir_all(base);
    }

    /// The takeout-import shape from the issue: many uploads in one run, where
    /// the old counter drifted further from the truth with every file.
    #[tokio::test]
    async fn reported_usage_tracks_disk_across_many_uploads() {
        let (service, _repo, _perms, _pool, base) = test_service_with_permissions();
        let user = convert_test_user("user-1");

        for i in 0..10 {
            upload(&service, &user, &format!("photo-{i}.jpg"), &vec![3u8; 1000 + i]).await;
        }

        let quota = service.get_quota(&user.user_id).expect("quota");
        assert_eq!(quota.used_bytes, bytes_on_disk(&base));
        let _ = std::fs::remove_dir_all(base);
    }

    /// Usage is derived, so freeing bytes lowers it. The old counter only ever
    /// went up: deleting a version left its bytes charged to the user forever.
    #[tokio::test]
    async fn deleting_a_version_releases_its_bytes() {
        let (service, _repo, _perms, _pool, base) = test_service_with_permissions();
        let user = convert_test_user("user-1");
        let content = vec![7u8; 4096];

        let file = upload(&service, &user, "photo.jpg", &content).await;
        let before = service.get_quota(&user.user_id).expect("quota").used_bytes;

        let versions = service
            .list_versions(
                &user.user_id,
                &file.id,
                &ListQueryParams {
                    limit: None,
                    offset: None,
                    order_by: None,
                    direction: None,
                },
            )
            .expect("list versions");
        let version_id = versions.versions.first().expect("v1 exists").id.clone();
        service
            .delete_version(&user.user_id, &file.id, &version_id)
            .expect("delete version");

        let after = service.get_quota(&user.user_id).expect("quota").used_bytes;
        assert_eq!(after, before - content.len() as i64);
        assert_eq!(after, bytes_on_disk(&base));
        let _ = std::fs::remove_dir_all(base);
    }

    /// A store whose counter drifted while it was hand-maintained heals on the
    /// next read rather than needing a migration or a manual reset.
    #[tokio::test]
    async fn a_stale_stored_counter_is_corrected_on_read() {
        let (service, repo, _perms, pool, base) = test_service_with_permissions();
        let user = convert_test_user("user-1");
        let content = vec![7u8; 4096];
        upload(&service, &user, "photo.jpg", &content).await;

        // Rewind the column to the pre-fix value: content bytes only, with the
        // snapshot unaccounted for. This is the state every existing store is
        // in on upgrade.
        let stale = content.len() as i64;
        diesel::update(crate::schema::user_quotas::table)
            .set(crate::schema::user_quotas::used_bytes.eq(stale))
            .execute(&mut pool.get().expect("conn"))
            .expect("rewind the counter");

        let quota = service.get_quota(&user.user_id).expect("quota");
        assert_eq!(quota.used_bytes, bytes_on_disk(&base));
        assert_ne!(quota.used_bytes, stale);

        // ...and the correction is written back, not just returned.
        assert_eq!(
            repo.get_or_create_quota(&user.user_id)
                .expect("quota row")
                .used_bytes,
            quota.used_bytes
        );
        let _ = std::fs::remove_dir_all(base);
    }

    /// The limit has to be checked against real occupancy, or a user whose
    /// snapshots already fill the store keeps uploading past their quota.
    #[tokio::test]
    async fn the_quota_limit_is_enforced_against_real_occupancy() {
        let (service, _repo, _perms, pool, base) = test_service_with_permissions();
        let user = convert_test_user("user-1");
        let content = vec![7u8; 4096];
        upload(&service, &user, "photo.jpg", &content).await;

        // Room for one more copy of the content, but not for the copy *and*
        // the snapshot the first upload already wrote.
        let limit = content.len() as i64 * 2 + 1;
        diesel::update(crate::schema::user_quotas::table)
            .set(crate::schema::user_quotas::quota_bytes.eq(Some(limit)))
            .execute(&mut pool.get().expect("conn"))
            .expect("set limit");

        service.store().ensure_user_dir(&user.user_id).expect("mkdir");
        let temp = service.store().temp_upload(&user.user_id, "second");
        std::fs::write(temp.path(), &content).expect("stage");
        let err = service
            .finalize_upload(
                &user,
                temp.path(),
                "photo-2.jpg",
                "image/jpeg",
                content.len() as i64,
                None,
                None,
            )
            .await
            .expect_err("the snapshot bytes must count against the limit");

        assert_eq!(err.status, 413);
        assert_eq!(err.code, "QUOTA_EXCEEDED");
        let _ = std::fs::remove_dir_all(base);
    }
}
