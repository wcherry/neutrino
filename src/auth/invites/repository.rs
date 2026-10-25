//! Storage for `invites`. Every method takes its own connection and gives it
//! back before returning, so callers can chain them on a one-connection pool.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, PooledConnection};

use super::model::{InviteRecord, NewInvite, KIND_EMAIL, KIND_LINK};
use crate::schema::{invites, users};
use crate::shared::{ApiError, DbPool};

/// Reads and writes the `invites` table.
pub struct InviteRepository {
    pool: DbPool,
}

fn db_err(context: &'static str) -> impl FnOnce(diesel::result::Error) -> ApiError {
    move |e| {
        tracing::error!("DB {} error: {:?}", context, e);
        ApiError::internal("Database error")
    }
}

impl InviteRepository {
    pub fn new(pool: DbPool) -> Self {
        InviteRepository { pool }
    }

    fn conn(&self) -> Result<PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    /// The user's `(name, email)`, if they exist.
    pub fn user_name_and_email(&self, user_id: &str) -> Result<Option<(String, String)>, ApiError> {
        users::table
            .filter(users::id.eq(user_id))
            .select((users::name, users::email))
            .first::<(String, String)>(&mut self.conn()?)
            .optional()
            .map_err(db_err("user lookup"))
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<InviteRecord>, ApiError> {
        invites::table
            .filter(invites::id.eq(id))
            .select(InviteRecord::as_select())
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("invite lookup"))
    }

