//! Storage for `email_verifications` and `users.email_verified_at`. Every
//! method takes its own connection and gives it back before returning, so
//! callers can chain them on a one-connection pool.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, PooledConnection};

use super::model::{EmailVerificationRecord, NewEmailVerification};
use crate::schema::{email_verifications, users};
use crate::shared::{ApiError, DbPool};

/// Reads and writes the `email_verifications` table.
pub struct EmailVerificationRepository {
    pool: DbPool,
}

fn db_err(context: &'static str) -> impl FnOnce(diesel::result::Error) -> ApiError {
    move |e| {
        tracing::error!("DB {} error: {:?}", context, e);
        ApiError::internal("Database error")
    }
}

impl EmailVerificationRepository {
    pub fn new(pool: DbPool) -> Self {
        EmailVerificationRepository { pool }
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
    ) -> Result<Option<EmailVerificationRecord>, ApiError> {
        email_verifications::table
            .filter(email_verifications::token_hash.eq(token_hash))
            .select(EmailVerificationRecord::as_select())
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("email verification lookup"))
    }

    /// How many links the user was sent at or after `since`.
    pub fn count_since(&self, user_id: &str, since: NaiveDateTime) -> Result<i64, ApiError> {
        email_verifications::table
            .filter(email_verifications::user_id.eq(user_id))
            .filter(email_verifications::created_at.ge(since))
            .count()
            .get_result(&mut self.conn()?)
            .map_err(db_err("email verification count"))
    }

    /// Revoke every live link the user holds, then insert `row` — one
    /// transaction, so only the newest email in the inbox works.
    pub fn replace_with(
        &self,
        row: &NewEmailVerification,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        conn.transaction(|conn| {
            diesel::update(
                email_verifications::table
                    .filter(email_verifications::user_id.eq(&row.user_id))
                    .filter(email_verifications::used_at.is_null())
                    .filter(email_verifications::revoked_at.is_null()),
            )
            .set(email_verifications::revoked_at.eq(now))
            .execute(conn)?;
            diesel::insert_into(email_verifications::table)
                .values(row)
                .execute(conn)?;
            Ok(())
        })
        .map_err(db_err("email verification insert"))
    }

    /// Spend the link and mark its account verified, if the link is still
    /// live — one transaction. Returns whether this call spent it.
    pub fn verify(&self, record: &EmailVerificationRecord, now: NaiveDateTime) -> Result<bool, ApiError> {
        let mut conn = self.conn()?;
        conn.transaction(|conn| {
            let n = diesel::update(
                email_verifications::table
                    .filter(email_verifications::id.eq(&record.id))
                    .filter(email_verifications::used_at.is_null())
                    .filter(email_verifications::revoked_at.is_null())
                    .filter(email_verifications::expires_at.gt(now)),
            )
            .set(email_verifications::used_at.eq(now))
            .execute(conn)?;
            if n == 0 {
                return Ok(false);
            }
            diesel::update(
                users::table
                    .filter(users::id.eq(&record.user_id))
                    .filter(users::email.eq(&record.email))
                    .filter(users::email_verified_at.is_null()),
            )
            .set(users::email_verified_at.eq(now))
            .execute(conn)?;
            Ok(true)
        })
        .map_err(db_err("email verification"))
    }
}
