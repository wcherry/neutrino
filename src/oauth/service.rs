use super::dto::{AuthorizeQuery, RevokeRequest, TokenRequest, TokenResponse};
use super::repository::{NewOauthAuthorizationCode, OauthRepository};
use crate::auth::repository::{AuthRepository, NewRefreshToken};
use crate::auth::tokens::hash_token;
use crate::shared::{ApiError, auth::tokens::TokenService};
use base64::Engine as _;
use chrono::Utc;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

pub struct OauthService {
    repo: Arc<OauthRepository>,
    auth_repo: Arc<AuthRepository>,
    token_service: Arc<TokenService>,
}

impl OauthService {
    pub fn new(
        repo: Arc<OauthRepository>,
        auth_repo: Arc<AuthRepository>,
        token_service: Arc<TokenService>,
    ) -> Self {
        OauthService {
            repo,
            auth_repo,
            token_service,
        }
    }

    /// Validate the authorization request parameters.
    ///
    /// Checks that the client exists, the redirect URI is registered, the
    /// response type is "code", and the PKCE method is "S256".
    pub fn validate_authorize(&self, query: &AuthorizeQuery) -> Result<(), ApiError> {
        if query.response_type != "code" {
            return Err(ApiError::bad_request("response_type must be 'code'"));
        }
        if query.code_challenge_method != "S256" {
            return Err(ApiError::bad_request(
                "code_challenge_method must be 'S256'",
            ));
        }

        let client = self
            .repo
            .find_client(&query.client_id)?
            .ok_or_else(|| ApiError::bad_request("Unknown client"))?;

        let allowed: Vec<String> = serde_json::from_str(&client.redirect_uris).map_err(|e| {
            tracing::error!(
                "Failed to parse redirect_uris for client {}: {:?}",
                client.id,
                e
            );
            ApiError::internal("Invalid client configuration")
        })?;

        if !allowed.contains(&query.redirect_uri) {
            return Err(ApiError::bad_request(
                "redirect_uri not registered for this client",
            ));
        }

        Ok(())
    }

    /// Issue a short-lived authorization code and store it.
    ///
    /// Returns the 64-character hex-encoded code that the client must exchange
    /// within 5 minutes for tokens.
    pub fn issue_authorization_code(
        &self,
        user_id: &str,
        query: &AuthorizeQuery,
    ) -> Result<String, ApiError> {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let code = hex::encode(bytes);

        let expires_at = (Utc::now() + chrono::Duration::minutes(5)).naive_utc();
        let now = Utc::now().naive_utc();

        let new_code = NewOauthAuthorizationCode {
            code: &code,
            client_id: &query.client_id,
            user_id,
            redirect_uri: &query.redirect_uri,
            scope: query.scope.as_deref(),
            code_challenge: &query.code_challenge,
            code_challenge_method: &query.code_challenge_method,
            expires_at,
            created_at: now,
        };

        self.repo.create_authorization_code(new_code)?;
        Ok(code)
    }

    /// Exchange an authorization code and PKCE verifier for access + refresh tokens.
    pub fn exchange_code(&self, req: &TokenRequest) -> Result<TokenResponse, ApiError> {
        let code = req
            .code
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("code is required"))?;
        let redirect_uri = req
            .redirect_uri
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("redirect_uri is required"))?;
        let code_verifier = req
            .code_verifier
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("code_verifier is required"))?;

        let stored = self
            .repo
            .find_and_delete_authorization_code(code)?
            .ok_or_else(|| ApiError::bad_request("Invalid or expired authorization code"))?;

        if stored.expires_at < Utc::now().naive_utc() {
            return Err(ApiError::bad_request("Authorization code has expired"));
        }

        if stored.redirect_uri != redirect_uri {
            return Err(ApiError::bad_request("redirect_uri mismatch"));
        }

        // PKCE S256: BASE64URL(SHA256(ASCII(code_verifier))) == code_challenge
        let mut hasher = Sha256::new();
        hasher.update(code_verifier.as_bytes());
        let hash = hasher.finalize();
        let computed_challenge =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash.as_slice());

        if computed_challenge != stored.code_challenge {
            return Err(ApiError::bad_request("PKCE verification failed"));
        }

        let user = self
            .auth_repo
            .find_user_by_id(&stored.user_id)?
            .ok_or_else(|| ApiError::unauthorized("User not found"))?;

        let is_admin = user.role == "admin";
        let access_token =
            self.token_service
                .generate_access_token_with_admin(&user.id, &user.email, is_admin)?;
        let (refresh_token_raw, expires_at) = self.token_service.generate_refresh_token()?;
        let token_hash = hash_token(&refresh_token_raw);

        let token_id = Uuid::new_v4().to_string();
        self.auth_repo.create_refresh_token(NewRefreshToken {
            id: &token_id,
            user_id: &user.id,
            token_hash: &token_hash,
            expires_at,
            device_name: Some("OAuth Desktop"),
            user_agent: None,
            ip_address: None,
        })?;

        Ok(TokenResponse {
            access_token,
            refresh_token: refresh_token_raw,
            token_type: "Bearer".to_string(),
            expires_in: self.token_service.access_expiry_secs(),
        })
    }

    /// Exchange a refresh token for a new access token + refresh token pair.
    ///
    /// The old refresh token is rotated (deleted and replaced).
    pub fn refresh_token(&self, refresh_token: &str) -> Result<TokenResponse, ApiError> {
        let token_hash = hash_token(refresh_token);

        let stored = self
            .auth_repo
            .find_refresh_token_by_hash(&token_hash)?
            .ok_or_else(|| ApiError::unauthorized("Invalid refresh token"))?;

        if stored.expires_at < Utc::now().naive_utc() {
            let _ = self.auth_repo.delete_refresh_token(&stored.id);
            return Err(ApiError::unauthorized("Refresh token has expired"));
        }

        let user = self
            .auth_repo
            .find_user_by_id(&stored.user_id)?
            .ok_or_else(|| ApiError::unauthorized("User not found"))?;

        self.auth_repo.delete_refresh_token(&stored.id)?;

        let is_admin = user.role == "admin";
        let access_token =
            self.token_service
                .generate_access_token_with_admin(&user.id, &user.email, is_admin)?;
        let (new_refresh_token, new_expires_at) = self.token_service.generate_refresh_token()?;
        let new_token_hash = hash_token(&new_refresh_token);

        let token_id = Uuid::new_v4().to_string();
        self.auth_repo.create_refresh_token(NewRefreshToken {
            id: &token_id,
            user_id: &user.id,
            token_hash: &new_token_hash,
            expires_at: new_expires_at,
            device_name: stored.device_name.as_deref(),
            user_agent: stored.user_agent.as_deref(),
            ip_address: stored.ip_address.as_deref(),
        })?;

        Ok(TokenResponse {
            access_token,
            refresh_token: new_refresh_token,
            token_type: "Bearer".to_string(),
            expires_in: self.token_service.access_expiry_secs(),
        })
    }

    /// Revoke a refresh token (no-op if the token is unknown, per RFC 7009).
    pub fn revoke_token(&self, _req: &RevokeRequest, token: &str) -> Result<(), ApiError> {
        let token_hash = hash_token(token);
        if let Some(stored) = self.auth_repo.find_refresh_token_by_hash(&token_hash)? {
            self.auth_repo.delete_refresh_token(&stored.id)?;
        }
        Ok(())
    }
}