    pub fn find_by_token_hash(&self, token_hash: &str) -> Result<Option<InviteRecord>, ApiError> {
        invites::table
            .filter(invites::token_hash.eq(token_hash))
            .select(InviteRecord::as_select())
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("invite lookup"))
    }

    /// The user's emailed invites, newest first.
    pub fn list_emailed(&self, inviter_id: &str) -> Result<Vec<InviteRecord>, ApiError> {
        invites::table
            .filter(invites::inviter_id.eq(inviter_id))
            .filter(invites::kind.eq(KIND_EMAIL))
            .order(invites::created_at.desc())
            .select(InviteRecord::as_select())
            .load(&mut self.conn()?)
            .map_err(db_err("invite list"))
    }

    /// How many emailed invites the user created at or after `since`, revoked
    /// ones included.
    pub fn count_emailed_since(
        &self,
        inviter_id: &str,
        since: NaiveDateTime,
    ) -> Result<i64, ApiError> {
        invites::table
            .filter(invites::inviter_id.eq(inviter_id))
            .filter(invites::kind.eq(KIND_EMAIL))
            .filter(invites::created_at.ge(since))
            .count()
            .get_result(&mut self.conn()?)
            .map_err(db_err("invite count"))
    }

    /// In one transaction: revoke the inviter's pending invites to each of the
    /// batch's addresses, then insert the batch.
    pub fn replace_and_insert_emailed(
        &self,
        inviter_id: &str,
        rows: &[NewInvite],
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let addresses: Vec<&str> = rows
            .iter()
            .filter_map(|r| r.invitee_email.as_deref())
            .collect();
        self.conn()?
            .transaction::<_, diesel::result::Error, _>(|conn| {
                diesel::update(
                    invites::table
                        .filter(invites::inviter_id.eq(inviter_id))
                        .filter(invites::kind.eq(KIND_EMAIL))
                        .filter(invites::invitee_email.eq_any(&addresses))
                        .filter(invites::revoked_at.is_null())
                        .filter(invites::accepted_at.is_null())
                        .filter(invites::expires_at.gt(now)),
                )
                .set(invites::revoked_at.eq(now))
                .execute(conn)?;
                diesel::insert_into(invites::table)
                    .values(rows)
                    .execute(conn)?;
                Ok(())
            })
            .map_err(db_err("invite insert"))
    }

    /// The user's newest unrevoked, unexpired personal link.
    pub fn live_link(
        &self,
        inviter_id: &str,
        now: NaiveDateTime,
    ) -> Result<Option<InviteRecord>, ApiError> {
        invites::table
            .filter(invites::inviter_id.eq(inviter_id))
            .filter(invites::kind.eq(KIND_LINK))
            .filter(invites::revoked_at.is_null())
            .filter(invites::expires_at.gt(now))
            .order(invites::created_at.desc())
            .select(InviteRecord::as_select())
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("invite link lookup"))
    }

    /// In one transaction: revoke every unrevoked personal link the user has,
    /// then insert `row` (when given).
    pub fn replace_links(
        &self,
        inviter_id: &str,
        row: Option<&NewInvite>,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        self.conn()?
            .transaction::<_, diesel::result::Error, _>(|conn| {
                diesel::update(
                    invites::table
                        .filter(invites::inviter_id.eq(inviter_id))
                        .filter(invites::kind.eq(KIND_LINK))
                        .filter(invites::revoked_at.is_null()),
                )
                .set(invites::revoked_at.eq(now))
                .execute(conn)?;
                if let Some(row) = row {
                    diesel::insert_into(invites::table)
                        .values(row)
                        .execute(conn)?;
                }
                Ok(())
            })
            .map_err(db_err("invite link reset"))
    }

    pub fn insert(&self, row: &NewInvite) -> Result<(), ApiError> {
        diesel::insert_into(invites::table)
            .values(row)
            .execute(&mut self.conn()?)
            .map_err(db_err("invite insert"))?;
        Ok(())
    }

    pub fn set_revoked(&self, id: &str, now: NaiveDateTime) -> Result<(), ApiError> {
        diesel::update(
            invites::table
                .filter(invites::id.eq(id))
                .filter(invites::revoked_at.is_null()),
        )
        .set(invites::revoked_at.eq(now))
        .execute(&mut self.conn()?)
        .map_err(db_err("invite revoke"))?;
        Ok(())
    }

    /// Spend an emailed invite if it is still unused, unrevoked and unexpired.
    /// Returns whether this call spent it.
    pub fn claim_emailed(&self, id: &str, now: NaiveDateTime) -> Result<bool, ApiError> {
        let n = diesel::update(
            invites::table
                .filter(invites::id.eq(id))
                .filter(invites::kind.eq(KIND_EMAIL))
                .filter(invites::accepted_at.is_null())
                .filter(invites::revoked_at.is_null())
                .filter(invites::expires_at.gt(now)),
        )
        .set((
            invites::accepted_at.eq(now),
            invites::use_count.eq(invites::use_count + 1),
        ))
        .execute(&mut self.conn()?)
        .map_err(db_err("invite claim"))?;
        Ok(n == 1)
    }

    /// Count one use of a personal link if it is unrevoked and unexpired.
    /// Returns whether it was counted.
    pub fn claim_link(&self, id: &str, now: NaiveDateTime) -> Result<bool, ApiError> {
        let n = diesel::update(
            invites::table
                .filter(invites::id.eq(id))
                .filter(invites::kind.eq(KIND_LINK))
                .filter(invites::revoked_at.is_null())
                .filter(invites::expires_at.gt(now)),
        )
        .set((
            invites::accepted_at.eq(now),
            invites::use_count.eq(invites::use_count + 1),
        ))
        .execute(&mut self.conn()?)
        .map_err(db_err("invite claim"))?;
        Ok(n == 1)
    }

    pub fn set_accepted_user(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        diesel::update(invites::table.filter(invites::id.eq(id)))
            .set(invites::accepted_user_id.eq(user_id))
            .execute(&mut self.conn()?)
            .map_err(db_err("invite confirm"))?;
        Ok(())
    }

    /// Give back an emailed invite's single use.
    pub fn release_emailed(&self, id: &str) -> Result<(), ApiError> {
        diesel::update(
            invites::table
                .filter(invites::id.eq(id))
                .filter(invites::kind.eq(KIND_EMAIL)),
        )
        .set((
            invites::accepted_at.eq(None::<NaiveDateTime>),
            invites::accepted_user_id.eq(None::<String>),
            invites::use_count.eq(0),
        ))
        .execute(&mut self.conn()?)
        .map_err(db_err("invite release"))?;
        Ok(())
    }

    /// Give back one use of a personal link.
    pub fn release_link(&self, id: &str) -> Result<(), ApiError> {
        diesel::update(
            invites::table
                .filter(invites::id.eq(id))
                .filter(invites::kind.eq(KIND_LINK))
                .filter(invites::use_count.gt(0)),
        )
        .set(invites::use_count.eq(invites::use_count - 1))
        .execute(&mut self.conn()?)
        .map_err(db_err("invite release"))?;
        Ok(())
    }
}
