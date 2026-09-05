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

/// What an upload still in flight is allowed to write, worked out before a
/// single byte is streamed.
///
/// The commit-time checks in [`StorageService::finalize_upload`] stay where
/// they are — they are what settles a race between two uploads running at
/// once — but on their own they mean a body that can never be committed is
/// written to disk in full and only then rejected, so a 50 GB upload costs
/// 50 GB of writes to earn its 413. This is the same arithmetic done up front,
/// so the chunk loop can stop at the first byte over the line.
///
/// It also carries `MAX_UPLOAD_BYTES`, which until now was enforced nowhere:
/// it was wired up as an actix `PayloadConfig`, and `actix_multipart::Multipart`
/// never consults one.
pub struct UploadAllowance {
    max_upload_bytes: i64,
    /// `None` where the limit is unset, not where it is reached.
    quota_remaining: Option<i64>,
    daily_remaining: Option<i64>,
}

impl UploadAllowance {
    /// An allowance bounded only by the configured single-file ceiling, for
    /// writes that do not draw down the user's quota.
    pub fn unmetered(max_upload_bytes: u64) -> Self {
        UploadAllowance {
            max_upload_bytes: saturating_i64(max_upload_bytes),
            quota_remaining: None,
            daily_remaining: None,
        }
    }

    /// Whether an upload that has written `size_bytes` so far may keep going.
    /// Called once per chunk, so the answer has to stay cheap — every field
    /// here is a plain integer settled before the stream opened.
    pub fn check(&self, size_bytes: i64) -> Result<(), ApiError> {
        if size_bytes > self.max_upload_bytes {
            return Err(ApiError::new(
                413,
                "PAYLOAD_TOO_LARGE",
                "File exceeds the maximum upload size",
            ));
        }
        if self.quota_remaining.is_some_and(|left| size_bytes > left) {
            return Err(ApiError::new(
                413,
                "QUOTA_EXCEEDED",
                "Storage quota exceeded",
            ));
        }
        if self.daily_remaining.is_some_and(|left| size_bytes > left) {
            return Err(ApiError::new(
                429,
                "DAILY_LIMIT_EXCEEDED",
                "Daily upload limit exceeded",
            ));
        }
        Ok(())
    }
}

