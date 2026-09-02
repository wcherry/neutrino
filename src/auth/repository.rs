use crate::schema::{
    password_history as history, refresh_tokens, totp_backup_codes, user_profiles, users,
};
use crate::shared::{ApiError, DbPool};
use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = crate::schema::users)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub password_hash: String,
    pub created_at: NaiveDateTime,
    pub role: String,
    pub totp_secret: Option<String>,
    pub totp_enabled: i32,
    pub deleted_at: Option<NaiveDateTime>,
    pub public_key: Option<String>,
    /// When an admin locked the account out. `None` for a live account.
    /// Distinct from `deleted_at`: a disabled account is still listed, still
    /// owns its files, and is re-enabled by clearing this.
    pub disabled_at: Option<NaiveDateTime>,
    /// When the password was last set. `None` only for an account created
    /// before migration 120 that has never changed it since.
    pub password_changed_at: Option<NaiveDateTime>,
    /// When an admin forced the password to expire. `None` normally; a
    /// policy-driven expiry is computed from `password_changed_at` instead.
    pub password_expired_at: Option<NaiveDateTime>,
    /// Consecutive sign-ins that got the password wrong. Reset by one that
    /// gets it right, so unrelated typos never accumulate into a lockout.
    pub failed_login_attempts: i32,
    /// When the run of failures reached the policy's threshold. `None`
    /// normally. Distinct from `disabled_at`: this was applied by a counter and
    /// is cleared by Unlock, whereas a disabled account was a decision.
    pub locked_out_at: Option<NaiveDateTime>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::users)]
pub struct NewUser<'a> {
    pub id: &'a str,
    pub email: &'a str,
    pub name: &'a str,
    pub password_hash: &'a str,
    /// `None` leaves the column default, `"user"`. Set only where an admin
    /// creates an account and picks the role up front.
    pub role: Option<&'a str>,
    /// Stamped at creation so a maximum-age policy has an age to measure from
    /// for every account made from here on.
    pub password_changed_at: Option<NaiveDateTime>,
    /// Set to force the new account to choose its own password before it can
    /// sign in — what "require a password change" on the admin's create form
    /// means.
    pub password_expired_at: Option<NaiveDateTime>,
}

/// One published version of a user's Curve25519 identity key.
///
/// Public halves only. The secret key is created on the user's device and never
/// leaves it — see `agent_docs/client-only-key-architecture.md`.
#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_public_keys)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserPublicKey {
    pub user_id: String,
    pub version: i32,
    pub public_key: String,
    pub created_at: NaiveDateTime,
    /// NULL for the active version.
    pub retired_at: Option<NaiveDateTime>,
}

#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = crate::schema::refresh_tokens)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct RefreshToken {
    pub id: String,
    pub user_id: String,
    pub token_hash: String,
    pub expires_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
    pub device_name: Option<String>,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub last_used_at: Option<NaiveDateTime>,
    /// When this token was exchanged for a new pair. NULL until it is used.
    /// See `consume_refresh_token` for why a spent token is kept for a while.
    pub rotated_at: Option<NaiveDateTime>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::refresh_tokens)]
pub struct NewRefreshToken<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub token_hash: &'a str,
    pub expires_at: NaiveDateTime,
    pub device_name: Option<&'a str>,
    pub user_agent: Option<&'a str>,
    pub ip_address: Option<&'a str>,
}

#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = crate::schema::totp_backup_codes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TotpBackupCode {
    pub id: String,
    pub user_id: String,
    pub code_hash: String,
    pub used_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::totp_backup_codes)]
pub struct NewTotpBackupCode<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub code_hash: &'a str,
}

#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_profiles)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserProfile {
    pub user_id: String,
    pub theme: Option<String>,
    pub bio: Option<String>,
    pub avatar: Option<String>,
    pub profile_image: Option<String>,
    pub website: Option<String>,
    pub social_links: Option<String>,
    pub language: Option<String>,
    pub timezone: Option<String>,
    pub country: Option<String>,
    pub email_marketing: i32,
    pub email_general: i32,
    pub email_updates: i32,
    pub email_critical: i32,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable, AsChangeset)]
