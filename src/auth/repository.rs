use crate::schema::{refresh_tokens, totp_backup_codes, user_profiles, users};
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
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::users)]
pub struct NewUser<'a> {
    pub id: &'a str,
    pub email: &'a str,
    pub name: &'a str,
    pub password_hash: &'a str,
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

        let tokens = refresh_tokens::table
            .filter(refresh_tokens::user_id.eq(user_id_val))
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

        conn.transaction::<UserPublicKey, diesel::result::Error, _>(|conn| {
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
}
