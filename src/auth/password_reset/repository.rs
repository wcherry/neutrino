//! Storage for `password_resets`. Every method takes its own connection and
//! gives it back before returning, so callers can chain them on a
//! one-connection pool.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, PooledConnection};

use super::model::{NewPasswordReset, PasswordResetRecord};
use crate::schema::password_resets;
use crate::shared::{ApiError, DbPool};

/// Reads and writes the `password_resets` table.
pub struct PasswordResetRepository {
    pool: DbPool,
}

fn db_err(context: &'static str) -> impl FnOnce(diesel::result::Error) -> ApiError {
    move |e| {
        tracing::error!("DB {} error: {:?}", context, e);
        ApiError::internal("Database error")
    }
}

impl PasswordResetRepository {
    pub fn new(pool: DbPool) -> Self {
        PasswordResetRepository { pool }
    }

    fn conn(&self) -> Result<PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn find_by_token_hash(
        &self,
        token_hash: &str,
    ) -> Result<Option<PasswordResetRecord>, ApiError> {
        password_resets::table
            .filter(password_resets::token_hash.eq(token_hash))
            .select(PasswordResetRecord::as_select())
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("password reset lookup"))
    }

    /// How many links the user was sent at or after `since`, whatever became
    /// of them.
    pub fn count_since(&self, user_id: &str, since: NaiveDateTime) -> Result<i64, ApiError> {
        password_resets::table
            .filter(password_resets::user_id.eq(user_id))
            .filter(password_resets::created_at.ge(since))
            .count()
            .get_result(&mut self.conn()?)
            .map_err(db_err("password reset count"))
    }

    /// Revoke every unused, unrevoked link the user holds, then insert `row` —
    /// one transaction, so there is never a moment with two live links.
    pub fn replace_with(&self, row: &NewPasswordReset, now: NaiveDateTime) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        conn.transaction(|conn| {
            revoke_live(conn, &row.user_id, now)?;
            diesel::insert_into(password_resets::table)
                .values(row)
                .execute(conn)?;
            Ok(())
        })
        .map_err(db_err("password reset insert"))
    }

    /// Spend the link if it is still unused, unrevoked and unexpired. Returns
    /// whether this call spent it, so two submissions racing on one link
    /// cannot both set a password.
    pub fn claim(&self, id: &str, now: NaiveDateTime) -> Result<bool, ApiError> {
        let n = diesel::update(
            password_resets::table
                .filter(password_resets::id.eq(id))
                .filter(password_resets::used_at.is_null())
                .filter(password_resets::revoked_at.is_null())
                .filter(password_resets::expires_at.gt(now)),
        )
        .set(password_resets::used_at.eq(now))
        .execute(&mut self.conn()?)
        .map_err(db_err("password reset claim"))?;
        Ok(n == 1)
    }

    /// Give a claimed link back, when the password write after the claim
    /// failed and the user must be able to try again.
    pub fn release(&self, id: &str) -> Result<(), ApiError> {
        diesel::update(password_resets::table.filter(password_resets::id.eq(id)))
            .set(password_resets::used_at.eq(None::<NaiveDateTime>))
            .execute(&mut self.conn()?)
            .map(|_| ())
            .map_err(db_err("password reset release"))
    }

    /// Revoke every link the user still holds.
    pub fn revoke_all(&self, user_id: &str, now: NaiveDateTime) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        revoke_live(&mut conn, user_id, now)
            .map(|_| ())
            .map_err(db_err("password reset revoke"))
    }
}

fn revoke_live(
    conn: &mut SqliteConnection,
    user_id: &str,
    now: NaiveDateTime,
) -> Result<usize, diesel::result::Error> {
    diesel::update(
        password_resets::table
            .filter(password_resets::user_id.eq(user_id))
            .filter(password_resets::used_at.is_null())
            .filter(password_resets::revoked_at.is_null()),
    )
    .set(password_resets::revoked_at.eq(now))
    .execute(conn)
}
