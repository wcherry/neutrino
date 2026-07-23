use crate::drive::storage::dto::FileOrderField;
use crate::drive::storage::model::{
    AutosaveFileContent, FileRecord, FileVersionRecord, NewFileRecord, NewFileVersionRecord,
    NewUserQuota, UpdateFileContent, UserQuota,
};
use crate::schema::{file_versions, files, user_quotas};
use crate::shared::{ApiError, ListQuery, OrderDirection};
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

    pub fn update_quota_after_upload(
        &self,
        user_id: &str,
        file_size: i64,
        prev_used: i64,
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
                user_quotas::used_bytes.eq(prev_used + file_size),
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

    pub fn update_file_autosave(
        &self,
        file_id: &str,
        owner_id: &str,
        changeset: AutosaveFileContent,
    ) -> Result<FileRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            files::table
                .filter(files::id.eq(file_id))
                .filter(files::user_id.eq(owner_id)),
        )
        .set((
            &changeset,
            files::content_version.eq(files::content_version + 1),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update file autosave error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        files::table
            .filter(files::id.eq(file_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch autosaved file error: {:?}", e);
                ApiError::internal("Database error")
            })
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
            )
            .expect("second autosave");
        assert_eq!(after_second.content_version, 3);
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
