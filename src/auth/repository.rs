use crate::shared::{ApiError, DbPool};
use crate::schema::{refresh_tokens, totp_backup_codes, user_profiles, users};
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

    pub fn create_backup_codes(
        &self,
        codes: Vec<NewTotpBackupCode>,
    ) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        // Delete existing codes first
        if let Some(first) = codes.first() {
            diesel::delete(totp_backup_codes::table.filter(totp_backup_codes::user_id.eq(first.user_id)))
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

    pub fn list_users(
        &self,
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<User>, i64), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let offset = (page - 1) * page_size;
        let items = users::table
            .filter(users::deleted_at.is_null())
            .order(users::created_at.desc())
            .limit(page_size)
            .offset(offset)
            .select(User::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        let total: i64 = users::table
            .filter(users::deleted_at.is_null())
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
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

    pub fn set_public_key(&self, user_id: &str, public_key: &str) -> Result<(), ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::update(users::table.filter(users::id.eq(user_id)))
            .set(users::public_key.eq(public_key))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update public_key error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn get_public_key(&self, user_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = users::table
            .filter(users::id.eq(user_id))
            .filter(users::deleted_at.is_null())
            .select(users::public_key)
            .first::<Option<String>>(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query public_key error: {:?}", e);
                ApiError::internal("Database query error")
            })?
            .flatten();

        Ok(result)
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
