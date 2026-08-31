use crate::drive::storage::dto::FileOrderField;
use crate::drive::storage::model::{
    AutosaveFileContent, FileRecord, FileVersionRecord, ImportProvenance, NewFileRecord,
    NewFileVersionRecord, NewUserQuota, UpdateFileContent, UserQuota,
};
use crate::schema::{file_versions, files, user_quotas};
use crate::shared::{ApiError, ContentVersionCheck, ListQuery, OrderDirection};
use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// The `mimeType` types a listing query asks for, or `None` for "any".
///
/// `mimeType` takes a comma-separated list, not just one value. Docs, Sheets
/// and Slides each span two formats now — the OOXML one every new document is
/// created in, and the bespoke JSON that predates it (see `native_types`) —
/// and a library that asked for only one of them would show half a user's
/// documents. Shared by the listing and its count so the two cannot disagree
/// about what they are paging over.
fn mime_type_filter(query: &ListQuery<FileOrderField>) -> Option<Vec<String>> {
    let wanted: Vec<String> = query
        .filters
        .get("mimeType")?
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    (!wanted.is_empty()).then_some(wanted)
}

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

    /// Stamp a file with the dates it had before it was imported, plus the
    /// record of where those dates came from.
    ///
    /// Scoped to `user_id` like every other update here, and to a file that is
    /// not in the trash: a trashed row's dates are what the Trash view sorts
    /// on, and an import has no business reaching into it.
    pub fn apply_import_provenance(
        &self,
        file_id: &str,
        user_id: &str,
        provenance: ImportProvenance,
    ) -> Result<FileRecord, ApiError> {
        let mut conn = self.get_conn()?;

        let updated = diesel::update(
            files::table
                .filter(files::id.eq(file_id))
                .filter(files::user_id.eq(user_id))
                .filter(files::deleted_at.is_null()),
        )
        .set(provenance)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB import provenance error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        if updated == 0 {
            return Err(ApiError::not_found("File not found"));
        }

        files::table
            .filter(files::id.eq(file_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after import provenance error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// How many files the same query matches, ignoring its `limit`/`offset`.
    ///
    /// The listing endpoint reports this as `total`, which is what lets a
    /// paging client stop after the last page instead of asking for one more
    /// to discover it is empty (issue: a repeated `?limit=200&offset=200` on
    /// a drive holding exactly 200 files).
    pub fn count_files_by_user(
        &self,
        user_id: &str,
        query: &ListQuery<FileOrderField>,
    ) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;

        let mut base = files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .into_boxed();

        if let Some(wanted) = mime_type_filter(query) {
            base = base.filter(files::mime_type.eq_any(wanted));
        }

        base.count().get_result(&mut conn).map_err(|e| {
            tracing::error!("DB count files error: {:?}", e);
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

        if let Some(wanted) = mime_type_filter(query) {
            base = base.filter(files::mime_type.eq_any(wanted));
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
    /// One byte on disk is counted once.
    ///
    /// Every version of a file — the live one included — is a row in
    /// `file_versions` and a separate blob in the file's directory, so summing
    /// that table is the whole occupancy. `files.size_bytes` is deliberately
    /// *not* added to it: it describes the same bytes as the version row
    /// `files.storage_path` points at, and adding both is what made a store of
    /// freshly uploaded files report double (#101) back when the current
    /// content really was written out twice.
    ///
    /// The second term covers files with no version rows at all — a record
    /// created ahead of its content, and any file left over from before
    /// migration 118 — so their bytes are not silently free.
    ///
    /// Trashed files are included: trashing sets `deleted_at` and leaves the
    /// blobs alone, so those bytes are still spent until the trash is emptied.
    pub fn calculate_used_bytes(&self, user_id: &str) -> Result<i64, ApiError> {
        use diesel::sql_types::{BigInt, Text};

        #[derive(diesel::QueryableByName)]
        struct Total {
            #[diesel(sql_type = BigInt)]
            total: i64,
        }

        let mut conn = self.get_conn()?;

        // Raw SQL rather than `diesel::dsl::sum`, which comes back as Numeric
        // and reaches Rust as a float — the wrong shape for byte counts, which
        // must stay exact past 2^53.
        let rows: Vec<Total> = diesel::sql_query(
            "SELECT COALESCE((SELECT SUM(size_bytes) FROM file_versions WHERE user_id = ?), 0) \
                  + COALESCE((SELECT SUM(size_bytes) FROM files f WHERE f.user_id = ? \
                       AND NOT EXISTS (SELECT 1 FROM file_versions v WHERE v.file_id = f.id)), 0) \
                    AS total",
        )
        .bind::<Text, _>(user_id)
        .bind::<Text, _>(user_id)
        .load(&mut conn)
        .map_err(|e| {
            tracing::error!("DB sum used bytes error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(rows.first().map(|r| r.total).unwrap_or(0))
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

    // ── Version methods ────────────────────────────────────────────────────────

    /// Insert `new_version` as the file's next snapshot, numbering it here.
    ///
    /// The number is `max(version_number) + 1` over the file's existing rows,
    /// read and written under one `BEGIN IMMEDIATE`. Both halves have to be in
    /// the same write transaction: two saves of the same file used to read the
    /// same maximum on separate pooled connections and then both insert it,
    /// which the unique index on `(file_id, version_number)` rejected — a 500
    /// on save, and a lost snapshot, for whichever writer came second.
    ///
    /// `IMMEDIATE` rather than a deferred `BEGIN` because the body reads before
    /// it writes, and SQLite refuses to run the busy handler for that upgrade;
    /// see `AuthRepository::publish_public_key` for the same reasoning.
    pub fn insert_version(
        &self,
        new_version: NewFileVersionRecord,
    ) -> Result<FileVersionRecord, ApiError> {
        use diesel::dsl::max;

        let mut conn = self.get_conn()?;

        conn.immediate_transaction::<FileVersionRecord, diesel::result::Error, _>(|conn| {
            let next_number = file_versions::table
                .filter(file_versions::file_id.eq(new_version.file_id))
                .select(max(file_versions::version_number))
                .first::<Option<i32>>(conn)?
                .unwrap_or(0)
                + 1;

            diesel::insert_into(file_versions::table)
                .values((
                    &new_version,
                    file_versions::version_number.eq(next_number),
                ))
                .execute(conn)?;

            file_versions::table
                .filter(file_versions::id.eq(new_version.id))
                .select(FileVersionRecord::as_select())
                .first(conn)
        })
        .map_err(|e| {
            tracing::error!("DB insert version error: {:?}", e);
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

    /// The version row that owns the file's live bytes.
    ///
    /// The current content is a version like any other now that both live in
    /// the same directory, so "which one is current" is answered by the key
    /// `files.storage_path` holds rather than by a flag that could drift from
    /// it. Returns `None` for a file that has no content yet (empty key) and
    /// for one still on the pre-118 layout, whose key names no version row.
    pub fn find_current_version(
        &self,
        file_id: &str,
        storage_path: &str,
    ) -> Result<Option<FileVersionRecord>, ApiError> {
        if storage_path.is_empty() {
            return Ok(None);
        }
        let mut conn = self.get_conn()?;

        file_versions::table
            .filter(file_versions::file_id.eq(file_id))
            .filter(file_versions::storage_path.eq(storage_path))
            .select(FileVersionRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find current version error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Record a new byte count against a version whose blob was rewritten.
    ///
    /// Autosave writes over the live version rather than adding one, so its
    /// row is the only place the new size can be recorded — and the quota is
    /// summed from those rows.
    pub fn update_version_size(&self, version_id: &str, size_bytes: i64) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(file_versions::table.filter(file_versions::id.eq(version_id)))
            .set(file_versions::size_bytes.eq(size_bytes))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update version size error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
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

    // A `delete_oldest_version` used to sit here, unused, as half of a
    // never-wired prune-on-write scheme. Retention is the background worker's
    // job now (`worker/src/versions.rs`) and its rules come from
    // `version_retention_settings`, so a second, hardcoded one would only be a
    // second answer to the same question.

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
                files::updated_at.eq(Utc::now().naive_utc()),
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

#[cfg(test)]
mod tests {
    use super::*;

    const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

    // ── The mimeType filter (issue #127) ──────────────────────────────────────
    //
    // Docs, Sheets and Slides create OOXML now but still open the bespoke JSON
    // written before that, so each library asks for both of its mime types in
    // one call. A filter that only understood a single value would show half a
    // user's documents and hide the rest with no error anywhere.

    const NATIVE_DOC_MIME: &str = "application/x-neutrino-doc";

    fn mime_filter_query(mime_type: &str) -> ListQuery<FileOrderField> {
        ListQuery {
            limit: 50,
            offset: 0,
            order_by: None,
            direction: None,
            filters: std::collections::HashMap::from([(
                "mimeType".to_string(),
                mime_type.to_string(),
            )]),
        }
    }

    #[test]
    fn one_mime_type_lists_only_files_of_that_type() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "docx-1", "user-1", DOCX_MIME);
        insert_test_file(&repo, "json-1", "user-1", NATIVE_DOC_MIME);

        let listed = repo
            .list_files_by_user("user-1", &mime_filter_query(DOCX_MIME))
            .expect("list files");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "docx-1");
    }

    #[test]
    fn a_comma_separated_mime_type_lists_every_type_in_the_list() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "docx-1", "user-1", DOCX_MIME);
        insert_test_file(&repo, "json-1", "user-1", NATIVE_DOC_MIME);
        insert_test_file(&repo, "other-1", "user-1", "text/plain");

        let listed = repo
            .list_files_by_user(
                "user-1",
                &mime_filter_query(&format!("{DOCX_MIME},{NATIVE_DOC_MIME}")),
            )
            .expect("list files");

        let mut ids: Vec<&str> = listed.iter().map(|f| f.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["docx-1", "json-1"]);
    }

    /// An empty or all-separator value must not silently narrow the listing to
    /// nothing — a query string built from an empty array would do exactly that.
    #[test]
    fn an_empty_mime_type_filter_is_ignored_rather_than_matching_nothing() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "docx-1", "user-1", DOCX_MIME);

        let listed = repo
            .list_files_by_user("user-1", &mime_filter_query(" , "))
            .expect("list files");

        assert_eq!(listed.len(), 1);
    }

    // ── The listing count ─────────────────────────────────────────────────────
    //
    // `total` used to be the length of the page just built, so a client paging
    // with `offset` could only discover the end by fetching one more page and
    // finding it empty.

    fn page_query(limit: i64, offset: i64) -> ListQuery<FileOrderField> {
        ListQuery {
            limit,
            offset,
            order_by: None,
            direction: None,
            filters: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn the_count_ignores_the_page_and_reports_every_matching_file() {
        let repo = StorageRepository::new(test_pool());
        for i in 0..5 {
            insert_test_file(&repo, &format!("file-{i}"), "user-1", DOCX_MIME);
        }
        insert_test_file(&repo, "other-user", "user-2", DOCX_MIME);

        let page = repo
            .list_files_by_user("user-1", &page_query(2, 0))
            .expect("list files");
        let total = repo
            .count_files_by_user("user-1", &page_query(2, 0))
            .expect("count files");

        assert_eq!(page.len(), 2);
        assert_eq!(total, 5);
    }

    #[test]
    fn the_count_applies_the_same_mime_type_filter_as_the_listing() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "docx-1", "user-1", DOCX_MIME);
        insert_test_file(&repo, "docx-2", "user-1", DOCX_MIME);
        insert_test_file(&repo, "json-1", "user-1", NATIVE_DOC_MIME);

        let total = repo
            .count_files_by_user("user-1", &mime_filter_query(DOCX_MIME))
            .expect("count files");

        assert_eq!(total, 2);
    }

    #[test]
    fn the_count_leaves_out_trashed_files() {
        let repo = StorageRepository::new(test_pool());
        insert_test_file(&repo, "kept", "user-1", DOCX_MIME);
        insert_test_file(&repo, "binned", "user-1", DOCX_MIME);
        diesel::update(files::table.filter(files::id.eq("binned")))
            .set(files::deleted_at.eq(Some(Utc::now().naive_utc())))
            .execute(&mut repo.get_conn().expect("conn"))
            .expect("trash");

        let total = repo
            .count_files_by_user("user-1", &page_query(50, 0))
            .expect("count files");

        assert_eq!(total, 1);
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

    /// Version numbers are assigned by `insert_version`, so calls here just run
    /// in the order the numbering should come out.
    fn insert_sized_version(
        repo: &StorageRepository,
        id: &str,
        file_id: &str,
        user_id: &str,
        size_bytes: i64,
    ) {
        repo.insert_version(NewFileVersionRecord {
            id,
            file_id,
            user_id,
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

    /// Every version is one blob in the file's directory, current content
    /// included, so the sum is over the version rows alone. Adding
    /// `files.size_bytes` on top would count the live version twice.
    #[test]
    fn calculate_used_bytes_sums_every_version_once() {
        let repo = StorageRepository::new(test_pool());
        insert_sized_file(&repo, "file-q1", "user-1", 1000);
        insert_sized_version(&repo, "ver-q1", "file-q1", "user-1", 1000);
        insert_sized_version(&repo, "ver-q2", "file-q1", "user-1", 250);

        assert_eq!(repo.calculate_used_bytes("user-1").expect("sum"), 1250);
    }

    /// A file whose content predates the one-directory layout, or which was
    /// recorded before its bytes landed, has no version rows — its own size is
    /// the only figure there is, and dropping it would make the bytes free.
    #[test]
    fn calculate_used_bytes_falls_back_to_files_without_versions() {
        let repo = StorageRepository::new(test_pool());
        insert_sized_file(&repo, "file-q7", "user-1", 700);

        assert_eq!(repo.calculate_used_bytes("user-1").expect("sum"), 700);
    }

    #[test]
    fn calculate_used_bytes_is_scoped_to_one_user() {
        let repo = StorageRepository::new(test_pool());
        insert_sized_file(&repo, "file-q2", "user-1", 1000);
        insert_sized_version(&repo, "ver-q3", "file-q2", "user-1", 1000);
        insert_sized_file(&repo, "file-q3", "user-2", 9999);
        insert_sized_version(&repo, "ver-q4", "file-q3", "user-2", 9999);

        assert_eq!(repo.calculate_used_bytes("user-1").expect("sum"), 1000);
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
        insert_sized_version(&repo, "ver-q5", "file-q5", "user-1", 1000);
        insert_sized_version(&repo, "ver-q5b", "file-q5", "user-1", 1000);

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

    // ── Version numbering ────────────────────────────────────────────────────

    #[test]
    fn insert_version_numbers_snapshots_sequentially_per_file() {
        let repo = StorageRepository::new(test_pool());
        insert_sized_file(&repo, "file-v1", "user-1", 10);
        insert_sized_file(&repo, "file-v2", "user-1", 10);

        insert_sized_version(&repo, "ver-v1", "file-v1", "user-1", 10);
        insert_sized_version(&repo, "ver-v2", "file-v1", "user-1", 10);
        insert_sized_version(&repo, "ver-v3", "file-v2", "user-1", 10);

        let numbers = |file_id: &str| {
            let mut nums: Vec<i32> = repo
                .list_versions(file_id)
                .expect("list")
                .iter()
                .map(|v| v.version_number)
                .collect();
            nums.sort_unstable();
            nums
        };

        assert_eq!(numbers("file-v1"), vec![1, 2]);
        assert_eq!(
            numbers("file-v2"),
            vec![1],
            "numbering restarts per file, not per table"
        );
    }

    /// The regression: two saves of one file used to read `max(version_number)`
    /// on separate pooled connections, both compute the same next number, and
    /// both insert it — the second losing its snapshot to a `UNIQUE constraint
    /// failed: file_versions.file_id, file_versions.version_number` surfaced as
    /// a 500. Needs a real file database and more than one connection, since
    /// the `:memory:` pool the other tests use is capped at one.
    #[test]
    fn concurrent_inserts_on_one_file_all_get_distinct_numbers() {
        use crate::search::repository::test_file_pool;
        use std::sync::Arc;

        let (pool, _db) = test_file_pool("file-versions");
        let repo = Arc::new(StorageRepository::new(pool));
        insert_sized_file(&repo, "file-race", "user-1", 10);

        const WRITERS: usize = 8;
        let handles: Vec<_> = (0..WRITERS)
            .map(|i| {
                let repo = Arc::clone(&repo);
                std::thread::spawn(move || {
                    let id = format!("ver-race-{i}");
                    repo.insert_version(NewFileVersionRecord {
                        id: &id,
                        file_id: "file-race",
                        user_id: "user-1",
                        size_bytes: 10,
                        storage_path: "",
                        label: None,
                        is_named: false,
                    })
                    .map(|v| v.version_number)
                })
            })
            .collect();

        let mut numbers: Vec<i32> = handles
            .into_iter()
            .map(|h| h.join().expect("writer thread").expect("insert version"))
            .collect();
        numbers.sort_unstable();

        assert_eq!(
            numbers,
            (1..=WRITERS as i32).collect::<Vec<_>>(),
            "every concurrent writer must land its own snapshot number"
        );
    }
}
