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
        .set(TrashFolderRecord {
            deleted_at: None,
            updated_at: now,
        })
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
