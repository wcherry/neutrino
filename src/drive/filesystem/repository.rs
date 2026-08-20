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

    /// Moves a folder to the trash, together with every descendant folder and every file
    /// inside any of them, all stamped with the SAME `deleted_at`.
    ///
    /// The cascade is the point: `deleted_at` is what every listing query filters on, so a
    /// folder-only update left the contained files marked live. They then kept being served by
    /// `list_files_in_folder` and re-downloaded by the desktop client on each poll, even though
    /// the user had put the folder in the trash. Sharing one timestamp across the whole cascade
    /// is what lets `restore_folder` put back exactly what this operation took.
    pub fn trash_folder(&self, folder_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        conn.transaction(|conn| {
            let ids = Self::folder_subtree_ids(conn, folder_id, user_id)?;

            diesel::update(
                folders::table
                    .filter(folders::id.eq_any(&ids))
                    .filter(folders::user_id.eq(user_id))
                    .filter(folders::deleted_at.is_null()),
            )
            .set(TrashFolderRecord {
                deleted_at: Some(now),
                updated_at: now,
            })
            .execute(conn)?;

            // Files already in the trash keep their original `deleted_at` so restoring this
            // folder does not resurrect something the user trashed separately beforehand.
            diesel::update(
                files::table
                    .filter(files::folder_id.eq_any(&ids))
                    .filter(files::user_id.eq(user_id))
                    .filter(files::deleted_at.is_null()),
            )
            .set((files::deleted_at.eq(now), files::updated_at.eq(now)))
            .execute(conn)?;

            Ok::<_, diesel::result::Error>(())
        })
        .map_err(|e| {
            tracing::error!("DB trash folder error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    /// The folder's own id plus the ids of all its descendants, breadth-first.
    ///
    /// Diesel has no portable recursive-CTE support here, so the tree is walked one level at a
    /// time. Already-trashed descendants are included so a cascade over a partially-trashed
    /// subtree still reaches the live files beneath them.
    fn folder_subtree_ids(
        conn: &mut SqliteConnection,
        folder_id: &str,
        user_id: &str,
    ) -> Result<Vec<String>, diesel::result::Error> {
        let mut ids = vec![folder_id.to_string()];
        let mut frontier = vec![folder_id.to_string()];

        while !frontier.is_empty() {
            let children: Vec<String> = folders::table
                .filter(folders::parent_id.eq_any(&frontier))
                .filter(folders::user_id.eq(user_id))
                .select(folders::id)
                .load(conn)?;

            // Guards against a cycle introduced by a bad move: a folder already seen is never
            // expanded again, so the walk always terminates.
            frontier = children
                .into_iter()
                .filter(|id| !ids.contains(id))
                .collect();
            ids.extend(frontier.iter().cloned());
        }

        Ok(ids)
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

    /// Restores a trashed folder and undoes exactly the cascade `trash_folder` performed.
    ///
    /// Descendants are restored ONLY when their `deleted_at` matches the folder's, i.e. they
    /// went into the trash as part of the same operation. Anything the user trashed separately
    /// (before or after) carries a different timestamp and stays in the trash.
    pub fn restore_folder(&self, folder_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        conn.transaction(|conn| {
            // Read the trash stamp BEFORE clearing it — it identifies the cascade to undo.
            let trashed_at: Option<NaiveDateTime> = folders::table
                .filter(folders::id.eq(folder_id))
                .filter(folders::user_id.eq(user_id))
                .filter(folders::deleted_at.is_not_null())
                .select(folders::deleted_at)
                .first(conn)
                .optional()?
                .flatten();

            let Some(trashed_at) = trashed_at else {
                return Ok(());  // Not in the trash; nothing to restore.
            };

            let ids = Self::folder_subtree_ids(conn, folder_id, user_id)?;

            diesel::update(
                folders::table
                    .filter(folders::id.eq_any(&ids))
                    .filter(folders::user_id.eq(user_id))
                    .filter(folders::deleted_at.eq(trashed_at)),
            )
            .set((
                folders::deleted_at.eq(None::<NaiveDateTime>),
                folders::updated_at.eq(now),
            ))
            .execute(conn)?;

            diesel::update(
                files::table
                    .filter(files::folder_id.eq_any(&ids))
                    .filter(files::user_id.eq(user_id))
                    .filter(files::deleted_at.eq(trashed_at)),
            )
            .set((
                files::deleted_at.eq(None::<NaiveDateTime>),
                files::updated_at.eq(now),
            ))
            .execute(conn)?;

            Ok::<_, diesel::result::Error>(())
        })
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

    /// Bulk equivalent of `trash_folder`, cascading to descendants and contained files for the
    /// same reason (see `trash_folder`). The returned count is folders trashed, as before —
    /// cascaded files are not counted, so the number still means "items the caller selected".
    pub fn bulk_trash_folders(
        &self,
        folder_ids: &[String],
        user_id: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        let count = conn
            .transaction(|conn| {
                let mut ids: Vec<String> = Vec::new();
                for folder_id in folder_ids {
                    for id in Self::folder_subtree_ids(conn, folder_id, user_id)? {
                        if !ids.contains(&id) {
                            ids.push(id);
                        }
                    }
                }

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
                .execute(conn)?;

                // Descendant folders, then every live file anywhere in the selected subtrees.
                diesel::update(
                    folders::table
                        .filter(folders::id.eq_any(&ids))
                        .filter(folders::user_id.eq(user_id))
                        .filter(folders::deleted_at.is_null()),
                )
                .set(TrashFolderRecord {
                    deleted_at: Some(now),
                    updated_at: now,
                })
                .execute(conn)?;

                diesel::update(
                    files::table
                        .filter(files::folder_id.eq_any(&ids))
                        .filter(files::user_id.eq(user_id))
                        .filter(files::deleted_at.is_null()),
                )
                .set((files::deleted_at.eq(now), files::updated_at.eq(now)))
                .execute(conn)?;

                Ok::<_, diesel::result::Error>(count)
            })
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

    /// All of a user's shortcuts, anywhere in the drive.
    pub fn list_shortcuts(&self, user_id: &str) -> Result<Vec<ShortcutRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        shortcuts::table
            .filter(shortcuts::user_id.eq(user_id))
            .select(ShortcutRecord::as_select())
            .order(shortcuts::created_at.desc())
            .load(&mut conn)
            .map_err(|e| {
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

    /// The most recently updated files, newest first, optionally narrowed to a
    /// set of MIME `LIKE` patterns.
    ///
    /// The MIME filter is applied in SQL rather than by the caller because
    /// `limit` is applied here: filtering afterwards would return fewer than
    /// `limit` matching files whenever other file types are more recent.
    pub fn list_recent_files(
        &self,
        user_id: &str,
        limit: i64,
        patterns: Option<&[&'static str]>,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = files::table
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .into_boxed();

        if let Some(patterns) = patterns {
            query = query.filter(Self::mime_matches(patterns));
        }

        query
            .select(FileRecord::as_select())
            .order(files::updated_at.desc())
            .limit(limit)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list recent files error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// `(mime LIKE p1 OR mime LIKE p2 OR ...)` as one boxed expression, so it
    /// ANDs correctly with the surrounding filters rather than binding loosely.
    fn mime_matches(
        patterns: &[&'static str],
    ) -> Box<
        dyn BoxableExpression<
            files::table,
            diesel::sqlite::Sqlite,
            SqlType = diesel::sql_types::Bool,
        >,
    > {
        use diesel::sql_types::Bool;
        use diesel::sqlite::Sqlite;

        let mut mime_match: Box<dyn BoxableExpression<files::table, Sqlite, SqlType = Bool>> =
            match patterns.first() {
                Some(first) => Box::new(files::mime_type.like(*first)),
                // No patterns => match nothing.
                None => Box::new(diesel::dsl::sql::<Bool>("0")),
            };
        for pattern in patterns.iter().skip(1) {
            mime_match = Box::new(mime_match.or(files::mime_type.like(*pattern)));
        }
        mime_match
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

    /// `names`, order-independent. Used against `list_recent_files`, whose
    /// `updated_at desc` order is unspecified between rows inserted in the
    /// same instant — unlike the old name-sorted whole-drive type listing.
    fn sorted_names(files: &[FileRecord]) -> Vec<&str> {
        let mut n = names(files);
        n.sort_unstable();
        n
    }

    fn seed(repo: &FilesystemRepository, user: &str) {
        insert_file(repo, "png", user, "a-photo.png", "image/png");
        insert_file(repo, "jpg", user, "b-photo.jpg", "image/jpeg");
        insert_file(repo, "mp4", user, "clip.mp4", "video/mp4");
        insert_file(repo, "mp3", user, "song.mp3", "audio/mpeg");
        insert_file(repo, "pdf", user, "report.pdf", "application/pdf");
        insert_file(repo, "txt", user, "notes.txt", "text/plain");
        insert_file(repo, "bin", user, "blob.bin", "application/octet-stream");
        insert_file(repo, "doc", user, "my-doc", "application/x-neutrino-doc");
        insert_file(
            repo,
            "sheet",
            user,
            "my-sheet",
            "application/x-neutrino-sheet",
        );
    }

    /// `list_recent_files` is the only caller left of the SQL mime filter
    /// (`mime_matches`), so these drive it directly with a limit high enough
    /// that recency ordering never drops a match — mirroring what
    /// `list_files_by_mime` used to cover before folder-scoped listings
    /// replaced the whole-drive type filter.
    #[test]
    fn photo_matches_only_images() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let files = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Photo.mime_patterns()))
            .unwrap();

        assert_eq!(sorted_names(&files), vec!["a-photo.png", "b-photo.jpg"]);
    }

    #[test]
    fn video_and_audio_match_their_families() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let videos = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Video.mime_patterns()))
            .unwrap();
        assert_eq!(names(&videos), vec!["clip.mp4"]);

        let audio = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Audio.mime_patterns()))
            .unwrap();
        assert_eq!(names(&audio), vec!["song.mp3"]);
    }

    #[test]
    fn document_matches_multiple_patterns_but_not_binary() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let docs = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Document.mime_patterns()))
            .unwrap();

        // pdf + text/plain, but not the generic octet-stream blob.
        assert_eq!(sorted_names(&docs), vec!["notes.txt", "report.pdf"]);
    }

    #[test]
    fn excludes_trashed_files() {
        let repo = test_repo();
        seed(&repo, "user-1");
        repo.trash_file("png", "user-1").unwrap();

        let files = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Photo.mime_patterns()))
            .unwrap();
        assert_eq!(names(&files), vec!["b-photo.jpg"]);
    }

    #[test]
    fn doc_and_sheet_are_distinct_native_types() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let docs = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Doc.mime_patterns()))
            .unwrap();
        assert_eq!(names(&docs), vec!["my-doc"]);

        let sheets = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Sheet.mime_patterns()))
            .unwrap();
        assert_eq!(names(&sheets), vec!["my-sheet"]);
    }

    #[test]
    fn scopes_to_the_requesting_user() {
        let repo = test_repo();
        seed(&repo, "user-1");
        insert_file(&repo, "other", "user-2", "their-photo.png", "image/png");

        let files = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Photo.mime_patterns()))
            .unwrap();
        assert_eq!(sorted_names(&files), vec!["a-photo.png", "b-photo.jpg"]);
    }

    // ── Recent, with and without a type filter ────────────────────────────────

    #[test]
    fn recent_without_a_type_filter_returns_every_type() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let files = repo.list_recent_files("user-1", 100, None).unwrap();
        assert_eq!(files.len(), 9);
    }

    #[test]
    fn recent_with_a_type_filter_returns_only_that_type() {
        let repo = test_repo();
        seed(&repo, "user-1");

        let files = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Doc.mime_patterns()))
            .unwrap();
        assert_eq!(names(&files), vec!["my-doc"]);
    }

    /// The filter has to run in SQL, before `LIMIT`. If it ran afterwards, a
    /// limit smaller than the number of newer non-matching files would return
    /// nothing at all.
    #[test]
    fn recent_limit_counts_matching_files_only() {
        let repo = test_repo();
        // Eight non-docs, then the doc — so the doc is the *oldest* by rowid but
        // still the only file a `type=doc` listing should ever return.
        seed(&repo, "user-1");

        let files = repo
            .list_recent_files("user-1", 1, Some(DriveFileType::Doc.mime_patterns()))
            .unwrap();
        assert_eq!(names(&files), vec!["my-doc"]);
    }

    #[test]
    fn recent_excludes_trashed_files_even_with_a_type_filter() {
        let repo = test_repo();
        seed(&repo, "user-1");
        repo.trash_file("doc", "user-1").unwrap();

        let files = repo
            .list_recent_files("user-1", 100, Some(DriveFileType::Doc.mime_patterns()))
            .unwrap();
        assert!(files.is_empty());
    }

    // ── Folder trash cascade ──────────────────────────────────────────────────

    fn insert_folder(repo: &FilesystemRepository, id: &str, user: &str, parent: Option<&str>) {
        repo.create_folder(NewFolderRecord {
            id,
            user_id: user,
            parent_id: parent,
            name: id,
        })
        .expect("failed to insert test folder");
    }

    fn insert_file_in(
        repo: &FilesystemRepository,
        id: &str,
        user: &str,
        folder_id: Option<&str>,
    ) {
        let mut conn = repo.get_conn().unwrap();
        diesel::insert_into(files::table)
            .values(NewFileRecord {
                id,
                user_id: user,
                name: id,
                size_bytes: 1,
                mime_type: "text/plain",
                storage_path: id,
                folder_id,
                encrypted_metadata: None,
            })
            .execute(&mut conn)
            .expect("failed to insert test file");
    }

    fn is_trashed(repo: &FilesystemRepository, file_id: &str) -> bool {
        let mut conn = repo.get_conn().unwrap();
        files::table
            .filter(files::id.eq(file_id))
            .select(files::deleted_at)
            .first::<Option<NaiveDateTime>>(&mut conn)
            .unwrap()
            .is_some()
    }

    /// The regression this cascade exists for: a folder-only trash left the contained files
    /// marked live, so they kept being listed (and re-downloaded by the desktop client).
    #[test]
    fn trashing_a_folder_trashes_the_files_inside_it() {
        let repo = test_repo();
        insert_folder(&repo, "docs", "user-1", None);
        insert_file_in(&repo, "inside", "user-1", Some("docs"));
        insert_file_in(&repo, "elsewhere", "user-1", None);

        repo.trash_folder("docs", "user-1").unwrap();

        assert!(is_trashed(&repo, "inside"));
        assert!(!is_trashed(&repo, "elsewhere"));
        assert!(repo
            .list_files_in_folder("user-1", Some("docs"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn trashing_a_folder_cascades_through_nested_subfolders() {
        let repo = test_repo();
        insert_folder(&repo, "top", "user-1", None);
        insert_folder(&repo, "mid", "user-1", Some("top"));
        insert_folder(&repo, "deep", "user-1", Some("mid"));
        insert_file_in(&repo, "deep-file", "user-1", Some("deep"));

        repo.trash_folder("top", "user-1").unwrap();

        assert!(is_trashed(&repo, "deep-file"));
        assert!(repo.list_subfolders("user-1", Some("top")).unwrap().is_empty());
    }

    #[test]
    fn cascade_does_not_touch_another_users_files() {
        let repo = test_repo();
        insert_folder(&repo, "shared-name", "user-1", None);
        insert_folder(&repo, "other", "user-2", None);
        insert_file_in(&repo, "theirs", "user-2", Some("other"));

        repo.trash_folder("shared-name", "user-1").unwrap();

        assert!(!is_trashed(&repo, "theirs"));
    }

    #[test]
    fn restoring_a_folder_restores_the_files_it_took_to_the_trash() {
        let repo = test_repo();
        insert_folder(&repo, "docs", "user-1", None);
        insert_folder(&repo, "nested", "user-1", Some("docs"));
        insert_file_in(&repo, "inside", "user-1", Some("docs"));
        insert_file_in(&repo, "nested-file", "user-1", Some("nested"));

        repo.trash_folder("docs", "user-1").unwrap();
        repo.restore_folder("docs", "user-1").unwrap();

        assert!(!is_trashed(&repo, "inside"));
        assert!(!is_trashed(&repo, "nested-file"));
        assert_eq!(
            names(&repo.list_files_in_folder("user-1", Some("docs")).unwrap()),
            vec!["inside"]
        );
    }

    /// A file the user trashed on its own carries a different `deleted_at`, so restoring the
    /// folder around it must leave it in the trash.
    #[test]
    fn restoring_a_folder_leaves_separately_trashed_files_in_the_trash() {
        let repo = test_repo();
        insert_folder(&repo, "docs", "user-1", None);
        insert_file_in(&repo, "kept", "user-1", Some("docs"));
        insert_file_in(&repo, "already-gone", "user-1", Some("docs"));

        repo.trash_file("already-gone", "user-1").unwrap();
        repo.trash_folder("docs", "user-1").unwrap();
        repo.restore_folder("docs", "user-1").unwrap();

        assert!(!is_trashed(&repo, "kept"));
        assert!(is_trashed(&repo, "already-gone"));
    }

    #[test]
    fn bulk_trash_folders_cascades_and_counts_only_selected_folders() {
        let repo = test_repo();
        insert_folder(&repo, "one", "user-1", None);
        insert_folder(&repo, "two", "user-1", None);
        insert_folder(&repo, "one-child", "user-1", Some("one"));
        insert_file_in(&repo, "one-file", "user-1", Some("one"));
        insert_file_in(&repo, "child-file", "user-1", Some("one-child"));
        insert_file_in(&repo, "two-file", "user-1", Some("two"));

        let count = repo
            .bulk_trash_folders(&["one".to_string(), "two".to_string()], "user-1")
            .unwrap();

        assert_eq!(count, 2, "count reports selected folders, not cascaded files");
        assert!(is_trashed(&repo, "one-file"));
        assert!(is_trashed(&repo, "child-file"));
        assert!(is_trashed(&repo, "two-file"));
    }
}