#[diesel(table_name = crate::schema::user_profiles)]
pub struct UpsertUserProfile<'a> {
    pub user_id: &'a str,
    pub theme: Option<&'a str>,
    pub bio: Option<&'a str>,
    pub avatar: Option<&'a str>,
    pub profile_image: Option<&'a str>,
    pub website: Option<&'a str>,
    pub social_links: Option<&'a str>,
    pub language: Option<&'a str>,
    pub timezone: Option<&'a str>,
    pub country: Option<&'a str>,
    pub email_marketing: i32,
    pub email_general: i32,
    pub email_updates: i32,
    pub email_critical: i32,
    pub updated_at: NaiveDateTime,
}

pub struct AuthRepository {
    pool: DbPool,
}

impl AuthRepository {
    pub fn new(pool: DbPool) -> Self {
        AuthRepository { pool }
    }

    pub fn find_user_by_email(&self, email_val: &str) -> Result<Option<User>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = users::table
            .filter(users::email.eq(email_val))
            .filter(users::deleted_at.is_null())
            .select(User::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(result)
    }

    pub fn search_users(&self, query: &str, limit: i64) -> Result<Vec<User>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let pattern = format!("%{}%", query.to_lowercase());
        let results = users::table
            .filter(users::deleted_at.is_null())
            .filter(
                users::email.like(&pattern)
                    .or(users::name.like(&pattern))
            )
            .select(User::as_select())
            .limit(limit)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(results)
    }

    pub fn find_user_by_id(&self, user_id: &str) -> Result<Option<User>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = users::table
            .filter(users::id.eq(user_id))
            .filter(users::deleted_at.is_null())
            .select(User::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(result)
    }

    /// Finds a user whether or not they are soft-deleted.
    ///
    /// Every other lookup filters `deleted_at IS NULL`, which is what makes a
    /// soft delete behave like a real one. Restoring an account is the one
    /// operation that has to see past that.
    pub fn find_user_by_id_including_deleted(
        &self,
        user_id: &str,
    ) -> Result<Option<User>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = users::table
            .filter(users::id.eq(user_id))
            .select(User::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(result)
    }

    /// Clears `deleted_at`, putting the account back in every lookup.
    ///
    /// This is only ever reachable during the grace window: once the worker's
    /// purge has run there is no row left to restore.
    pub fn restore_user(&self, user_id_val: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::deleted_at.eq(None::<chrono::NaiveDateTime>))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn create_user(&self, new_user: NewUser) -> Result<User, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::insert_into(users::table)
            .values(&new_user)
            .execute(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::DatabaseError(
                    diesel::result::DatabaseErrorKind::UniqueViolation,
                    _,
                ) => ApiError::conflict("Email already registered"),
                _ => {
                    tracing::error!("DB insert error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })?;

        let user = users::table
            .filter(users::id.eq(new_user.id))
            .select(User::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error after insert: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(user)
    }

    pub fn create_refresh_token(
        &self,
        new_token: NewRefreshToken,
    ) -> Result<RefreshToken, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::insert_into(refresh_tokens::table)
            .values(&new_token)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let token = refresh_tokens::table
            .filter(refresh_tokens::id.eq(new_token.id))
            .select(RefreshToken::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error after insert: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(token)
    }

    pub fn find_refresh_token_by_hash(
        &self,
        token_hash_val: &str,
    ) -> Result<Option<RefreshToken>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = refresh_tokens::table
            .filter(refresh_tokens::token_hash.eq(token_hash_val))
            .select(RefreshToken::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(result)
    }

    /// Present a refresh token for rotation, returning the row it names.
    ///
    /// Both refresh endpoints — `/api/v1/auth/refresh` and the OAuth token
    /// endpoint — go through here so the rules stay in one place:
    ///
    /// * an unknown token is rejected, as before;
    /// * an expired token is rejected and deleted, as before;
    /// * the **first** presentation marks the row rotated and hands it back;
    /// * a **repeat** presentation inside `grace` is still honoured, because
    ///   it is a client that had two requests in flight when its access token
    ///   expired, not an attacker — and refusing it signs the user out
    ///   (see migration 00117);
    /// * a repeat presentation after `grace` is rejected and the row deleted.
    ///
    /// The claim is a conditional `UPDATE … WHERE rotated_at IS NULL`, so two
    /// requests racing on the same token cannot both be the first: SQLite
    /// serialises the writes and the loser is told it is a replay.
    ///
    /// Rows whose grace has run out are purged on the way in, which is what
    /// keeps spent tokens from accumulating in a table that is also the user's
    /// session list.
    ///
    /// Every statement runs on the one connection this takes out. Calling
    /// `delete_refresh_token` from here instead would ask the pool for a second
    /// connection while still holding the first, which is a deadlock the moment
    /// the pool is that small — the test pool is exactly one.
    pub fn consume_refresh_token(
        &self,
        token_hash_val: &str,
        now: NaiveDateTime,
        grace: chrono::Duration,
    ) -> Result<RefreshToken, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::delete(
            refresh_tokens::table.filter(refresh_tokens::rotated_at.lt(Some(now - grace))),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        let claimed = diesel::update(
            refresh_tokens::table
                .filter(refresh_tokens::token_hash.eq(token_hash_val))
                .filter(refresh_tokens::rotated_at.is_null()),
        )
        .set(refresh_tokens::rotated_at.eq(Some(now)))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        let stored = refresh_tokens::table
            .filter(refresh_tokens::token_hash.eq(token_hash_val))
            .select(RefreshToken::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?
            .ok_or_else(|| ApiError::unauthorized("Invalid refresh token"))?;

        let discard = |conn: &mut SqliteConnection| {
            if let Err(e) =
                diesel::delete(refresh_tokens::table.filter(refresh_tokens::id.eq(&stored.id)))
                    .execute(conn)
            {
                tracing::error!("DB delete error: {:?}", e);
            }
        };

        if stored.expires_at < now {
            discard(&mut conn);
            return Err(ApiError::unauthorized("Refresh token has expired"));
        }

        if claimed == 0 {
            // Rotated by an earlier request. The purge above already removed
            // anything past the window, so reaching here with a rotation older
            // than the grace means the clock moved between the two statements.
            let rotated_at = stored.rotated_at.unwrap_or(now);
            if now - rotated_at > grace {
                discard(&mut conn);
                return Err(ApiError::unauthorized("Refresh token has already been used"));
            }
            tracing::debug!(
                token_id = %stored.id,
                "refresh token replayed inside the rotation grace window"
            );
        }

        Ok(stored)
    }

    pub fn delete_refresh_token(&self, token_id: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::delete(refresh_tokens::table.filter(refresh_tokens::id.eq(token_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn list_refresh_tokens_for_user(
        &self,
        user_id_val: &str,
    ) -> Result<Vec<RefreshToken>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        // Rotated rows are the spent previous steps of sessions that are still
        // listed under their current token — showing them would turn one
        // browser into a new "device" every fifteen minutes.
        let tokens = refresh_tokens::table
            .filter(refresh_tokens::user_id.eq(user_id_val))
            .filter(refresh_tokens::rotated_at.is_null())
            .select(RefreshToken::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(tokens)
    }

    pub fn delete_all_refresh_tokens_for_user(&self, user_id_val: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::delete(refresh_tokens::table.filter(refresh_tokens::user_id.eq(user_id_val)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn update_user_totp(
        &self,
        user_id_val: &str,
        secret: Option<&str>,
        enabled: bool,
    ) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set((
                users::totp_secret.eq(secret),
                users::totp_enabled.eq(enabled as i32),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn create_backup_codes(&self, codes: Vec<NewTotpBackupCode>) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        // Delete existing codes first
        if let Some(first) = codes.first() {
            diesel::delete(
                totp_backup_codes::table.filter(totp_backup_codes::user_id.eq(first.user_id)),
            )
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        }

        diesel::insert_into(totp_backup_codes::table)
            .values(&codes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    #[allow(dead_code)]
    pub fn find_and_use_backup_code(
        &self,
        user_id_val: &str,
        code_hash_val: &str,
    ) -> Result<bool, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let code = totp_backup_codes::table
            .filter(totp_backup_codes::user_id.eq(user_id_val))
            .filter(totp_backup_codes::code_hash.eq(code_hash_val))
            .filter(totp_backup_codes::used_at.is_null())
            .select(TotpBackupCode::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        if let Some(code) = code {
            let now = chrono::Utc::now().naive_utc();
            diesel::update(totp_backup_codes::table.filter(totp_backup_codes::id.eq(&code.id)))
                .set(totp_backup_codes::used_at.eq(now))
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB update error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn soft_delete_user(&self, user_id_val: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let now = chrono::Utc::now().naive_utc();
        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::deleted_at.eq(now))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn update_user_name(&self, user_id_val: &str, new_name: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::name.eq(new_name))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    /// Lock an account out, or let it back in.
    ///
    /// Only the column moves here; the caller revokes refresh tokens, because a
    /// disabled user holding one could otherwise mint a fresh access token and
    /// carry on until it expired.
    pub fn set_user_disabled(&self, user_id_val: &str, disabled: bool) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let value = disabled.then(|| chrono::Utc::now().naive_utc());
        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::disabled_at.eq(value))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    /// Force the account's password to expire, or take the forced expiry back.
    ///
    /// Clearing it does not restart the age clock — `password_changed_at` is
    /// untouched — so a password already past the policy's maximum age stays
    /// expired, which is the honest answer.
    pub fn set_password_expired(&self, user_id_val: &str, expired: bool) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let value = expired.then(|| chrono::Utc::now().naive_utc());
        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::password_expired_at.eq(value))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    /// Count one sign-in that got the password wrong, and report the new total.
    ///
    /// The read-back is what the caller compares against the policy's
    /// threshold, so the decision to lock is made on the stored count rather
    /// than on one this process was holding.
    pub fn record_failed_login(&self, user_id_val: &str) -> Result<i32, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::failed_login_attempts.eq(users::failed_login_attempts + 1))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        users::table
            .filter(users::id.eq(user_id_val))
            .select(users::failed_login_attempts)
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Lock the account out on the policy's failure threshold.
    pub fn lock_out_user(&self, user_id_val: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::locked_out_at.eq(chrono::Utc::now().naive_utc()))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    /// Clear the lockout and the count behind it.
    ///
    /// Both move together always: releasing the account while leaving the count
    /// at the threshold would lock it again on the next single typo.
    pub fn clear_lockout(&self, user_id_val: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set((
                users::locked_out_at.eq(None::<NaiveDateTime>),
                users::failed_login_attempts.eq(0),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    /// Keep a password hash for the reuse check, newest last.
    ///
    /// Trimmed to `keep` rows — the module's fixed cap, not the policy's current
    /// count — so raising the count later still has history to check against.
    pub fn record_password_history(
        &self,
        user_id_val: &str,
        password_hash: &str,
        keep: i64,
    ) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::insert_into(history::table)
            .values((
                history::id.eq(uuid::Uuid::new_v4().to_string()),
                history::user_id.eq(user_id_val),
                history::password_hash.eq(password_hash),
                history::created_at.eq(chrono::Utc::now().naive_utc()),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB password history insert error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        // Read the ids to keep and delete the rest, rather than deleting by
        // offset: SQLite has no LIMIT on DELETE unless it was compiled with one.
        let keep_ids: Vec<String> = history::table
            .filter(history::user_id.eq(user_id_val))
            .order(history::created_at.desc())
            .limit(keep)
            .select(history::id)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB password history read error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        diesel::delete(
            history::table
                .filter(history::user_id.eq(user_id_val))
                .filter(history::id.ne_all(keep_ids)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB password history trim error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    /// The account's most recent password hashes, newest first.
    pub fn recent_password_hashes(
        &self,
        user_id_val: &str,
        limit: i64,
    ) -> Result<Vec<String>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        history::table
            .filter(history::user_id.eq(user_id_val))
            .order(history::created_at.desc())
            .limit(limit)
            .select(history::password_hash)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB password history read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Store a new password hash, restarting the age clock and clearing any
    /// forced expiry — the three always move together, so they are one write.
    pub fn update_user_password(
        &self,
        user_id_val: &str,
        password_hash: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let updated = diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set((
                users::password_hash.eq(password_hash),
                users::password_changed_at.eq(chrono::Utc::now().naive_utc()),
                users::password_expired_at.eq(None::<chrono::NaiveDateTime>),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        // An update matching no rows is not an error in Diesel, and a password
        // change that silently changed nothing is the worst possible outcome
        // here — the caller would report success and the old password would
        // still be the one that works.
        if updated == 0 {
            return Err(ApiError::not_found("User not found"));
        }

        Ok(())
    }

    pub fn update_user_role(&self, user_id_val: &str, new_role: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id_val)))
            .set(users::role.eq(new_role))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    /// Lists users a page at a time.
    ///
    /// `include_deleted` widens the page to soft-deleted accounts as well,
    /// which is what the admin console's restore view needs: an account in its
    /// grace window is invisible everywhere else by design, so without this
    /// there is nothing on screen to press Restore on. The count is filtered
    /// the same way as the page, or the pager reports a total the rows can't
    /// account for.
    pub fn list_users(
        &self,
        page: i64,
        page_size: i64,
        include_deleted: bool,
    ) -> Result<(Vec<User>, i64), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let offset = (page - 1) * page_size;

        // Diesel's builder types diverge the moment a filter is applied
        // conditionally, so the two shapes are spelled out rather than boxed.
        let (items, total) = if include_deleted {
            let items = users::table
                .order(users::created_at.desc())
                .limit(page_size)
                .offset(offset)
                .select(User::as_select())
                .load(&mut conn);
            let total = users::table.count().get_result::<i64>(&mut conn);
            (items, total)
        } else {
            let items = users::table
                .filter(users::deleted_at.is_null())
                .order(users::created_at.desc())
                .limit(page_size)
                .offset(offset)
                .select(User::as_select())
                .load(&mut conn);
            let total = users::table
                .filter(users::deleted_at.is_null())
                .count()
                .get_result::<i64>(&mut conn);
            (items, total)
        };

        let items = items.map_err(|e| {
            tracing::error!("DB query error: {:?}", e);
            ApiError::internal("Database query error")
        })?;
        let total = total.map_err(|e| {
            tracing::error!("DB count error: {:?}", e);
            ApiError::internal("Database query error")
        })?;

        Ok((items, total))
    }

    pub fn get_user_profile(&self, user_id_val: &str) -> Result<Option<UserProfile>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = user_profiles::table
            .filter(user_profiles::user_id.eq(user_id_val))
            .select(UserProfile::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(result)
    }

    pub fn upsert_user_profile(&self, profile: UpsertUserProfile) -> Result<UserProfile, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::insert_into(user_profiles::table)
            .values(&profile)
            .on_conflict(user_profiles::user_id)
            .do_update()
            .set(&profile)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB upsert error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let result = user_profiles::table
            .filter(user_profiles::user_id.eq(profile.user_id))
            .select(UserProfile::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error after upsert: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(result)
    }

    /// Publish `public_key` as the caller's newest identity version.
    ///
    /// Append-only: an existing version is never overwritten, because files are
    /// sealed to it and `file_key_refs.key_version` points at it by number.
    /// Re-publishing the key that is already active is a no-op returning that
    /// version — otherwise `ensurePublicKeyRegistered` firing twice would mint
    /// a second version holding identical bytes and retire a key nothing had
    /// stopped using.
    ///
    /// Runs in a transaction: retiring the old version and inserting the new
    /// one must not be separable, or the partial unique index on "one active
    /// version per user" would reject the insert and leave the user with no
    /// active key at all.
    ///
    /// `BEGIN IMMEDIATE`, not the plain deferred `BEGIN` a bare `transaction`
    /// would emit. The body reads before it writes, and SQLite does not run the
    /// busy handler when a deferred transaction upgrades a read lock to a write
    /// lock — waiting there could deadlock two readers, so it returns
    /// `SQLITE_BUSY` at once instead, and `PRAGMA busy_timeout` never applies.
    /// Under a concurrent write that surfaced as a 500 on first-run encryption
    /// setup, which leaves the account with no published key and therefore
    /// nothing able to seal a DEK. Taking the write lock up front is what the
    /// timeout can actually wait on.
    pub fn publish_public_key(
        &self,
        user_id: &str,
        public_key: &str,
    ) -> Result<UserPublicKey, ApiError> {
        use crate::schema::user_public_keys as upk;

        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        conn.immediate_transaction::<UserPublicKey, diesel::result::Error, _>(|conn| {
            let active: Option<UserPublicKey> = upk::table
                .filter(upk::user_id.eq(user_id))
                .filter(upk::retired_at.is_null())
                .select(UserPublicKey::as_select())
                .first(conn)
                .optional()?;

            if let Some(current) = active.as_ref() {
                if current.public_key == public_key {
                    return Ok(current.clone());
                }
            }

            let next_version = upk::table
                .filter(upk::user_id.eq(user_id))
                .select(diesel::dsl::max(upk::version))
                .first::<Option<i32>>(conn)?
                .unwrap_or(0)
                + 1;

            if active.is_some() {
                diesel::update(
                    upk::table
                        .filter(upk::user_id.eq(user_id))
                        .filter(upk::retired_at.is_null()),
                )
                .set(upk::retired_at.eq(diesel::dsl::now))
                .execute(conn)?;
            }

            diesel::insert_into(upk::table)
                .values((
                    upk::user_id.eq(user_id),
                    upk::version.eq(next_version),
                    upk::public_key.eq(public_key),
                ))
                .execute(conn)?;

            // Kept in step so paths that predate the keyring and only ever want
            // "the current key" keep working without joining this table.
            diesel::update(users::table.filter(users::id.eq(user_id)))
                .set(users::public_key.eq(public_key))
                .execute(conn)?;

            upk::table
                .filter(upk::user_id.eq(user_id))
                .filter(upk::version.eq(next_version))
                .select(UserPublicKey::as_select())
                .first(conn)
        })
        .map_err(|e| {
            tracing::error!("DB publish_public_key error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Every version `user_id` has published, oldest first.
    pub fn list_public_keys(&self, user_id: &str) -> Result<Vec<UserPublicKey>, ApiError> {
        use crate::schema::user_public_keys as upk;

        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        upk::table
            .filter(upk::user_id.eq(user_id))
            .order(upk::version.asc())
            .select(UserPublicKey::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list_public_keys error: {:?}", e);
                ApiError::internal("Database query error")
            })
    }


    #[allow(dead_code)]
    pub fn check_db_health(&self) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::sql_query("SELECT 1")
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB health check error: {:?}", e);
                ApiError::internal("Database health check failed")
            })?;

        Ok(())
    }
}

#[cfg(test)]
mod public_key_tests {
    use super::*;
    use crate::search::repository::{insert_test_user, test_pool};

    fn active_of(keys: &[UserPublicKey]) -> &UserPublicKey {
        keys.iter()
            .find(|k| k.retired_at.is_none())
            .expect("exactly one version should be active")
    }

    fn repo_with_user(user_id: &str) -> AuthRepository {
        let pool = test_pool();
        insert_test_user(&pool, user_id);
        AuthRepository::new(pool)
    }

    #[test]
    fn first_publish_is_version_one_and_active() {
        let repo = repo_with_user("u1");

        let published = repo.publish_public_key("u1", "key-a").expect("publish");

        assert_eq!(published.version, 1);
        assert!(published.retired_at.is_none());
    }

    #[test]
    fn republishing_the_active_key_does_not_mint_a_version() {
        // `ensurePublicKeyRegistered` can fire more than once. Minting a second
        // version holding identical bytes would retire a key nothing had
        // stopped using, and strand `file_key_refs` rows pointing at v1.
        let repo = repo_with_user("u1");

        let first = repo.publish_public_key("u1", "key-a").expect("publish");
        let again = repo.publish_public_key("u1", "key-a").expect("republish");

        assert_eq!(first.version, again.version);
        assert_eq!(repo.list_public_keys("u1").expect("list").len(), 1);
    }

    #[test]
    fn publishing_a_different_key_retires_the_previous_version() {
        let repo = repo_with_user("u1");
        repo.publish_public_key("u1", "key-a").expect("publish a");

        let rotated = repo.publish_public_key("u1", "key-b").expect("publish b");

        assert_eq!(rotated.version, 2);
        let keys = repo.list_public_keys("u1").expect("list");
        assert_eq!(keys.len(), 2);
        assert_eq!(active_of(&keys).version, 2);
        assert!(keys[0].retired_at.is_some(), "v1 should be retired");
    }

    #[test]
    fn retired_versions_are_kept_so_old_files_stay_resolvable() {
        // A rotated-away key is what `file_key_refs.key_version` points at for
        // every file sealed before the rotation. Deleting it would leave those
        // rows naming a version that no longer exists.
        let repo = repo_with_user("u1");
        repo.publish_public_key("u1", "key-a").expect("a");
        repo.publish_public_key("u1", "key-b").expect("b");
        repo.publish_public_key("u1", "key-c").expect("c");

        let keys = repo.list_public_keys("u1").expect("list");

        assert_eq!(
            keys.iter().map(|k| k.version).collect::<Vec<_>>(),
            vec![1, 2, 3],
            "every version is retained, oldest first"
        );
        assert_eq!(
            keys.iter().filter(|k| k.retired_at.is_none()).count(),
            1,
            "exactly one version is ever active"
        );
        assert_eq!(active_of(&keys).public_key, "key-c");
    }

    #[test]
    fn users_public_key_tracks_the_active_version() {
        // Paths that predate the keyring read `users.public_key` directly and
        // only ever want the current key; they must not go stale on rotation.
        let repo = repo_with_user("u1");
        repo.publish_public_key("u1", "key-a").expect("a");
        repo.publish_public_key("u1", "key-b").expect("b");

        let user = repo.find_user_by_id("u1").expect("query").expect("user");
        assert_eq!(user.public_key.as_deref(), Some("key-b"));
    }

    #[test]
    fn keyrings_are_per_user() {
        let pool = test_pool();
        insert_test_user(&pool, "u1");
        insert_test_user(&pool, "u2");
        let repo = AuthRepository::new(pool);

        repo.publish_public_key("u1", "key-a").expect("u1 a");
        repo.publish_public_key("u1", "key-b").expect("u1 b");
        let u2 = repo.publish_public_key("u2", "key-z").expect("u2 z");

        assert_eq!(u2.version, 1, "u2's numbering is independent of u1's");
        assert_eq!(repo.list_public_keys("u2").expect("list").len(), 1);
    }

    /// The regression: this reads before it writes, and SQLite will not run the
    /// busy handler when a *deferred* transaction upgrades a read lock to a
    /// write lock — it returns `SQLITE_BUSY` at once, so `busy_timeout` never
    /// gets a chance. Under a concurrent writer that surfaced as a 500 from
    /// `POST /api/v1/auth/keys`, which is first-run encryption setup: the
    /// account ends up with no published key, and nothing that seals a DEK —
    /// every editor's first save, every upload — can run.
    #[test]
    fn concurrent_first_publishes_all_succeed() {
        use crate::search::repository::test_file_pool;
        use std::sync::Arc;

        const USERS: usize = 8;

        let (pool, _db) = test_file_pool("auth-keys");
        for i in 0..USERS {
            insert_test_user(&pool, &format!("u{i}"));
        }
        let repo = Arc::new(AuthRepository::new(pool));

        let handles: Vec<_> = (0..USERS)
            .map(|i| {
                let repo = Arc::clone(&repo);
                std::thread::spawn(move || {
                    repo.publish_public_key(&format!("u{i}"), &format!("key-{i}"))
                        .map(|k| k.version)
                })
            })
            .collect();

        for (i, handle) in handles.into_iter().enumerate() {
            let version = handle
                .join()
                .expect("publishing thread")
                .unwrap_or_else(|e| panic!("u{i} could not publish its first key: {e:?}"));
            assert_eq!(version, 1);
        }
    }
}

#[cfg(test)]
mod refresh_token_tests {
    use super::*;
    use crate::search::repository::{insert_test_user, test_pool};
    use chrono::Duration;

    const GRACE: Duration = Duration::seconds(60);

    fn repo_with_user(user_id: &str) -> AuthRepository {
        let pool = test_pool();
        insert_test_user(&pool, user_id);
        AuthRepository::new(pool)
    }

    fn at(minutes: i64) -> NaiveDateTime {
        NaiveDateTime::parse_from_str("2026-08-27 12:00:00", "%Y-%m-%d %H:%M:%S").expect("base time")
            + Duration::minutes(minutes)
    }

    fn issue(repo: &AuthRepository, user_id: &str, hash: &str, expires_at: NaiveDateTime) -> String {
        repo.create_refresh_token(NewRefreshToken {
            id: &format!("tok-{hash}"),
            user_id,
            token_hash: hash,
            expires_at,
            device_name: Some("Test"),
            user_agent: None,
            ip_address: None,
        })
        .expect("issue token")
        .id
    }

    #[test]
    fn an_unknown_token_is_refused() {
        let repo = repo_with_user("u1");

        let err = repo
            .consume_refresh_token("no-such-hash", at(0), GRACE)
            .unwrap_err();

        assert_eq!(err.status, 401);
    }

    #[test]
    fn an_expired_token_is_refused_and_deleted() {
        let repo = repo_with_user("u1");
        issue(&repo, "u1", "h", at(-1));

        let err = repo.consume_refresh_token("h", at(0), GRACE).unwrap_err();

        assert_eq!(err.status, 401);
        assert!(repo
            .find_refresh_token_by_hash("h")
            .expect("lookup")
            .is_none());
    }

    #[test]
    fn a_token_replayed_inside_its_grace_is_still_accepted() {
        // The concurrency case behind the failure: two requests 401 together,
        // both refresh, and the second must not be told its session is gone.
        let repo = repo_with_user("u1");
        let id = issue(&repo, "u1", "h", at(60));

        let first = repo.consume_refresh_token("h", at(0), GRACE).expect("first");
        let replay = repo
            .consume_refresh_token("h", at(0), GRACE)
            .expect("replay inside the grace window");

        assert_eq!(first.id, id);
        assert_eq!(replay.id, id);
    }

    #[test]
    fn refresh_token_is_refused_once_its_grace_expires() {
        let repo = repo_with_user("u1");
        issue(&repo, "u1", "h", at(600));

        repo.consume_refresh_token("h", at(0), GRACE).expect("first");
        let err = repo.consume_refresh_token("h", at(5), GRACE).unwrap_err();

        assert_eq!(err.status, 401);
        assert!(
            repo.find_refresh_token_by_hash("h")
                .expect("lookup")
                .is_none(),
            "a token refused after its grace should not be left on the row"
        );
    }

    #[test]
    fn the_grace_runs_from_the_first_rotation_not_from_each_replay() {
        // Otherwise a client that kept presenting the same spent token would
        // hold it open forever.
        let repo = repo_with_user("u1");
        issue(&repo, "u1", "h", at(600));

        repo.consume_refresh_token("h", at(0), GRACE).expect("first");
        repo.consume_refresh_token("h", at(0), GRACE).expect("replay");
        let err = repo.consume_refresh_token("h", at(2), GRACE).unwrap_err();

        assert_eq!(err.status, 401);
    }

    #[test]
    fn spent_tokens_are_purged_on_the_next_refresh() {
        let repo = repo_with_user("u1");
        issue(&repo, "u1", "spent", at(600));
        issue(&repo, "u1", "live", at(600));
        repo.consume_refresh_token("spent", at(0), GRACE)
            .expect("spend the first token");

        repo.consume_refresh_token("live", at(10), GRACE)
            .expect("refresh with the live token");

        assert!(
            repo.find_refresh_token_by_hash("spent")
                .expect("lookup")
                .is_none(),
            "the spent row should not outlive its grace window"
        );
    }

    #[test]
    fn a_rotated_token_is_not_listed_as_a_session() {
        // Sessions are rows in this table, and a browser rotates every fifteen
        // minutes — listing the spent rows would show one device as dozens.
        let repo = repo_with_user("u1");
        issue(&repo, "u1", "old", at(600));
        repo.consume_refresh_token("old", at(0), GRACE)
            .expect("rotate");
        issue(&repo, "u1", "new", at(600));

        let sessions = repo.list_refresh_tokens_for_user("u1").expect("list");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].token_hash, "new");
    }

    #[test]
    fn racing_threads_agree_on_who_rotated_the_token() {
        // The claim is a conditional UPDATE precisely so two requests cannot
        // both be the first; both are still served, from the same row.
        use std::sync::Arc;

        let repo = Arc::new(repo_with_user("u1"));
        issue(&repo, "u1", "h", at(600));

        let handles: Vec<_> = (0..4)
            .map(|_| {
                let repo = Arc::clone(&repo);
                std::thread::spawn(move || {
                    repo.consume_refresh_token("h", at(0), GRACE).map(|t| t.id)
                })
            })
            .collect();

        for handle in handles {
            let id = handle.join().expect("thread").expect("every racer is served");
            assert_eq!(id, "tok-h");
        }
    }
}
