use crate::shared::ApiError;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use rand_core::{OsRng, RngCore};



#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub exp: i64,
    pub iat: i64,
    #[serde(default)]
    pub is_admin: bool,
}

pub struct TokenService {
    secret: String,
    access_expiry_secs: u64,
    refresh_expiry_secs: u64,
}

impl TokenService {
    #[allow(dead_code)]
    pub fn new(secret: String) -> Self {
        TokenService {
            secret,
            access_expiry_secs: 0,
            refresh_expiry_secs: 0,
        }
    }

    pub fn new_with_expiry(secret: String, access_expiry_secs: u64, refresh_expiry_secs: u64) -> Self {
        TokenService {
            secret,
            access_expiry_secs,
            refresh_expiry_secs,
        }
    }

    #[allow(dead_code)]
    pub fn generate_access_token(&self, user_id: &str, email: &str) -> Result<String, ApiError> {
        self.generate_access_token_with_admin(user_id, email, false)
    }

    pub fn generate_access_token_with_admin(&self, user_id: &str, email: &str, is_admin: bool) -> Result<String, ApiError> {
        let now = Utc::now();
        let expiry = now + Duration::seconds(self.access_expiry_secs as i64);

        let claims = Claims {
            sub: user_id.to_string(),
            email: email.to_string(),
            exp: expiry.timestamp(),
            iat: now.timestamp(),
            is_admin,
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(|e| {
            tracing::error!("Failed to generate access token: {:?}", e);
            ApiError::internal("Failed to generate access token")
        })
    }

    pub fn generate_refresh_token(&self) -> Result<(String, chrono::NaiveDateTime), ApiError> {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let token = hex::encode(bytes);

        let expires_at = (Utc::now() + Duration::seconds(self.refresh_expiry_secs as i64))
            .naive_utc();

        Ok((token, expires_at))
    }

    #[allow(dead_code)]
    pub fn generate_token_with_custom_expiry(
        &self,
        user_id: &str,
        email: &str,
        is_admin: bool,
        expiry_secs: i64,
    ) -> Result<String, ApiError> {
        let now = Utc::now();
        let expiry = now + Duration::seconds(expiry_secs);
        let claims = Claims {
            sub: user_id.to_string(),
            email: email.to_string(),
            exp: expiry.timestamp(),
            iat: now.timestamp(),
            is_admin,
        };
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(|e| {
            tracing::error!("Failed to generate token: {:?}", e);
            ApiError::internal("Failed to generate token")
        })
    }

    pub fn validate_access_token(&self, token: &str) -> Result<Claims, ApiError> {
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::default(),
        )
        .map(|data| data.claims)
        .map_err(|e| {
            tracing::warn!("Token validation failed: {:?}", e);
            ApiError::unauthorized("Invalid or expired token")
        })
    }

    pub fn access_expiry_secs(&self) -> u64 {
        self.access_expiry_secs
    }
}

pub fn hash_token(token: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}
