use crate::schema::{oauth_authorization_codes, oauth_clients};
use crate::shared::{ApiError, DbPool};
use chrono::NaiveDateTime;
use diesel::prelude::*;

// ── OauthClient ───────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = crate::schema::oauth_clients)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct OauthClient {
    pub id: String,
    pub name: String,
    pub redirect_uris: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::oauth_clients)]
pub struct NewOauthClient<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub redirect_uris: &'a str,
}

// ── OauthAuthorizationCode ────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = crate::schema::oauth_authorization_codes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct OauthAuthorizationCode {
    pub code: String,
    pub client_id: String,
    pub user_id: String,
    pub redirect_uri: String,
    pub scope: Option<String>,
    pub code_challenge: String,
    pub code_challenge_method: String,
    pub expires_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::oauth_authorization_codes)]
pub struct NewOauthAuthorizationCode<'a> {
    pub code: &'a str,
    pub client_id: &'a str,
    pub user_id: &'a str,
    pub redirect_uri: &'a str,
    pub scope: Option<&'a str>,
    pub code_challenge: &'a str,
    pub code_challenge_method: &'a str,
    pub expires_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
}

// ── Repository ────────────────────────────────────────────────────────────────

pub struct OauthRepository {
    pool: DbPool,
}

impl OauthRepository {
    pub fn new(pool: DbPool) -> Self {
        OauthRepository { pool }
    }

    /// Look up a registered OAuth client by its `client_id`.
    pub fn find_client(&self, client_id: &str) -> Result<Option<OauthClient>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = oauth_clients::table
            .filter(oauth_clients::id.eq(client_id))
            .select(OauthClient::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        Ok(result)
    }

    /// Persist a newly-issued authorization code.
    pub fn create_authorization_code(
        &self,
        code: NewOauthAuthorizationCode,
    ) -> Result<OauthAuthorizationCode, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        diesel::insert_into(oauth_authorization_codes::table)
            .values(&code)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let stored = oauth_authorization_codes::table
            .filter(oauth_authorization_codes::code.eq(code.code))
            .select(OauthAuthorizationCode::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error after insert: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(stored)
    }

    /// Atomically find and delete an authorization code using a single connection.
    ///
    /// Returns `None` when the code does not exist. Deletes the row on a
    /// successful find so that every code can only be redeemed once.
    pub fn find_and_delete_authorization_code(
        &self,
        code_val: &str,
    ) -> Result<Option<OauthAuthorizationCode>, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })?;

        let result = oauth_authorization_codes::table
            .filter(oauth_authorization_codes::code.eq(code_val))
            .select(OauthAuthorizationCode::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database query error")
            })?;

        if let Some(ref row) = result {
            diesel::delete(
                oauth_authorization_codes::table
                    .filter(oauth_authorization_codes::code.eq(&row.code)),
            )
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        }

        Ok(result)
    }
}
