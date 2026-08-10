#![allow(dead_code)]

use crate::auth::keyvault::model::{
    NewUserKeyUnlock, NewUserKeyVault, UserKeyUnlock, UserKeyVault,
};
use crate::schema::{user_key_unlocks, user_key_vaults};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct KeyVaultRepository {
    pool: DbPool,
}

impl KeyVaultRepository {
    pub fn new(pool: DbPool) -> Self {
        KeyVaultRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })
    }

    // ── Vault ────────────────────────────────────────────────────────────────

    pub fn get_vault(&self, user_id: &str) -> Result<Option<UserKeyVault>, ApiError> {
        let mut conn = self.get_conn()?;
        user_key_vaults::table
            .filter(user_key_vaults::user_id.eq(user_id))
            .select(UserKeyVault::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query user_key_vault error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }

    /// Insert or replace the wrapped identity for a user.
    pub fn upsert_vault(&self, new_vault: NewUserKeyVault) -> Result<UserKeyVault, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::insert_into(user_key_vaults::table)
            .values(&new_vault)
            .on_conflict(user_key_vaults::user_id)
            .do_update()
            .set((
                user_key_vaults::encrypted_identity.eq(new_vault.encrypted_identity),
                user_key_vaults::public_key.eq(new_vault.public_key),
                user_key_vaults::version.eq(new_vault.version),
                user_key_vaults::updated_at.eq(diesel::dsl::now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB upsert user_key_vault error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        user_key_vaults::table
            .filter(user_key_vaults::user_id.eq(new_vault.user_id))
            .select(UserKeyVault::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after vault upsert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_vault(&self, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(user_key_vaults::table.filter(user_key_vaults::user_id.eq(user_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete user_key_vault error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    // ── Unlock methods ───────────────────────────────────────────────────────

    pub fn list_unlocks(&self, user_id: &str) -> Result<Vec<UserKeyUnlock>, ApiError> {
        let mut conn = self.get_conn()?;
        user_key_unlocks::table
            .filter(user_key_unlocks::user_id.eq(user_id))
            .order(user_key_unlocks::created_at.asc())
            .select(UserKeyUnlock::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list user_key_unlocks error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }

    pub fn get_unlock(
        &self,
        id: &str,
        user_id: &str,
    ) -> Result<Option<UserKeyUnlock>, ApiError> {
        let mut conn = self.get_conn()?;
        user_key_unlocks::table
            .filter(user_key_unlocks::id.eq(id))
            .filter(user_key_unlocks::user_id.eq(user_id))
            .select(UserKeyUnlock::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query user_key_unlock error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }

    pub fn insert_unlock(&self, new_unlock: NewUserKeyUnlock) -> Result<UserKeyUnlock, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(user_key_unlocks::table)
            .values(&new_unlock)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert user_key_unlock error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        user_key_unlocks::table
            .filter(user_key_unlocks::id.eq(new_unlock.id))
            .select(UserKeyUnlock::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after unlock insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Delete every unlock row of `method` for a user. Used to make `password`
    /// and `recovery` singletons: the old row goes before the new one lands.
    pub fn delete_unlocks_by_method(
        &self,
        user_id: &str,
        method: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            user_key_unlocks::table
                .filter(user_key_unlocks::user_id.eq(user_id))
                .filter(user_key_unlocks::method.eq(method)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete user_key_unlocks by method error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn delete_unlock(&self, id: &str, user_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            user_key_unlocks::table
                .filter(user_key_unlocks::id.eq(id))
                .filter(user_key_unlocks::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete user_key_unlock error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn delete_all_unlocks(&self, user_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(user_key_unlocks::table.filter(user_key_unlocks::user_id.eq(user_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete all user_key_unlocks error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn touch_unlock(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(
            user_key_unlocks::table
                .filter(user_key_unlocks::id.eq(id))
                .filter(user_key_unlocks::user_id.eq(user_id)),
        )
        .set(user_key_unlocks::last_used_at.eq(diesel::dsl::now))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB touch user_key_unlock error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }
}
