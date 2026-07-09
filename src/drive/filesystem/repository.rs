use crate::drive::filesystem::model::{
    FolderRecord, NewFolderRecord, NewShortcutRecord, ShortcutRecord, TrashFolderRecord,
    UpdateFolderRecord,
};
use crate::drive::storage::model::FileRecord;
use crate::schema::{files, folders, shortcuts};
use crate::shared::ApiError;
use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct FilesystemRepository {
    pool: DbPool,
}

impl FilesystemRepository {
    pub fn new(pool: DbPool) -> Self {
        FilesystemRepository { pool }
    }

    // ── Folder operations ─────────────────────────────────────────────────────

    pub fn create_folder(&self, record: NewFolderRecord) -> Result<FolderRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::insert_into(folders::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB create folder error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        folders::table
            .filter(folders::id.eq(record.id))
            .select(FolderRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query folder after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_folder(
        &self,
        folder_id: &str,
        user_id: &str,
    ) -> Result<Option<FolderRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        folders::table
            .filter(folders::id.eq(folder_id))
            .filter(folders::user_id.eq(user_id))
            .filter(folders::deleted_at.is_null())
            .select(FolderRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find folder error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_folder_by_id(&self, folder_id: &str) -> Result<Option<FolderRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        folders::table
            .filter(folders::id.eq(folder_id))
            .filter(folders::deleted_at.is_null())
            .select(FolderRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find folder by id error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_folder(
        &self,
        folder_id: &str,
        user_id: &str,
        changeset: UpdateFolderRecord,
    ) -> Result<FolderRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            folders::table
                .filter(folders::id.eq(folder_id))
                .filter(folders::user_id.eq(user_id))
                .filter(folders::deleted_at.is_null()),
        )
        .set(&changeset)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update folder error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        self.find_folder(folder_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Folder not found"))
    }

    pub fn trash_folder(&self, folder_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        diesel::update(
            folders::table
                .filter(folders::id.eq(folder_id))
                .filter(folders::user_id.eq(user_id))
                .filter(folders::deleted_at.is_null()),
        )
        .set(TrashFolderRecord {
            deleted_at: Some(now),
            updated_at: now,
        })
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB trash folder error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    pub fn list_subfolders(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<FolderRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        let result = match parent_id {
            Some(pid) => folders::table
                .filter(folders::user_id.eq(user_id))
                .filter(folders::parent_id.eq(pid))
                .filter(folders::deleted_at.is_null())
                .select(FolderRecord::as_select())
                .order(folders::name.asc())
                .load(&mut conn),
            None => folders::table
                .filter(folders::user_id.eq(user_id))
                .filter(folders::parent_id.is_null())
                .filter(folders::deleted_at.is_null())
                .select(FolderRecord::as_select())
                .order(folders::name.asc())
                .load(&mut conn),
        };

        result.map_err(|e| {
            tracing::error!("DB list subfolders error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn list_files_in_folder(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        let result = match folder_id {
            Some(fid) => files::table
                .filter(files::user_id.eq(user_id))
                .filter(files::folder_id.eq(fid))
                .filter(files::deleted_at.is_null())
                .select(FileRecord::as_select())
                .order(files::name.asc())
                .load(&mut conn),
            None => files::table
                .filter(files::user_id.eq(user_id))
                .filter(files::folder_id.is_null())
                .filter(files::deleted_at.is_null())
                .select(FileRecord::as_select())
                .order(files::name.asc())
                .load(&mut conn),
        };

        result.map_err(|e| {
            tracing::error!("DB list files in folder error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    // ── File update operations ────────────────────────────────────────────────

    pub fn update_file(
        &self,
        file_id: &str,
        user_id: &str,
        name: Option<&str>,
        folder_id: Option<Option<&str>>,
        is_starred: Option<bool>,
    ) -> Result<FileRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        // Build updates dynamically using raw SQL-compatible approach
        let base = files::table
            .filter(files::id.eq(file_id))
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null());

        // Apply each optional update in sequence
        if let Some(n) = name {
            diesel::update(base)
                .set((files::name.eq(n), files::updated_at.eq(now)))
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB update file name error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        }

        if let Some(fid) = folder_id {
            match fid {
                Some(id) => diesel::update(base)
                    .set((files::folder_id.eq(Some(id)), files::updated_at.eq(now)))
                    .execute(&mut conn),
                None => diesel::update(base)
                    .set((
                        files::folder_id.eq(None::<String>),
                        files::updated_at.eq(now),
                    ))
                    .execute(&mut conn),
            }
            .map_err(|e| {
                tracing::error!("DB update file folder_id error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        }

        if let Some(starred) = is_starred {
            let starred_at: Option<chrono::NaiveDateTime> = if starred { Some(now) } else { None };
            diesel::update(base)
                .set((
                    files::is_starred.eq(starred),
                    files::starred_at.eq(starred_at),
                    files::updated_at.eq(now),
                ))
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB update file star error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        }

        files::table
            .filter(files::id.eq(file_id))
            .filter(files::user_id.eq(user_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find file after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn trash_file(&self, file_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        diesel::update(
            files::table
                .filter(files::id.eq(file_id))
                .filter(files::user_id.eq(user_id))
                .filter(files::deleted_at.is_null()),
        )
        .set((files::deleted_at.eq(now), files::updated_at.eq(now)))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB trash file error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    pub fn restore_file(&self, file_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        diesel::update(
            files::table
                .filter(files::id.eq(file_id))
                .filter(files::user_id.eq(user_id))
                .filter(files::deleted_at.is_not_null()),
        )
        .set((
            files::deleted_at.eq(None::<NaiveDateTime>),
            files::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB restore file error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    pub fn restore_folder(&self, folder_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        diesel::update(
            folders::table
                .filter(folders::id.eq(folder_id))
                .filter(folders::user_id.eq(user_id))
                .filter(folders::deleted_at.is_not_null()),
        )
        .set((
            folders::deleted_at.eq(None::<NaiveDateTime>),
            folders::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB restore folder error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    pub fn permanently_delete_file(
        &self,
        file_id: &str,
        user_id: &str,
    ) -> Result<Option<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        let record = files::table
            .filter(files::id.eq(file_id))
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_not_null())
            .select(FileRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find trashed file error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        if record.is_some() {
            diesel::delete(
                files::table
                    .filter(files::id.eq(file_id))
                    .filter(files::user_id.eq(user_id)),
            )
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete file error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        }

        Ok(record)
    }

    pub fn permanently_delete_folder(
        &self,
        folder_id: &str,
        user_id: &str,
    ) -> Result<bool, ApiError> {
        let mut conn = self.get_conn()?;

        let exists = folders::table
            .filter(folders::id.eq(folder_id))
            .filter(folders::user_id.eq(user_id))
            .filter(folders::deleted_at.is_not_null())
            .select(folders::id)
            .first::<String>(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find trashed folder error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        if exists.is_some() {
            diesel::delete(
                folders::table
                    .filter(folders::id.eq(folder_id))
                    .filter(folders::user_id.eq(user_id)),
            )
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete folder error: {:?}", e);
                ApiError::internal("Database error")
            })?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // ── Trash listing ─────────────────────────────────────────────────────────

    pub fn list_trashed_files(&self, user_id: &str) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_not_null())
            .select(FileRecord::as_select())
            .order(files::deleted_at.desc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list trashed files error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_trashed_folders(&self, user_id: &str) -> Result<Vec<FolderRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        folders::table
            .filter(folders::user_id.eq(user_id))
            .filter(folders::deleted_at.is_not_null())
            .select(FolderRecord::as_select())
            .order(folders::deleted_at.desc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list trashed folders error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Delete all trash items older than 30 days; returns file records so caller can remove from disk.
    #[allow(unused)]
    pub fn purge_expired_trash(
        &self,
        user_id: &str,
        cutoff: NaiveDateTime,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        // Collect file records before deleting so caller can remove from disk
        let expired_files: Vec<FileRecord> = files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_not_null())
            .filter(files::deleted_at.le(cutoff))
            .select(FileRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query expired trashed files error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        diesel::delete(
            files::table
                .filter(files::user_id.eq(user_id))
                .filter(files::deleted_at.is_not_null())
                .filter(files::deleted_at.le(cutoff)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB purge trashed files error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        diesel::delete(
            folders::table
                .filter(folders::user_id.eq(user_id))
                .filter(folders::deleted_at.is_not_null())
                .filter(folders::deleted_at.le(cutoff)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB purge trashed folders error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(expired_files)
    }

    pub fn empty_trash(&self, user_id: &str) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        let trashed_files: Vec<FileRecord> = files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_not_null())
            .select(FileRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query all trashed files error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        diesel::delete(
            files::table
                .filter(files::user_id.eq(user_id))
                .filter(files::deleted_at.is_not_null()),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB empty trash files error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        diesel::delete(
            folders::table
                .filter(folders::user_id.eq(user_id))
                .filter(folders::deleted_at.is_not_null()),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB empty trash folders error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(trashed_files)
    }

    // ── Bulk operations ───────────────────────────────────────────────────────

    pub fn bulk_trash_files(&self, file_ids: &[String], user_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        let count = diesel::update(
            files::table
                .filter(files::id.eq_any(file_ids))
                .filter(files::user_id.eq(user_id))
                .filter(files::deleted_at.is_null()),
        )
        .set((files::deleted_at.eq(now), files::updated_at.eq(now)))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB bulk trash files error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(count)
    }

    pub fn bulk_trash_folders(
        &self,
        folder_ids: &[String],
        user_id: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        let count = diesel::update(
            folders::table
                .filter(folders::id.eq_any(folder_ids))
                .filter(folders::user_id.eq(user_id))
                .filter(folders::deleted_at.is_null()),
        )
        .set(TrashFolderRecord {
            deleted_at: Some(now),
            updated_at: now,
        })
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB bulk trash folders error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(count)
    }

    pub fn bulk_move_files(
        &self,
        file_ids: &[String],
        user_id: &str,
        target_folder_id: Option<&str>,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        let count = match target_folder_id {
            Some(fid) => diesel::update(
                files::table
                    .filter(files::id.eq_any(file_ids))
                    .filter(files::user_id.eq(user_id))
                    .filter(files::deleted_at.is_null()),
            )
            .set((files::folder_id.eq(Some(fid)), files::updated_at.eq(now)))
            .execute(&mut conn),
            None => diesel::update(
                files::table
                    .filter(files::id.eq_any(file_ids))
                    .filter(files::user_id.eq(user_id))
                    .filter(files::deleted_at.is_null()),
            )
            .set((
                files::folder_id.eq(None::<String>),
                files::updated_at.eq(now),
            ))
            .execute(&mut conn),
        }
        .map_err(|e| {
            tracing::error!("DB bulk move files error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(count)
    }

    pub fn bulk_move_folders(
        &self,
        folder_ids: &[String],
        user_id: &str,
        target_folder_id: Option<&str>,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        let count = match target_folder_id {
            Some(fid) => diesel::update(
                folders::table
                    .filter(folders::id.eq_any(folder_ids))
                    .filter(folders::user_id.eq(user_id))
                    .filter(folders::deleted_at.is_null()),
            )
            .set((
                folders::parent_id.eq(Some(fid)),
                folders::updated_at.eq(now),
            ))
            .execute(&mut conn),
            None => diesel::update(
                folders::table
                    .filter(folders::id.eq_any(folder_ids))
                    .filter(folders::user_id.eq(user_id))
                    .filter(folders::deleted_at.is_null()),
            )
            .set((
                folders::parent_id.eq(None::<String>),
                folders::updated_at.eq(now),
            ))
            .execute(&mut conn),
        }
        .map_err(|e| {
            tracing::error!("DB bulk move folders error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(count)
    }

    pub fn find_files_by_ids(
        &self,
        file_ids: &[String],
        user_id: &str,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        files::table
            .filter(files::id.eq_any(file_ids))
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find files by ids error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    // ── Shortcut operations ───────────────────────────────────────────────────

    pub fn create_shortcut(&self, record: NewShortcutRecord) -> Result<ShortcutRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::insert_into(shortcuts::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB create shortcut error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        shortcuts::table
            .filter(shortcuts::id.eq(record.id))
            .select(ShortcutRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query shortcut after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_shortcut(&self, shortcut_id: &str, user_id: &str) -> Result<bool, ApiError> {
        let mut conn = self.get_conn()?;

        let count = diesel::delete(
            shortcuts::table
                .filter(shortcuts::id.eq(shortcut_id))
                .filter(shortcuts::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete shortcut error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(count > 0)
    }

    pub fn list_shortcuts_in_folder(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
    ) -> Result<Vec<ShortcutRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        let result = match folder_id {
            Some(fid) => shortcuts::table
                .filter(shortcuts::user_id.eq(user_id))
                .filter(shortcuts::folder_id.eq(fid))
                .select(ShortcutRecord::as_select())
                .load(&mut conn),
            None => shortcuts::table
                .filter(shortcuts::user_id.eq(user_id))
                .filter(shortcuts::folder_id.is_null())
                .select(ShortcutRecord::as_select())
                .load(&mut conn),
        };

        result.map_err(|e| {
            tracing::error!("DB list shortcuts error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Fetch files by IDs regardless of owner (for shared-with-me view).
    pub fn find_files_by_ids_shared(
        &self,
        file_ids: &[String],
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::id.eq_any(file_ids))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find shared files error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Fetch folders by IDs regardless of owner (for shared-with-me view).
    pub fn find_folders_by_ids_shared(
        &self,
        folder_ids: &[String],
    ) -> Result<Vec<FolderRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        folders::table
            .filter(folders::id.eq_any(folder_ids))
            .filter(folders::deleted_at.is_null())
            .select(FolderRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find shared folders error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    // ── Recent ────────────────────────────────────────────────────────────────

    pub fn list_recent_files(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .order(files::updated_at.desc())
            .limit(limit)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list recent files error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List every non-deleted file for the user whose MIME type matches any of
    /// the given `LIKE` patterns, across the whole drive.
    pub fn list_files_by_mime(
        &self,
        user_id: &str,
        patterns: &[&'static str],
    ) -> Result<Vec<FileRecord>, ApiError> {
        use diesel::sql_types::Bool;
        use diesel::sqlite::Sqlite;

        let mut conn = self.get_conn()?;

        // Build `(mime LIKE p1 OR mime LIKE p2 OR ...)` so it ANDs correctly
        // with the user/deleted filters rather than binding loosely.
        let mut mime_match: Box<dyn BoxableExpression<files::table, Sqlite, SqlType = Bool>> =
            match patterns.first() {
                Some(first) => Box::new(files::mime_type.like(*first)),
                // No patterns => match nothing.
                None => Box::new(diesel::dsl::sql::<Bool>("0")),
            };
        for pattern in patterns.iter().skip(1) {
            mime_match = Box::new(mime_match.or(files::mime_type.like(*pattern)));
        }

        files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .filter(mime_match)
            .select(FileRecord::as_select())
            .order(files::name.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list files by mime error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    // ── Starred (Quick Access) ─────────────────────────────────────────────────

    pub fn list_starred_files(&self, user_id: &str) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::is_starred.eq(true))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .order(files::starred_at.desc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list starred files error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_starred_folders(&self, user_id: &str) -> Result<Vec<FolderRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        folders::table
            .filter(folders::user_id.eq(user_id))
            .filter(folders::is_starred.eq(true))
            .filter(folders::deleted_at.is_null())
            .select(FolderRecord::as_select())
            .order(folders::starred_at.desc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list starred folders error: {:?}", e);
                ApiError::internal("Database error")
            })
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

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive::filesystem::dto::DriveFileType;
    use crate::drive::storage::model::NewFileRecord;
    use diesel_migrations::MigrationHarness;

    /// A repository backed by a fresh in-memory SQLite database. The pool is
    /// capped at one connection so the `:memory:` database (which is per
    /// connection) persists across calls.
    fn test_repo() -> FilesystemRepository {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("failed to build test pool");
        pool.get()
            .expect("failed to get migration connection")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("failed to run migrations");
        FilesystemRepository::new(pool)
    }

    fn insert_file(repo: &FilesystemRepository, id: &str, user_id: &str, name: &str, mime: &str) {
        let mut conn = repo.get_conn().unwrap();
        diesel::insert_into(files::table)
            .values(NewFileRecord {
                id,
                user_id,
                name,
                size_bytes: 1,
                mime_type: mime,
                storage_path: id,
                folder_id: None,
                encrypted_metadata: None,
            })
            .execute(&mut conn)
            .expect("failed to insert test file");
    }

    fn names(files: &[FileRecord]) -> Vec<&str> {
        files.iter().map(|f| f.name.as_str()).collect()
    }

    fn seed(repo: &FilesystemRepository, user: &str) {
        insert_file(repo, "png", user, "a-photo.png", "image/png");
        insert_file(repo, "jpg", user, "b-photo.jpg", "image/jpeg");
        insert_file(repo, "mp4", user, "clip.mp4", "video/mp4");
        insert_file(repo, "mp3", user, "song.mp3", "audio/mpeg");
        insert_file(repo, "pdf", user, "report.pdf", "application/pdf");
        insert_file(repo, "txt", user, "notes.txt", "text/plain");
        insert_file(repo, "bin", user, "blob.bin", "application/octet-stream");
    }

    #[test]
    fn photo_matches_only_images_sorted_by_name() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let files = repo
            .list_files_by_mime("user-1", DriveFileType::Photo.mime_patterns())
            .unwrap();

        // Both images, and ordered by name (a-photo before b-photo).
        assert_eq!(names(&files), vec!["a-photo.png", "b-photo.jpg"]);
    }

    #[test]
    fn video_and_audio_match_their_families() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let videos = repo
            .list_files_by_mime("user-1", DriveFileType::Video.mime_patterns())
            .unwrap();
        assert_eq!(names(&videos), vec!["clip.mp4"]);

        let audio = repo
            .list_files_by_mime("user-1", DriveFileType::Audio.mime_patterns())
            .unwrap();
        assert_eq!(names(&audio), vec!["song.mp3"]);
    }

    #[test]
    fn document_matches_multiple_patterns_but_not_binary() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let docs = repo
            .list_files_by_mime("user-1", DriveFileType::Document.mime_patterns())
            .unwrap();

        // pdf + text/plain, but not the generic octet-stream blob.
        assert_eq!(names(&docs), vec!["notes.txt", "report.pdf"]);
    }

    #[test]
    fn excludes_trashed_files() {
        let repo = test_repo();
        seed(&repo, "user-1");
        repo.trash_file("png", "user-1").unwrap();

        let files = repo
            .list_files_by_mime("user-1", DriveFileType::Photo.mime_patterns())
            .unwrap();
        assert_eq!(names(&files), vec!["b-photo.jpg"]);
    }

    #[test]
    fn scopes_to_the_requesting_user() {
        let repo = test_repo();
        seed(&repo, "user-1");
        insert_file(&repo, "other", "user-2", "their-photo.png", "image/png");

        let files = repo
            .list_files_by_mime("user-1", DriveFileType::Photo.mime_patterns())
            .unwrap();
        assert_eq!(names(&files), vec!["a-photo.png", "b-photo.jpg"]);
    }
}
