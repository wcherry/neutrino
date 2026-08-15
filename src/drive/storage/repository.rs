use crate::drive::storage::dto::FileOrderField;
use crate::drive::storage::model::{
    AutosaveFileContent, FileRecord, FileVersionRecord, NewFileRecord, NewFileVersionRecord,
    NewUserQuota, UpdateFileContent, UserQuota,
};
use crate::schema::{file_versions, files, user_quotas};
use crate::shared::{ApiError, ContentVersionCheck, ListQuery, OrderDirection};
use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct StorageRepository {
    pool: DbPool,
}

impl StorageRepository {
    pub fn new(pool: DbPool) -> Self {
        StorageRepository { pool }
    }

    pub fn insert_file(&self, new_file: NewFileRecord) -> Result<FileRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::insert_into(files::table)
            .values(&new_file)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert file error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        files::table
            .filter(files::id.eq(new_file.id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_files_by_user(
        &self,
        user_id: &str,
        query: &ListQuery<FileOrderField>,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        let order_by = query.order_by.unwrap_or(FileOrderField::CreatedAt);
        let direction = query.direction.unwrap_or(OrderDirection::Desc);

        let mut base = files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .limit(query.limit)
            .offset(query.offset)
            .into_boxed();

        if let Some(mt) = query.filters.get("mimeType") {
            base = base.filter(files::mime_type.eq(mt.clone()));
        }

        let result = match (order_by, direction) {
            (FileOrderField::Name, OrderDirection::Asc) => {
                base.order(files::name.asc()).load(&mut conn)
            }
            (FileOrderField::Name, OrderDirection::Desc) => {
                base.order(files::name.desc()).load(&mut conn)
            }
            (FileOrderField::Size, OrderDirection::Asc) => {
                base.order(files::size_bytes.asc()).load(&mut conn)
            }
            (FileOrderField::Size, OrderDirection::Desc) => {
                base.order(files::size_bytes.desc()).load(&mut conn)
            }
            (FileOrderField::CreatedAt, OrderDirection::Asc) => {
                base.order(files::created_at.asc()).load(&mut conn)
            }
            (FileOrderField::CreatedAt, OrderDirection::Desc) => {
                base.order(files::created_at.desc()).load(&mut conn)
            }
            (FileOrderField::UpdatedAt, OrderDirection::Asc) => {
                base.order(files::updated_at.asc()).load(&mut conn)
            }
            (FileOrderField::UpdatedAt, OrderDirection::Desc) => {
                base.order(files::updated_at.desc()).load(&mut conn)
            }
        };

        result.map_err(|e| {
            tracing::error!("DB list files error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn find_file(&self, file_id: &str, user_id: &str) -> Result<Option<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        files::table
            .filter(files::id.eq(file_id))
            .filter(files::user_id.eq(user_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find file error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_file_by_id(&self, file_id: &str) -> Result<Option<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        files::table
            .filter(files::id.eq(file_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find file by id error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_or_create_quota(&self, user_id: &str) -> Result<UserQuota, ApiError> {
        let mut conn = self.get_conn()?;

        let existing = user_quotas::table
            .filter(user_quotas::user_id.eq(user_id))
            .select(UserQuota::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get quota error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        if let Some(quota) = existing {
            return Ok(quota);
        }

        diesel::insert_into(user_quotas::table)
            .values(NewUserQuota { user_id })
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB create quota error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        user_quotas::table
            .filter(user_quotas::user_id.eq(user_id))
            .select(UserQuota::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get quota after create error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// The bytes this user actually occupies in the store, derived from the
    /// rows that own those bytes rather than from a running total.
    ///
    /// Two things are summed because two things sit on disk: each file's
    /// current content, and every version snapshot, which is a full copy of the
    /// content rather than a delta (see
    /// `StorageService::create_version_snapshot_record`). Every upload creates a
    /// v1 snapshot immediately, so a store holding only freshly uploaded files
    /// occupies twice the sum of `files.size_bytes` — the gap reported in #101.
    ///
    /// Trashed files are included: trashing sets `deleted_at` and leaves the
    /// blob alone, so those bytes are still spent until the trash is emptied.
    pub fn calculate_used_bytes(&self, user_id: &str) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;

        // `diesel::dsl::sum` over a BigInt column comes back as Numeric, which
        // sqlite hands out as a float — the wrong shape for byte counts, which
        // must stay exact past 2^53. COALESCE'd raw SQL keeps it an i64.
        let total_bytes = diesel::dsl::sql::<diesel::sql_types::BigInt>;

        let file_bytes: i64 = files::table
            .filter(files::user_id.eq(user_id))
            .select(total_bytes("COALESCE(SUM(size_bytes), 0)"))
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB sum file sizes error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let version_bytes: i64 = file_versions::table
            .filter(file_versions::user_id.eq(user_id))
            .select(total_bytes("COALESCE(SUM(size_bytes), 0)"))
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB sum version sizes error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(file_bytes + version_bytes)
    }

    /// Recompute `used_bytes` and write it back when it has drifted, returning
    /// the true figure.
    ///
    /// The column is a cache, not the source of truth. Keeping it current means
    /// anything reading the row directly (and the value an operator sees in the
    /// database) agrees with what quota checks and the UI report.
    pub fn refresh_used_bytes(&self, user_id: &str, cached: i64) -> Result<i64, ApiError> {
        let actual = self.calculate_used_bytes(user_id)?;
        if actual == cached {
            return Ok(actual);
        }

        let mut conn = self.get_conn()?;
        diesel::update(user_quotas::table.filter(user_quotas::user_id.eq(user_id)))
            .set(user_quotas::used_bytes.eq(actual))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB refresh used_bytes error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(actual)
    }

    /// Advance the daily upload counter after a committed upload.
    ///
    /// `used_bytes` is deliberately not touched here — it is derived from the
    /// file and version rows by [`Self::calculate_used_bytes`]. The daily
    /// counter genuinely is cumulative (it measures upload traffic, not
    /// occupancy) so it stays an incremented column.
    pub fn record_daily_upload(
        &self,
        user_id: &str,
        file_size: i64,
        prev_daily: i64,
        new_daily_reset: NaiveDateTime,
        reset_daily: bool,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        let new_daily = if reset_daily {
            file_size
        } else {
            prev_daily + file_size
        };

        diesel::update(user_quotas::table.filter(user_quotas::user_id.eq(user_id)))
            .set((
                user_quotas::daily_upload_bytes.eq(new_daily),
                user_quotas::daily_reset_at.eq(new_daily_reset),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update quota error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn update_file_content(
        &self,
        file_id: &str,
        user_id: &str,
        changeset: UpdateFileContent,
    ) -> Result<FileRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            files::table
                .filter(files::id.eq(file_id))
                .filter(files::user_id.eq(user_id)),
        )
        .set((
            &changeset,
            files::content_version.eq(files::content_version + 1),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update file content error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        files::table
            .filter(files::id.eq(file_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch updated file error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Flips a file's stored mime type (used by the per-app `promote` flow to
    /// convert a raw office file into a native Neutrino doc/sheet/slide).
    /// Scoped to `owner_id` the same way `update_file_content` is, so a
    /// caller passing the wrong owner id silently updates nothing.
    pub fn update_file_mime_type(
        &self,
        file_id: &str,
        owner_id: &str,
        mime_type: &str,
    ) -> Result<FileRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            files::table
                .filter(files::id.eq(file_id))
                .filter(files::user_id.eq(owner_id)),
        )
        .set((
            files::mime_type.eq(mime_type),
            files::updated_at.eq(Utc::now().naive_utc()),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update file mime type error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        files::table
            .filter(files::id.eq(file_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch mime-type-updated file error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    // ── Version methods ────────────────────────────────────────────────────────

    pub fn insert_version(
        &self,
        new_version: NewFileVersionRecord,
    ) -> Result<FileVersionRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::insert_into(file_versions::table)
            .values(&new_version)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert version error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        file_versions::table
            .filter(file_versions::id.eq(new_version.id))
            .select(FileVersionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after version insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_versions(&self, file_id: &str) -> Result<Vec<FileVersionRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        file_versions::table
            .filter(file_versions::file_id.eq(file_id))
            .select(FileVersionRecord::as_select())
            .order(file_versions::version_number.desc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list versions error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_version(
        &self,
        version_id: &str,
        file_id: &str,
        user_id: &str,
    ) -> Result<Option<FileVersionRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        file_versions::table
            .filter(file_versions::id.eq(version_id))
            .filter(file_versions::file_id.eq(file_id))
            .filter(file_versions::user_id.eq(user_id))
            .select(FileVersionRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find version error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn count_versions(&self, file_id: &str) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;

        file_versions::table
            .filter(file_versions::file_id.eq(file_id))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count versions error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn max_version_number(&self, file_id: &str) -> Result<i32, ApiError> {
        use diesel::dsl::max;
        let mut conn = self.get_conn()?;

        file_versions::table
            .filter(file_versions::file_id.eq(file_id))
            .select(max(file_versions::version_number))
            .first::<Option<i32>>(&mut conn)
            .map(|v| v.unwrap_or(0))
            .map_err(|e| {
                tracing::error!("DB max version number error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_version_label(
        &self,
        version_id: &str,
        file_id: &str,
        user_id: &str,
        label: Option<String>,
    ) -> Result<FileVersionRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            file_versions::table
                .filter(file_versions::id.eq(version_id))
                .filter(file_versions::file_id.eq(file_id))
                .filter(file_versions::user_id.eq(user_id)),
        )
        .set(file_versions::label.eq(&label))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update version label error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        file_versions::table
            .filter(file_versions::id.eq(version_id))
            .select(FileVersionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch updated version error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_version(
        &self,
        version_id: &str,
        file_id: &str,
        user_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;

        let version = file_versions::table
            .filter(file_versions::id.eq(version_id))
            .filter(file_versions::file_id.eq(file_id))
            .filter(file_versions::user_id.eq(user_id))
            .select(FileVersionRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find version for delete error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let Some(version) = version else {
            return Ok(None);
        };

        diesel::delete(file_versions::table.filter(file_versions::id.eq(version_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete version error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(Some(version.storage_path))
    }

    /// Deletes the oldest non-named version for a file and returns its storage_path for disk
    /// cleanup. Named versions (is_named = true) are never pruned automatically.
    #[allow(dead_code)]
    pub fn delete_oldest_version(&self, file_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;

        let oldest = file_versions::table
            .filter(file_versions::file_id.eq(file_id))
            .filter(file_versions::is_named.eq(false))
            .select(FileVersionRecord::as_select())
            .order(file_versions::version_number.asc())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find oldest version error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let Some(version) = oldest else {
            return Ok(None);
        };

        diesel::delete(file_versions::table.filter(file_versions::id.eq(&version.id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete oldest version error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(Some(version.storage_path))
    }

    /// Returns the created_at timestamp of the most recent version for a file, or None if no
    /// versions exist yet.
    #[allow(dead_code)]
    pub fn latest_version_created_at(
        &self,
        file_id: &str,
    ) -> Result<Option<NaiveDateTime>, ApiError> {
        use diesel::dsl::max;
        let mut conn = self.get_conn()?;

        file_versions::table
            .filter(file_versions::file_id.eq(file_id))
            .select(max(file_versions::created_at))
            .first::<Option<NaiveDateTime>>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB latest_version_created_at error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Overwrite a file's content row, optionally only if its `content_version`
    /// still matches what the caller last read.
    ///
    /// The version predicate lives in the `UPDATE`'s `WHERE` clause rather than
    /// a read followed by a write: two devices saving at the same instant would
    /// otherwise both read version N, both pass a separate check, and both
    /// write — exactly the lost update the check exists to prevent.
    pub fn update_file_autosave(
        &self,
        file_id: &str,
        owner_id: &str,
        changeset: AutosaveFileContent,
        check: ContentVersionCheck,
    ) -> Result<FileRecord, ApiError> {
        let mut conn = self.get_conn()?;

        let mut update = diesel::update(files::table)
            .filter(files::id.eq(file_id))
            .filter(files::user_id.eq(owner_id))
            .into_boxed();
        if let Some(expected) = check.enforced() {
            update = update.filter(files::content_version.eq(expected));
        }

        let rows = update
            .set((
                &changeset,
                files::content_version.eq(files::content_version + 1),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update file autosave error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let current = files::table
            .filter(files::id.eq(file_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB fetch autosaved file error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        match current {
            // Nothing matched and the file is gone, so the miss was not the
            // version check — report it as what it is.
            None => Err(ApiError::not_found("File not found")),
            Some(file) if rows == 0 => match check.enforced() {
                Some(expected) => Err(crate::shared::content_version::conflict_error(
                    file_id,
                    expected,
                    file.content_version,
                )),
                // An unguarded update matching nothing means the owner filter
                // rejected it: the file exists but belongs to someone else.
                None => Err(ApiError::not_found("File not found")),
            },
            Some(file) => Ok(file),
        }
    }

    pub fn set_cover_thumbnail(
        &self,
        file_id: &str,
        thumbnail: String,
        mime_type: String,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(files::table.filter(files::id.eq(file_id)))
            .set((
                files::cover_thumbnail.eq(Some(thumbnail)),
                files::cover_thumbnail_mime_type.eq(Some(mime_type)),
                files::updated_at.eq(chrono::Utc::now().naive_utc()),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB set cover thumbnail error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────
//
// Covers `update_file_mime_type` (issue #43 — in-place editing of MS Office
// docs). This method does not exist yet (TDD red phase): it is the plumbing
// step that lets the "convert on open" flow flip a raw .docx/.xlsx/.pptx
// file's stored mimetype to the matching native Neutrino type once a
// doc/sheet/slide row has been created for it (see the per-app `promote`
// service methods). These tests reference `update_file_mime_type` directly,
// so this file (and therefore the crate) will fail to *compile* until the
// method is implemented — the expected and normal shape of Rust TDD red phase
// for a method that doesn't exist yet, as opposed to a runtime assertion
// failure. Run with `cargo test --lib drive::storage::repository::tests`.

#[cfg(test)]
mod tests {
    use super::*;

    const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const NATIVE_DOC_MIME: &str = "application/x-neutrino-doc";

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
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
    fn update_file_mime_type_changes_the_stored_mime_type() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "file-1", "user-1", DOCX_MIME);

        let updated = repo
            .update_file_mime_type("file-1", "user-1", NATIVE_DOC_MIME)
            .expect("update mime type");

        assert_eq!(updated.mime_type, NATIVE_DOC_MIME);
    }

    #[test]
    fn update_file_mime_type_persists_across_a_fresh_lookup() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "file-2", "user-1", DOCX_MIME);

        repo.update_file_mime_type("file-2", "user-1", NATIVE_DOC_MIME)
            .expect("update mime type");

        let refetched = repo
            .find_file_by_id("file-2")
            .expect("find file")
            .expect("file exists");
        assert_eq!(refetched.mime_type, NATIVE_DOC_MIME);
    }

    #[test]
    fn update_file_mime_type_does_not_affect_other_files() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "file-3", "user-1", DOCX_MIME);
        insert_test_file(&repo, "file-4", "user-1", DOCX_MIME);

        repo.update_file_mime_type("file-3", "user-1", NATIVE_DOC_MIME)
            .expect("update mime type");

        let untouched = repo
            .find_file_by_id("file-4")
            .expect("find file")
            .expect("file exists");
        assert_eq!(untouched.mime_type, DOCX_MIME);
    }

    #[test]
    fn update_file_mime_type_scoped_to_owner_does_not_update_other_users_file() {
        // Mirrors update_file_content's owner-scoping: the changeset filters
        // by (file_id, user_id), so calling with the wrong owner id must not
        // silently mutate a file owned by someone else.
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "file-5", "owner-a", DOCX_MIME);

        let _ = repo.update_file_mime_type("file-5", "owner-b", NATIVE_DOC_MIME);

        let untouched = repo
            .find_file_by_id("file-5")
            .expect("find file")
            .expect("file exists");
        assert_eq!(untouched.mime_type, DOCX_MIME);
    }

    #[test]
    fn update_file_autosave_bumps_content_version_by_one_each_call() {
        let repo = StorageRepository::new(test_pool());
        let inserted = insert_test_file(&repo, "file-6", "user-1", DOCX_MIME);
        assert_eq!(inserted.content_version, 1);

        let after_first = repo
            .update_file_autosave(
                "file-6",
                "user-1",
                AutosaveFileContent {
                    size_bytes: 10,
                    storage_path: "path-a".to_string(),
                    updated_at: Utc::now().naive_utc(),
                },
                ContentVersionCheck::UNCHECKED,
            )
            .expect("first autosave");
        assert_eq!(after_first.content_version, 2);

        let after_second = repo
            .update_file_autosave(
                "file-6",
                "user-1",
                AutosaveFileContent {
                    size_bytes: 20,
                    storage_path: "path-b".to_string(),
                    updated_at: Utc::now().naive_utc(),
                },
                ContentVersionCheck::UNCHECKED,
            )
            .expect("second autosave");
        assert_eq!(after_second.content_version, 3);
    }

    fn autosave_with(
        repo: &StorageRepository,
        file_id: &str,
        check: ContentVersionCheck,
    ) -> Result<FileRecord, ApiError> {
        repo.update_file_autosave(
            file_id,
            "user-1",
            AutosaveFileContent {
                size_bytes: 42,
                storage_path: "path-checked".to_string(),
                updated_at: Utc::now().naive_utc(),
            },
            check,
        )
    }

    #[test]
    fn autosave_with_a_matching_expected_version_is_accepted() {
        let repo = StorageRepository::new(test_pool());
        let inserted = insert_test_file(&repo, "file-cv-1", "user-1", DOCX_MIME);

        let saved = autosave_with(
            &repo,
            "file-cv-1",
            ContentVersionCheck {
                expected: Some(inserted.content_version),
                force: false,
            },
        )
        .expect("matching version");
        assert_eq!(saved.content_version, 2);
    }

    #[test]
    fn autosave_with_a_stale_expected_version_is_rejected_and_writes_nothing() {
        // Two devices hold version 1. The first saves (making it 2); the
        // second must not be allowed to overwrite that with its older copy.
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "file-cv-2", "user-1", DOCX_MIME);
        autosave_with(
            &repo,
            "file-cv-2",
            ContentVersionCheck {
                expected: Some(1),
                force: false,
            },
        )
        .expect("first device saves");

        let err = autosave_with(
            &repo,
            "file-cv-2",
            ContentVersionCheck {
                expected: Some(1),
                force: false,
            },
        )
        .expect_err("second device is stale");
        assert_eq!(err.status, 409);
        assert_eq!(err.code, "CONTENT_VERSION_CONFLICT");

        let stored = repo
            .find_file_by_id("file-cv-2")
            .expect("find file")
            .expect("file exists");
        assert_eq!(
            stored.content_version, 2,
            "a rejected save must not bump the version"
        );
        assert_eq!(
            stored.size_bytes, 42,
            "the rejected save must not have replaced the first device's row"
        );
    }

    #[test]
    fn autosave_with_force_overwrites_a_stale_version() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "file-cv-3", "user-1", DOCX_MIME);
        autosave_with(&repo, "file-cv-3", ContentVersionCheck::UNCHECKED).expect("first save");

        let forced = autosave_with(
            &repo,
            "file-cv-3",
            ContentVersionCheck {
                expected: Some(1),
                force: true,
            },
        )
        .expect("force wins");
        assert_eq!(forced.content_version, 3);
    }

    #[test]
    fn an_unchecked_autosave_of_someone_elses_file_is_not_found_not_a_conflict() {
        // The owner filter and the version filter both make the UPDATE match
        // zero rows; only the latter is a conflict.
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "file-cv-4", "owner-a", DOCX_MIME);

        let err = repo
            .update_file_autosave(
                "file-cv-4",
                "owner-b",
                AutosaveFileContent {
                    size_bytes: 1,
                    storage_path: "nope".to_string(),
                    updated_at: Utc::now().naive_utc(),
                },
                ContentVersionCheck::UNCHECKED,
            )
            .expect_err("wrong owner");
        assert_eq!(err.status, 404);
    }

    // ── Derived quota usage (issue #101) ─────────────────────────────────────

    fn insert_sized_file(repo: &StorageRepository, id: &str, user_id: &str, size_bytes: i64) {
        repo.insert_file(NewFileRecord {
            id,
            user_id,
            name: "photo.jpg",
            size_bytes,
            mime_type: "image/jpeg",
            storage_path: "",
            folder_id: None,
            encrypted_metadata: None,
        })
        .expect("insert file");
    }

    fn insert_sized_version(
        repo: &StorageRepository,
        id: &str,
        file_id: &str,
        user_id: &str,
        version_number: i32,
        size_bytes: i64,
    ) {
        repo.insert_version(NewFileVersionRecord {
            id,
            file_id,
            user_id,
            version_number,
            size_bytes,
            storage_path: "",
            label: None,
            is_named: false,
        })
        .expect("insert version");
    }

    #[test]
    fn calculate_used_bytes_is_zero_for_a_user_with_nothing_stored() {
        let repo = StorageRepository::new(test_pool());
        assert_eq!(repo.calculate_used_bytes("user-1").expect("sum"), 0);
    }

    /// The core of the bug: version snapshots are full copies on disk, so they
    /// have to be summed alongside the file content.
    #[test]
    fn calculate_used_bytes_sums_file_content_and_version_snapshots() {
        let repo = StorageRepository::new(test_pool());
        insert_sized_file(&repo, "file-q1", "user-1", 1000);
        insert_sized_version(&repo, "ver-q1", "file-q1", "user-1", 1, 1000);
        insert_sized_version(&repo, "ver-q2", "file-q1", "user-1", 2, 250);

        assert_eq!(repo.calculate_used_bytes("user-1").expect("sum"), 2250);
    }

    #[test]
    fn calculate_used_bytes_is_scoped_to_one_user() {
        let repo = StorageRepository::new(test_pool());
        insert_sized_file(&repo, "file-q2", "user-1", 1000);
        insert_sized_version(&repo, "ver-q3", "file-q2", "user-1", 1, 1000);
        insert_sized_file(&repo, "file-q3", "user-2", 9999);
        insert_sized_version(&repo, "ver-q4", "file-q3", "user-2", 1, 9999);

        assert_eq!(repo.calculate_used_bytes("user-1").expect("sum"), 2000);
    }

    /// Trashing sets `deleted_at` and leaves the blob in place, so the bytes
    /// are still spent — reporting them as free would let a user overshoot
    /// their quota by filling the trash.
    #[test]
    fn calculate_used_bytes_still_counts_trashed_files() {
        let repo = StorageRepository::new(test_pool());
        insert_sized_file(&repo, "file-q4", "user-1", 1000);
        diesel::update(files::table.filter(files::id.eq("file-q4")))
            .set(files::deleted_at.eq(Some(Utc::now().naive_utc())))
            .execute(&mut repo.get_conn().expect("conn"))
            .expect("trash");

        assert_eq!(repo.calculate_used_bytes("user-1").expect("sum"), 1000);
    }

    #[test]
    fn refresh_used_bytes_writes_the_corrected_total_back() {
        let repo = StorageRepository::new(test_pool());
        repo.get_or_create_quota("user-1").expect("quota row");
        insert_sized_file(&repo, "file-q5", "user-1", 1000);
        insert_sized_version(&repo, "ver-q5", "file-q5", "user-1", 1, 1000);

        let refreshed = repo.refresh_used_bytes("user-1", 1000).expect("refresh");

        assert_eq!(refreshed, 2000);
        assert_eq!(
            repo.get_or_create_quota("user-1").expect("quota").used_bytes,
            2000
        );
    }

    /// The refresh runs on every quota read, so an unchanged total must not
    /// cost a write.
    #[test]
    fn refresh_used_bytes_returns_an_unchanged_total_without_writing() {
        let repo = StorageRepository::new(test_pool());
        repo.get_or_create_quota("user-1").expect("quota row");
        insert_sized_file(&repo, "file-q6", "user-1", 1000);

        assert_eq!(repo.refresh_used_bytes("user-1", 1000).expect("refresh"), 1000);
        assert_eq!(
            repo.get_or_create_quota("user-1").expect("quota").used_bytes,
            0,
            "an in-sync value must not trigger an UPDATE"
        );
    }

    /// `record_daily_upload` owns the rate-limit counters only; occupancy is
    /// derived, so it must leave `used_bytes` alone.
    #[test]
    fn record_daily_upload_advances_the_daily_counter_only() {
        let repo = StorageRepository::new(test_pool());
        repo.get_or_create_quota("user-1").expect("quota row");
        let now = Utc::now().naive_utc();

        repo.record_daily_upload("user-1", 500, 200, now, false)
            .expect("record upload");

        let quota = repo.get_or_create_quota("user-1").expect("quota");
        assert_eq!(quota.daily_upload_bytes, 700);
        assert_eq!(quota.used_bytes, 0);
    }

    #[test]
    fn record_daily_upload_restarts_the_counter_on_a_new_day() {
        let repo = StorageRepository::new(test_pool());
        repo.get_or_create_quota("user-1").expect("quota row");
        let now = Utc::now().naive_utc();

        repo.record_daily_upload("user-1", 500, 9_000, now, true)
            .expect("record upload");

        assert_eq!(
            repo.get_or_create_quota("user-1")
                .expect("quota")
                .daily_upload_bytes,
            500
        );
    }

    #[test]
    fn update_file_content_bumps_content_version_by_one() {
        let repo = StorageRepository::new(test_pool());
        let inserted = insert_test_file(&repo, "file-7", "user-1", DOCX_MIME);
        assert_eq!(inserted.content_version, 1);

        let updated = repo
            .update_file_content(
                "file-7",
                "user-1",
                UpdateFileContent {
                    size_bytes: 30,
                    storage_path: "path-c".to_string(),
                    updated_at: Utc::now().naive_utc(),
                },
            )
            .expect("update content");
        assert_eq!(updated.content_version, 2);
    }
}
