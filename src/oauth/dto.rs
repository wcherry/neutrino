use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Query parameters for the OAuth 2.0 authorization endpoint.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AuthorizeQuery {
    pub client_id: String,
    pub redirect_uri: String,
    pub response_type: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
    pub state: Option<String>,
    pub scope: Option<String>,
}

/// Form body for the OAuth 2.0 token endpoint (application/x-www-form-urlencoded).
#[derive(Debug, Deserialize, ToSchema)]
pub struct TokenRequest {
    pub grant_type: String,
    pub code: Option<String>,
    pub redirect_uri: Option<String>,
    /// Optional per RFC 6749 §4.1.3; included here for spec compliance.
    #[allow(dead_code)]
    pub client_id: Option<String>,
    pub code_verifier: Option<String>,
    pub refresh_token: Option<String>,
}

/// Response returned by the token endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: u64,
}

/// Form body for the OAuth 2.0 token revocation endpoint (RFC 7009).
#[derive(Debug, Deserialize, ToSchema)]
pub struct RevokeRequest {
    pub token: String,
}
