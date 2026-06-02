use chrono;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub totp_code: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: u64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    #[serde(flatten)]
    pub auth: Option<AuthResponse>,
    pub requires_two_factor: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RegisterResponse {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileResponse {
    pub id: String,
    pub email: String,
    pub name: String,
    pub created_at: chrono::NaiveDateTime,
    pub role: String,
    pub totp_enabled: bool,
}

/// Minimal user info returned by lookup endpoints.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserLookupResponse {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorStatusResponse {
    pub enabled: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorEnrollResponse {
    pub otpauth_uri: String,
    pub secret: String,
    pub backup_codes: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorConfirmRequest {
    pub code: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorDisableRequest {
    pub password: String,
    pub code: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub id: String,
    pub device_name: Option<String>,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub last_used_at: Option<chrono::NaiveDateTime>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionListResponse {
    pub sessions: Vec<SessionResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserResponse {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub totp_enabled: bool,
    pub created_at: chrono::NaiveDateTime,
    pub deleted_at: Option<chrono::NaiveDateTime>,
}

/// Public-facing profile returned when any authenticated user views another user's profile.
/// Email preferences and private fields are omitted.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicProfileResponse {
    pub user_id: String,
    pub name: String,
    pub bio: Option<String>,
    pub avatar: Option<String>,
    pub profile_image: Option<String>,
    pub website: Option<String>,
    pub social_links: SocialLinks,
    pub language: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AdminUpdateUserRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub totp_enabled: Option<bool>,
}

/// Social media links. Keys are platform names (e.g. "twitter", "github"), values are URLs.
#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct SocialLinks(pub HashMap<String, String>);

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmailPreferences {
    pub marketing: bool,
    pub general: bool,
    pub updates: bool,
    pub critical: bool,
}

impl Default for EmailPreferences {
    fn default() -> Self {
        EmailPreferences {
            marketing: false,
            general: true,
            updates: true,
            critical: true,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileDetailsResponse {
    pub user_id: String,
    pub theme: Option<String>,
    pub bio: Option<String>,
    pub avatar: Option<String>,
    pub profile_image: Option<String>,
    pub website: Option<String>,
    pub social_links: SocialLinks,
    pub language: Option<String>,
    pub timezone: Option<String>,
    pub country: Option<String>,
    pub email_preferences: EmailPreferences,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileRequest {
    pub theme: Option<String>,
    pub bio: Option<String>,
    pub avatar: Option<String>,
    pub profile_image: Option<String>,
    pub website: Option<String>,
    pub social_links: Option<SocialLinks>,
    pub language: Option<String>,
    pub timezone: Option<String>,
    pub country: Option<String>,
    pub email_preferences: Option<EmailPreferences>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserListResponse {
    pub users: Vec<AdminUserResponse>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

// ── E2EE Public Key DTOs ─────────────────────────────────────────────────────

/// Set the authenticated user's Curve25519 public key (base64url-encoded).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetPublicKeyRequest {
    /// Base64url-encoded Curve25519 public key (32 bytes).
    pub public_key: String,
}

/// Response carrying a user's Curve25519 public key.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyResponse {
    pub user_id: String,
    pub public_key: String,
}