/// `MAX_UPLOAD_BYTES` is configured as a `u64` and compared against sizes that
/// are `i64` everywhere else in this module. An operator who sets it above
/// `i64::MAX` means "no limit", which is what saturating gives them.
fn saturating_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
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

    /// How much this user may still upload, for the chunk loop to check
    /// against as it streams.
    ///
    /// Read once per request rather than per chunk, so it is a snapshot: two
    /// uploads started together both see the same headroom and can between
    /// them exceed it. That is what the commit-time checks in
    /// [`Self::finalize_upload`] are for. This one exists to stop the
    /// overwhelmingly common case — a single upload that was never going to
    /// fit — from being written out in full first.
    pub fn upload_allowance(
        &self,
        user_id: &str,
        max_upload_bytes: u64,
    ) -> Result<UploadAllowance, ApiError> {
        let quota = self.repo.get_or_create_quota(user_id)?;
        let today = Utc::now().naive_utc().date();
        let used_daily = if quota.daily_reset_at.date() < today {
            0
        } else {
            quota.daily_upload_bytes
        };

        // Derived rather than read off the row, for the reason `finalize_upload`
        // gives: the stored counter under-reports by every version snapshot and
        // never shrank on delete. Skipped entirely when no quota is set, since
        // then nothing would be done with the answer.
        let quota_remaining = match quota.quota_bytes {
            Some(limit) => {
                let used = self.repo.refresh_used_bytes(user_id, quota.used_bytes)?;
                Some((limit - used).max(0))
            }
            None => None,
        };

        Ok(UploadAllowance {
            max_upload_bytes: saturating_i64(max_upload_bytes),
            quota_remaining,
            daily_remaining: quota.daily_cap_bytes.map(|cap| (cap - used_daily).max(0)),
        })
    }

    /// Called after a file has been streamed to `temp_path`.
    /// Enforces per-user quota and daily cap, then commits the upload.
    /// Automatically creates version 1 for the new file.
    ///
    /// These checks are the second of two: [`Self::upload_allowance`] has
    /// already refused anything obviously over the line before it reached
    /// disk. Keeping them here is what makes concurrent uploads safe, since
    /// the pre-flight figure is a snapshot taken before either had written
    /// anything.
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
        // The uploaded bytes are version 1, not a file that a copy of itself is
        // then filed away beside: they are moved straight into the file's own
        // directory and the row points at them. Nothing is written twice.
        let version_id = Uuid::new_v4().to_string();
        self.store
            .ensure_file_dir(&user.user_id, &file_id)
            .map_err(ApiError::internal)?;
        let final_path = self.store.version_path(&user.user_id, &file_id, &version_id);
        let storage_key = self.store.version_key(&user.user_id, &file_id, &version_id);

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
            self.store.remove_file_dir(&user.user_id, &file_id);
        })?;

        if let Err(e) = self
            .permissions
            .grant_ownership(user, "file", &file_id)
            .await
        {
            self.store.remove_file_dir(&user.user_id, &file_id);
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

        // The version row for the bytes already on disk. Best-effort, as the
        // snapshot it replaces was: the content is uploaded and reachable
        // either way, and a missing row only costs the file its history.
        if let Err(e) = self.repo.insert_version(NewFileVersionRecord {
            id: &version_id,
            file_id: &file_id,
            user_id: &user.user_id,
            size_bytes,
            storage_path: &storage_key,
            label: None,
            is_named: false,
        }) {
            tracing::error!("Failed to record version 1 for file {}: {:?}", file_id, e);
        }

        Ok(FileMetadataResponse::from(file))
    }

    /// Autosave: overwrite the file's current content, adding no version.
    ///
    /// The newest version *is* the live content now that both live in one
    /// directory, so an autosave rewrites its bytes in place and leaves the
    /// history alone. Older versions are immutable; only the live one moves.
    /// A file with no version rows yet — a record created ahead of its content
    /// by `save_file` — gets its first one here.
    ///
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

        let storage_key = match self
            .repo
            .find_current_version(file_id, &file.storage_path)?
        {
            Some(current) => {
                let target = self.store.resolve(&current.storage_path);
                std::fs::rename(temp_path, &target).map_err(|e| {
                    tracing::error!("Failed to move autosave content into place: {:?}", e);
                    ApiError::internal("Failed to autosave file")
                })?;
                // The row is where the quota reads occupancy from, so the new
                // size has to land on it and not only on the file row.
                self.repo.update_version_size(&current.id, size_bytes)?;
                current.storage_path
            }
            None => {
                self.commit_new_version(owner_id, file_id, temp_path, size_bytes, false, None)?
                    .storage_path
            }
        };

        let now = Utc::now().naive_utc();
        let updated = self.repo.update_file_autosave(
            file_id,
            owner_id,
            AutosaveFileContent {
                size_bytes,
                storage_path: storage_key,
                updated_at: now,
            },
            check,
        )?;

        Ok(FileMetadataResponse::from(updated))
    }

    /// Save a named version: the new content becomes a version marked
    /// `is_named = true`, and the file's live content along with it.
    ///
    /// Named versions are never pruned automatically. The content that was
    /// live until now needs no snapshotting first — it is already a version
    /// row of its own, which is what the one-directory layout buys.
    ///
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

        let version =
            self.commit_new_version(owner_id, file_id, temp_path, size_bytes, true, label)?;

        let now = Utc::now().naive_utc();
        self.repo.update_file_content(
            file_id,
            owner_id,
            UpdateFileContent {
                size_bytes,
                storage_path: version.storage_path.clone(),
                updated_at: now,
            },
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
        self.repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let version = self
            .repo
            .find_version(version_id, file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        // The restore lands as a new version rather than by pointing the file
        // at the old one. Two reasons: the content that was live is already
        // its own version, so nothing needs snapshotting to preserve it; and
        // the live version is the one autosave overwrites, so sharing a blob
        // with a historical version would let the next keystroke rewrite the
        // history it was restored from.
        self.store
            .ensure_file_dir(user_id, file_id)
            .map_err(ApiError::internal)?;
        let new_id = Uuid::new_v4().to_string();
        let new_path = self.store.version_path(user_id, file_id, &new_id);
        let new_key = self.store.version_key(user_id, file_id, &new_id);

        std::fs::copy(self.store.resolve(&version.storage_path), &new_path).map_err(|e| {
            tracing::error!("Failed to restore version {}: {:?}", version_id, e);
            ApiError::internal("Failed to restore version")
        })?;

        let restored = self
            .repo
            .insert_version(NewFileVersionRecord {
                id: &new_id,
                file_id,
                user_id,
                size_bytes: version.size_bytes,
                storage_path: &new_key,
                label: None,
                is_named: false,
            })
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&new_path);
            })?;

        let now = Utc::now().naive_utc();
        let updated = self.repo.update_file_content(
            file_id,
            user_id,
            UpdateFileContent {
                size_bytes: restored.size_bytes,
                storage_path: restored.storage_path,
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

    /// Delete one past version.
    ///
    /// The live version cannot be deleted: its bytes are the file's content,
    /// not a spare copy of them, so removing it would empty the file. That was
    /// impossible to ask for under the old layout — history lived elsewhere —
    /// and has to be refused explicitly now that the two sit side by side.
    pub fn delete_version(
        &self,
        user_id: &str,
        file_id: &str,
        version_id: &str,
    ) -> Result<(), ApiError> {
        let file = self
            .repo
            .find_file(file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("File not found"))?;

        let version = self
            .repo
            .find_version(version_id, file_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        if version.storage_path == file.storage_path {
            return Err(ApiError::new(
                409,
                "CURRENT_VERSION",
                "The current version cannot be deleted",
            ));
        }

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
        // Every file the query matches, not the length of the page just built:
        // a client paging with `offset` has no other way to know it has reached
        // the end, and used to find out by fetching one more empty page.
        let total = self.repo.count_files_by_user(user_id, query)? as usize;
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

    /// Set a user's storage limit and daily upload cap. `None` means unlimited.
    ///
    /// The admin console's write half of [`Self::get_quota`], and what
    /// approving a storage request (issue #144) calls. Occupancy is not
    /// recomputed here — the response reports it, so it comes back through
    /// `get_quota` on the way out.
    pub fn set_quota_limits(
        &self,
        user_id: &str,
        quota_bytes: Option<i64>,
        daily_cap_bytes: Option<i64>,
    ) -> Result<QuotaResponse, ApiError> {
        if quota_bytes.is_some_and(|b| b < 0) || daily_cap_bytes.is_some_and(|b| b < 0) {
            return Err(ApiError::bad_request("A quota cannot be negative"));
        }
        self.repo
            .set_quota_limits(user_id, quota_bytes, daily_cap_bytes)?;
        self.get_quota(user_id)
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

    /// Write text over a file's current content, returning the new content version.
    ///
    /// Used for the one server-originated write that isn't a client upload:
    /// seeding a newly created native file with its default content. It passes
    /// `ContentVersionCheck::UNCHECKED` — there is no client-held version to
    /// guard against at that point.
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

    /// Move staged bytes into the file's directory as a new version.
    ///
    /// The bytes are *moved*, not copied: staging happens in the owner's
    /// partition on the same filesystem, so this is an atomic rename and the
    /// content exists in exactly one place afterwards. Copying was what the
    /// old layout forced — the same content had to sit at the file's path and
    /// again under `versions/` — and is what made a store cost twice what it
    /// reported.
    ///
    /// The version *number* is assigned by the insert, not here — see
    /// `StorageRepository::insert_version`.
    fn commit_new_version(
        &self,
        user_id: &str,
        file_id: &str,
        temp_path: &Path,
        size_bytes: i64,
        is_named: bool,
        label: Option<&str>,
    ) -> Result<crate::drive::storage::model::FileVersionRecord, ApiError> {
        self.store
            .ensure_file_dir(user_id, file_id)
            .map_err(ApiError::internal)?;

        let version_id = Uuid::new_v4().to_string();
        let version_abs_path = self.store.version_path(user_id, file_id, &version_id);
        let version_key = self.store.version_key(user_id, file_id, &version_id);

        std::fs::rename(temp_path, &version_abs_path).map_err(|e| {
            tracing::error!("Failed to move content into the file directory: {:?}", e);
            ApiError::internal("Failed to save file content")
        })?;

        self.repo
            .insert_version(NewFileVersionRecord {
                id: &version_id,
                file_id,
                user_id,
                size_bytes,
                storage_path: &version_key,
                label,
                is_named,
            })
            .inspect_err(|_| {
                // The row is what makes these bytes reachable; without it they
                // are an orphan nothing will ever read or clean up.
                let _ = std::fs::remove_file(&version_abs_path);
            })
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{repository::AuthRepository, service::AuthService};
    use crate::drive::encryption::repository::EncryptionRepository;
    use crate::drive::feature_flags::gate::FeatureGate;
    use crate::drive::feature_flags::repository::FeatureFlagsRepository;
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
        let auth_service = Arc::new(AuthService::new(
            auth_repo,
            token_service,
            Arc::new(crate::auth::password_policy::PasswordPolicyRepository::new(pool.clone())),
        ));
        let permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
        let feature_gate = FeatureGate::new(Arc::new(FeatureFlagsRepository::new(pool.clone())));
        let permissions_service = Arc::new(PermissionsService::new(
            permissions_repo,
            workspace_service,
            encryption_repo,
            auth_service,
            feature_gate,
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

    // ── Shared wiring for the tests below ────────────────────────────────────

    const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const NATIVE_SHEET_MIME: &str = "application/x-neutrino-sheet";
    const SHEET_CONTENT: &str = r#"[{"index":"0","name":"Sheet1","celldata":[]}]"#;

    /// Same wiring as `test_storage_service`, but also hands back the
    /// permissions repository and the pool, for tests that need to grant roles
    /// or reach the database directly.
    fn test_service_with_permissions(
    ) -> (StorageService, StorageRepository, PermissionsRepository, DbPool, PathBuf) {
        let pool = test_pool();
        let base = std::env::temp_dir()
            .join(format!("neutrino_storage_perms_test_{}", uuid::Uuid::new_v4()));
        let store = Arc::new(LocalFileStore::new(&base).expect("create store"));

        let workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
        let workspace_service = Arc::new(WorkspaceService::new(workspace_repo));
        let encryption_repo = Arc::new(EncryptionRepository::new(pool.clone()));
        let auth_repo = Arc::new(AuthRepository::new(pool.clone()));
        let token_service = Arc::new(TokenService::new("test-secret".to_string()));
        let auth_service = Arc::new(AuthService::new(
            auth_repo,
            token_service,
            Arc::new(crate::auth::password_policy::PasswordPolicyRepository::new(pool.clone())),
        ));
        let perms_for_assertions = PermissionsRepository::new(pool.clone());
        let permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
        let feature_gate = FeatureGate::new(Arc::new(FeatureFlagsRepository::new(pool.clone())));
        let permissions_service = Arc::new(PermissionsService::new(
            permissions_repo,
            workspace_service,
            encryption_repo,
            auth_service,
            feature_gate,
        ));

        let repo_for_assertions = StorageRepository::new(pool.clone());
        let pool_for_assertions = pool.clone();
        let repo = Arc::new(StorageRepository::new(pool));
        let service = StorageService::new(repo, store, permissions_service);
        (service, repo_for_assertions, perms_for_assertions, pool_for_assertions, base)
    }

    fn test_user_named(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
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
    // The reported usage has to match what the store actually holds, whatever
    // the layout underneath. It didn't: `used_bytes` was a counter incremented
    // by one call site with the uploaded size, while the upload also wrote a
    // full v1 snapshot beside it. The snapshot is gone — an upload's bytes are
    // version 1, written once — but the property is the same one, so these
    // tests still measure the scratch directory on disk and compare.

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

    /// The storage key of the file's live content. Not on the DTOs — those
    /// deliberately keep storage layout off the wire — so it comes off the row.
    fn current_key(repo: &StorageRepository, file_id: &str) -> String {
        repo.find_file_by_id(file_id)
            .expect("find file")
            .expect("file exists")
            .storage_path
    }

    /// Every version of a file, newest first.
    fn list_versions(
        service: &StorageService,
        user_id: &str,
        file_id: &str,
    ) -> Vec<FileVersionResponse> {
        service
            .list_versions(
                user_id,
                file_id,
                &ListQueryParams {
                    limit: None,
                    offset: None,
                    order_by: None,
                    direction: None,
                },
            )
            .expect("list versions")
            .versions
    }

    fn oldest_version_id(service: &StorageService, user_id: &str, file_id: &str) -> String {
        list_versions(service, user_id, file_id)
            .last()
            .expect("at least one version")
            .id
            .clone()
    }

    /// Stage `content` and commit it as a named version of an existing file.
    fn save_named(
        service: &StorageService,
        file_id: &str,
        content: &[u8],
        label: Option<&str>,
    ) -> FileVersionResponse {
        let owner = service
            .find_file_any_user(file_id)
            .expect("find file")
            .expect("file exists")
            .user_id;
        service.store().ensure_user_dir(&owner).expect("mkdir");
        let temp = service
            .store()
            .temp_upload(&owner, &uuid::Uuid::new_v4().to_string());
        std::fs::write(temp.path(), content).expect("stage");
        let version = service
            .save_named_version(file_id, temp.path(), content.len() as i64, label)
            .expect("save named version");
        temp.commit();
        version
    }

    #[tokio::test]
    async fn an_upload_stores_and_reports_its_content_once() {
        let (service, _repo, _perms, _pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");
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
            content.len() as i64,
            "the uploaded bytes are version 1, not a file plus a copy of it",
        );
        let _ = std::fs::remove_dir_all(base);
    }

    /// The current content and the history are one directory, and the file
    /// row points into it. Nothing sits outside, and nothing is stored twice.
    #[tokio::test]
    async fn a_files_versions_live_in_one_directory_with_its_current_content() {
        let (service, repo, _perms, _pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");

        let file = upload(&service, &user, "notes.txt", b"first").await;
        save_named(&service, &file.id, b"second", Some("draft"));

        let dir = base.join(&user.user_id).join(&file.id);
        let entries: Vec<_> = std::fs::read_dir(&dir)
            .expect("file directory")
            .flatten()
            .collect();
        assert_eq!(entries.len(), 2, "both versions belong in the file's folder");

        let key = current_key(&repo, &file.id);
        assert_eq!(
            base.join(&key).parent(),
            Some(dir.as_path()),
            "the current content must be one of the versions in that folder",
        );
        assert_eq!(std::fs::read(base.join(&key)).expect("read"), b"second");

        // No stray `versions/` tree, and no separate copy of the live content.
        assert!(!base.join(&user.user_id).join("versions").exists());
        assert_eq!(
            service.get_quota(&user.user_id).expect("quota").used_bytes,
            bytes_on_disk(&base),
        );
        let _ = std::fs::remove_dir_all(base);
    }

    /// The takeout-import shape from the issue: many uploads in one run, where
    /// the old counter drifted further from the truth with every file.
    #[tokio::test]
    async fn reported_usage_tracks_disk_across_many_uploads() {
        let (service, _repo, _perms, _pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");

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
        let user = test_user_named("user-1");
        let content = vec![7u8; 4096];

        let file = upload(&service, &user, "photo.jpg", &content).await;
        // v1 is the live version now, so there has to be a v2 before v1 is a
        // past version anybody is allowed to delete.
        save_named(&service, &file.id, &content, Some("checkpoint"));
        let before = service.get_quota(&user.user_id).expect("quota").used_bytes;

        let version_id = oldest_version_id(&service, &user.user_id, &file.id);
        service
            .delete_version(&user.user_id, &file.id, &version_id)
            .expect("delete version");

        let after = service.get_quota(&user.user_id).expect("quota").used_bytes;
        assert_eq!(after, before - content.len() as i64);
        assert_eq!(after, bytes_on_disk(&base));
        let _ = std::fs::remove_dir_all(base);
    }

    /// The live version's bytes *are* the file, so deleting it would empty the
    /// file rather than free a spare copy. Only possible to ask for since the
    /// two started sharing a directory, so it has to be refused explicitly.
    #[tokio::test]
    async fn the_current_version_cannot_be_deleted() {
        let (service, repo, _perms, _pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");

        let file = upload(&service, &user, "photo.jpg", b"only content").await;
        let key = current_key(&repo, &file.id);
        let live_id = repo
            .find_current_version(&file.id, &key)
            .expect("find current version")
            .expect("the live version is a version row")
            .id;

        let err = service
            .delete_version(&user.user_id, &file.id, &live_id)
            .expect_err("the file's own content must not be deletable");

        assert_eq!(err.status, 409);
        assert_eq!(err.code, "CURRENT_VERSION");
        assert_eq!(
            std::fs::read(base.join(&key)).expect("read"),
            b"only content",
        );
        let _ = std::fs::remove_dir_all(base);
    }

    /// A restore lands as a new version rather than repointing the file at an
    /// old one — sharing a blob with a historical version would let the next
    /// autosave rewrite the history it was restored from.
    #[tokio::test]
    async fn restoring_a_version_copies_it_forward() {
        let (service, repo, _perms, _pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");

        let file = upload(&service, &user, "notes.txt", b"original").await;
        let original_id = oldest_version_id(&service, &user.user_id, &file.id);
        let original_key = repo
            .find_version(&original_id, &file.id, &user.user_id)
            .expect("find version")
            .expect("original exists")
            .storage_path;
        save_named(&service, &file.id, b"replacement", None);

        service
            .restore_version(&user.user_id, &file.id, &original_id)
            .expect("restore");

        let restored_key = current_key(&repo, &file.id);
        assert_eq!(
            std::fs::read(base.join(&restored_key)).expect("read"),
            b"original",
        );
        assert_ne!(
            restored_key, original_key,
            "the restore must not share bytes with the version it came from",
        );
        assert!(
            base.join(&original_key).exists(),
            "the version restored from is still in the history",
        );
        assert_eq!(list_versions(&service, &user.user_id, &file.id).len(), 3);
        let _ = std::fs::remove_dir_all(base);
    }

    /// A store whose counter drifted while it was hand-maintained heals on the
    /// next read rather than needing a migration or a manual reset.
    #[tokio::test]
    async fn a_stale_stored_counter_is_corrected_on_read() {
        let (service, repo, _perms, pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");
        let content = vec![7u8; 4096];
        upload(&service, &user, "photo.jpg", &content).await;

        // Rewind the column to a figure that no longer matches the rows —
        // which is the state a store is in after any hand-maintained counter
        // falls behind a delete or a layout change.
        let stale = content.len() as i64 * 3;
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
    /// version history already fills the store keeps uploading past their
    /// quota.
    #[tokio::test]
    async fn the_quota_limit_is_enforced_against_real_occupancy() {
        let (service, _repo, _perms, pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");
        let content = vec![7u8; 4096];
        let file = upload(&service, &user, "photo.jpg", &content).await;
        // Two versions on disk now: the upload and the checkpoint over it.
        save_named(&service, &file.id, &content, Some("checkpoint"));

        // Room for one more copy of the content on top of the *current*
        // version, but not on top of the history behind it.
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
            .expect_err("the history's bytes must count against the limit");

        assert_eq!(err.status, 413);
        assert_eq!(err.code, "QUOTA_EXCEEDED");
        let _ = std::fs::remove_dir_all(base);
    }

    // ── Pre-flight upload allowance (issue #102) ─────────────────────────────
    //
    // `MAX_UPLOAD_BYTES` used to be enforced nowhere: it was installed as an
    // actix `PayloadConfig`, which `actix_multipart::Multipart` never consults,
    // so a streamed body had no ceiling at all. Quota had one, but only at
    // commit time — after every byte was already written to disk. These cover
    // the figure the chunk loop now checks against as it streams.

    const GIB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn the_configured_ceiling_stops_an_upload_over_it() {
        let allowance = UploadAllowance::unmetered(1000);

        assert!(allowance.check(1000).is_ok(), "exactly the limit is allowed");
        let err = allowance.check(1001).expect_err("one byte over");
        assert_eq!(err.status, 413);
        assert_eq!(err.code, "PAYLOAD_TOO_LARGE");
    }

    #[test]
    fn an_unmetered_allowance_ignores_quota() {
        // Autosave and named versions write content that already exists, so
        // they are bounded by the ceiling and by nothing else.
        let allowance = UploadAllowance::unmetered(GIB);
        assert!(allowance.check(500 * 1024 * 1024).is_ok());
    }

    #[test]
    fn a_ceiling_above_i64_max_means_no_ceiling() {
        let allowance = UploadAllowance::unmetered(u64::MAX);
        assert!(allowance.check(i64::MAX).is_ok());
    }

    #[test]
    fn the_allowance_reports_which_limit_was_hit() {
        let allowance = UploadAllowance {
            max_upload_bytes: 10_000,
            quota_remaining: Some(5_000),
            daily_remaining: Some(1_000),
        };

        assert!(allowance.check(1_000).is_ok());
        // Tightest limit first, and each keeps its own status: a full quota is
        // permanent (413) while a spent daily cap is not (429).
        assert_eq!(allowance.check(1_001).unwrap_err().code, "DAILY_LIMIT_EXCEEDED");
        assert_eq!(allowance.check(1_001).unwrap_err().status, 429);

        let no_daily = UploadAllowance {
            daily_remaining: None,
            ..allowance
        };
        assert_eq!(no_daily.check(5_001).unwrap_err().code, "QUOTA_EXCEEDED");
        assert_eq!(no_daily.check(5_001).unwrap_err().status, 413);
    }

    /// The point of the whole exercise: an upload that cannot be committed is
    /// refused from the headroom worked out before it started, rather than
    /// after it has been written out in full and rejected by `finalize_upload`.
    #[tokio::test]
    async fn the_allowance_sees_a_full_quota_before_any_bytes_are_written() {
        let (service, _repo, _perms, pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");
        let content = vec![7u8; 4096];
        let file = upload(&service, &user, "photo.jpg", &content).await;
        save_named(&service, &file.id, &content, Some("checkpoint"));

        // Same arrangement as the commit-time test above: room for one more
        // copy of the content on top of the current version, but not on top of
        // the history behind it.
        let limit = content.len() as i64 * 2 + 1;
        diesel::update(crate::schema::user_quotas::table)
            .set(crate::schema::user_quotas::quota_bytes.eq(Some(limit)))
            .execute(&mut pool.get().expect("conn"))
            .expect("set limit");

        let allowance = service
            .upload_allowance(&user.user_id, 10 * GIB)
            .expect("allowance");

        let err = allowance
            .check(content.len() as i64)
            .expect_err("no room for a second copy");
        assert_eq!(err.code, "QUOTA_EXCEEDED");
        // ...and the headroom that *is* left is still offered.
        assert!(allowance.check(1).is_ok());
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn an_unset_quota_leaves_only_the_configured_ceiling() {
        let (service, _repo, _perms, _pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");

        let allowance = service.upload_allowance(&user.user_id, 1_000).expect("allowance");

        assert!(allowance.check(1_000).is_ok());
        assert_eq!(allowance.check(1_001).unwrap_err().code, "PAYLOAD_TOO_LARGE");
        let _ = std::fs::remove_dir_all(base);
    }

    /// A quota already over its limit yields zero headroom, not a negative one
    /// that would read as "anything goes" once compared against a size.
    #[tokio::test]
    async fn an_overdrawn_quota_leaves_no_headroom() {
        let (service, _repo, _perms, pool, base) = test_service_with_permissions();
        let user = test_user_named("user-1");
        upload(&service, &user, "photo.jpg", &vec![7u8; 4096]).await;

        diesel::update(crate::schema::user_quotas::table)
            .set(crate::schema::user_quotas::quota_bytes.eq(Some(1i64)))
            .execute(&mut pool.get().expect("conn"))
            .expect("set limit");

        let allowance = service
            .upload_allowance(&user.user_id, 10 * GIB)
            .expect("allowance");

        assert_eq!(allowance.check(1).unwrap_err().code, "QUOTA_EXCEEDED");
        assert!(allowance.check(0).is_ok());
        let _ = std::fs::remove_dir_all(base);
    }
}
