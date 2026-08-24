#![allow(dead_code)]

use crate::drive::encryption::model::{FileKeyRef, NewFileKeyRef};
use crate::schema::{file_key_refs, files};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct EncryptionRepository {
    pool: DbPool,
}

impl EncryptionRepository {
    pub fn new(pool: DbPool) -> Self {
        EncryptionRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })
    }

    /// Upsert: insert or replace the encrypted file key for a (file, user) pair.
    pub fn upsert_file_key(&self, new_ref: NewFileKeyRef) -> Result<FileKeyRef, ApiError> {
        let mut conn = self.get_conn()?;

        // SQLite REPLACE INTO / INSERT OR REPLACE.
        //
        // `key_version` is updated alongside the ciphertext, never separately:
        // the two describe each other, and a row carrying a new sealed DEK with
        // the old version number points the client at a secret key that cannot
        // open it.
        diesel::insert_into(file_key_refs::table)
            .values(&new_ref)
            .on_conflict((file_key_refs::file_id, file_key_refs::user_id))
            .do_update()
            .set((
                file_key_refs::encrypted_file_key.eq(new_ref.encrypted_file_key),
                file_key_refs::key_version.eq(new_ref.key_version),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB upsert file_key_ref error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        file_key_refs::table
            .filter(file_key_refs::file_id.eq(new_ref.file_id))
            .filter(file_key_refs::user_id.eq(new_ref.user_id))
            .select(FileKeyRef::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after upsert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Fetch the encrypted file key for a specific (file, user) pair.
    pub fn get_file_key(
        &self,
        file_id: &str,
        user_id: &str,
    ) -> Result<Option<FileKeyRef>, ApiError> {
        let mut conn = self.get_conn()?;

        file_key_refs::table
            .filter(file_key_refs::file_id.eq(file_id))
            .filter(file_key_refs::user_id.eq(user_id))
            .select(FileKeyRef::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query file_key_ref error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }

    /// List all key refs for a file (used when revoking access or re-encrypting).
    pub fn list_file_keys(&self, file_id: &str) -> Result<Vec<FileKeyRef>, ApiError> {
        let mut conn = self.get_conn()?;

        file_key_refs::table
            .filter(file_key_refs::file_id.eq(file_id))
            .select(FileKeyRef::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list file_key_refs error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }

    /// How many of `user_id`'s still-existing files are sealed to each key
    /// version, as `(key_version, count)`.
    ///
    /// The join to `files` is what makes the number mean something: a
    /// permanently deleted file leaves its key ref behind, and an orphan ref
    /// counted here would report an old key as still load bearing when no
    /// file exists to re-seal.
    pub fn count_files_by_key_version(&self, user_id: &str) -> Result<Vec<(i32, i64)>, ApiError> {
        let mut conn = self.get_conn()?;

        file_key_refs::table
            .inner_join(files::table.on(files::id.eq(file_key_refs::file_id)))
            .filter(file_key_refs::user_id.eq(user_id))
            .group_by(file_key_refs::key_version)
            .select((file_key_refs::key_version, diesel::dsl::count_star()))
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count file_key_refs by key_version error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }

    /// Every one of `user_id`'s key refs as `(key_version, file_id)`, oldest
    /// ref first within a version. Same `files` join, same reason, as
    /// `count_files_by_key_version`.
    pub fn list_file_ids_by_key_version(
        &self,
        user_id: &str,
    ) -> Result<Vec<(i32, String)>, ApiError> {
        let mut conn = self.get_conn()?;

        file_key_refs::table
            .inner_join(files::table.on(files::id.eq(file_key_refs::file_id)))
            .filter(file_key_refs::user_id.eq(user_id))
            .select((file_key_refs::key_version, file_key_refs::file_id))
            .order((
                file_key_refs::key_version.asc(),
                file_key_refs::created_at.asc(),
                file_key_refs::file_id.asc(),
            ))
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list file_key_refs by key_version error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }

    /// Delete the key ref for a specific user (used on permission revocation).
    pub fn delete_file_key(&self, file_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        diesel::delete(
            file_key_refs::table
                .filter(file_key_refs::file_id.eq(file_id))
                .filter(file_key_refs::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete file_key_ref error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }
}
