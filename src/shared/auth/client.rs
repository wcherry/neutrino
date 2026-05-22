use reqwest::StatusCode;
use serde::Deserialize;

use crate::shared::ApiError;
use crate::shared::auth::AuthenticatedUser;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct AuthUserProfile {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[allow(dead_code)]
pub async fn fetch_auth_profile(user: &AuthenticatedUser) -> Result<AuthUserProfile, ApiError> {
    let auth_url = std::env::var("AUTH_URL")
        .map_err(|_| ApiError::internal("AUTH_URL environment variable is required"))?;
    let base = auth_url.trim_end_matches('/');
    let url = format!("{}/api/v1/auth/me", base);

    let res = reqwest::Client::new()
        .get(url)
        .bearer_auth(&user.token)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Auth service request failed: {:?}", e);
            ApiError::internal("Failed to reach auth service")
        })?;

    if res.status() == StatusCode::UNAUTHORIZED {
        return Err(ApiError::unauthorized("Auth service rejected access token"));
    }

    if !res.status().is_success() {
        tracing::error!("Auth service error: status {}", res.status());
        return Err(ApiError::internal("Auth service error"));
    }

    res.json::<AuthUserProfile>().await.map_err(|e| {
        tracing::error!("Auth profile parse error: {:?}", e);
        ApiError::internal("Invalid auth profile response")
    })
}
