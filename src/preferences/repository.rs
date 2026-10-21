// ── preferences::repository ───────────────────────────────────────────────────
//
// Follows `themes::repository`'s connection and error-mapping style.

use crate::preferences::model::{NewPreferenceRecord, PreferenceRecord, VaultRecord};
use crate::schema::{user_preference_vault, user_preferences};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// What a vault write found. `Conflict` carries the version that is actually stored.
#[derive(Debug, PartialEq)]
pub enum VaultWrite {
    Written(String),
    Conflict(Option<String>),
}

pub struct PreferencesRepository {
    pool: DbPool,
}

fn db_error(context: &str) -> impl Fn(diesel::result::Error) -> ApiError + '_ {
    move |e| {
        tracing::error!("DB {context} error: {:?}", e);
        ApiError::internal("Database error")
    }
}

impl PreferencesRepository {
    pub fn new(pool: DbPool) -> Self {
        PreferencesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn list(&self, user_id: &str) -> Result<Vec<PreferenceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        user_preferences::table
            .filter(user_preferences::user_id.eq(user_id))
            .order(user_preferences::key.asc())
            .select(PreferenceRecord::as_select())
            .load(&mut conn)
            .map_err(db_error("list preferences"))
    }

    /// Apply one PATCH in one transaction: `Some` upserts the JSON text, `None` deletes the row.
    pub fn apply(
        &self,
        user_id: &str,
        changes: &[(String, Option<String>)],
        now: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            for (key, value) in changes {
                match value {
                    Some(value) => {
                        diesel::insert_into(user_preferences::table)
                            .values(NewPreferenceRecord { user_id, key, value, updated_at: now })
                            .on_conflict((user_preferences::user_id, user_preferences::key))
                            .do_update()
                            .set((user_preferences::value.eq(value), user_preferences::updated_at.eq(now)))
                            .execute(conn)?;
                    }
                    None => {
                        diesel::delete(
                            user_preferences::table
                                .filter(user_preferences::user_id.eq(user_id))
                                .filter(user_preferences::key.eq(key)),
                        )
                        .execute(conn)?;
                    }
                }
            }
            Ok(())
        })
        .map_err(db_error("apply preferences"))
    }

    pub fn get_vault(&self, user_id: &str) -> Result<Option<VaultRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        user_preference_vault::table
            .filter(user_preference_vault::user_id.eq(user_id))
            .select(VaultRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_error("get vault"))
    }

    /// Replace the vault if, and only if, the stored version is the one the client last saw.
    pub fn put_vault(
        &self,
        user_id: &str,
        blob: &str,
        base: Option<&str>,
        now: &str,
    ) -> Result<VaultWrite, ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            let current: Option<String> = user_preference_vault::table
                .filter(user_preference_vault::user_id.eq(user_id))
                .select(user_preference_vault::updated_at)
                .first(conn)
                .optional()?;
            if current.as_deref() != base {
                return Ok(VaultWrite::Conflict(current));
            }
            match current {
                Some(_) => {
                    diesel::update(user_preference_vault::table.filter(user_preference_vault::user_id.eq(user_id)))
                        .set((user_preference_vault::blob.eq(blob), user_preference_vault::updated_at.eq(now)))
                        .execute(conn)?;
                }
                None => {
                    diesel::insert_into(user_preference_vault::table)
                        .values((
                            user_preference_vault::user_id.eq(user_id),
                            user_preference_vault::blob.eq(blob),
                            user_preference_vault::updated_at.eq(now),
                        ))
                        .execute(conn)?;
                }
            }
            Ok(VaultWrite::Written(now.to_string()))
        })
        .map_err(db_error("put vault"))
    }
}
