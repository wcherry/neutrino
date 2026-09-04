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
    /// When the background worker becomes free to erase this account for good.
    /// `None` for a live account. Sent so the console's countdown reads the
    /// retention policy off the server instead of hard-coding 30 days again.
    pub purge_after: Option<chrono::NaiveDateTime>,
    /// When an admin locked the account out. `None` for a live account.
    pub disabled_at: Option<chrono::NaiveDateTime>,
    /// When the password was last set. `None` for an account that predates the
    /// column and has not changed it since.
    pub password_changed_at: Option<chrono::NaiveDateTime>,
    /// Whether sign-in currently refuses this account's password — either an
    /// admin forced it to expire or the policy's maximum age has passed.
    /// Computed, so the console does not have to know both rules.
    pub password_expired: bool,
    /// When this password expires under the policy's maximum age. `None` when
    /// the policy has no maximum age, or the password's age is unknown.
    pub password_expires_at: Option<chrono::NaiveDateTime>,
    /// When the account locked itself after the policy's run of failed
    /// sign-ins. `None` normally. Reported separately from `disabled_at` so the
    /// console can tell a lockout a counter applied from one an admin decided.
    pub locked_out_at: Option<chrono::NaiveDateTime>,
    /// Consecutive failed sign-ins so far. Shown against the policy's threshold
    /// so an admin can see an account being worked on before it locks.
    pub failed_login_attempts: i32,
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

/// Every field optional: the console sends only what changed.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminUpdateUserRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    /// Only `false` does anything — an admin can force two-factor off for a
    /// user who has lost their authenticator, but cannot enrol one for them.
    pub totp_enabled: Option<bool>,
    /// Lock the account out (`true`) or let it back in (`false`). Disabling
    /// also revokes every refresh token the account holds.
    pub disabled: Option<bool>,
    /// Force the password to expire (`true`), or withdraw a forced expiry
    /// (`false`). A password already past the policy's maximum age stays
    /// expired either way.
    pub expire_password: Option<bool>,
    /// Set a new password on the user's behalf — the recovery path for a
    /// forgotten one. Checked against the password policy, and revokes every
    /// session, since whoever knew the old password may not be the owner.
    pub password: Option<String>,
    /// Release an account the failed-sign-in threshold locked, clearing the
    /// count with it. Only `true` does anything: a lockout is applied by the
    /// counter reaching the threshold, never by an admin asking for one — that
    /// is what `disabled` is for.
    pub unlock: Option<bool>,
}

/// Create a fully registered account from the admin console.
///
/// The same thing self-serve registration produces — a live account with a
/// password it can sign in with and the default folders every account gets —
/// rather than an invitation to be completed later.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminCreateUserRequest {
    pub email: String,
    pub name: String,
    pub password: String,
    /// `user` or `admin`. Defaults to `user`.
    pub role: Option<String>,
    /// Expire the password immediately, so the account must choose its own
    /// before it can sign in. Defaults to false.
    pub require_password_change: Option<bool>,
}

/// Change a password by proving knowledge of the current one.
///
/// Deliberately unauthenticated: this is the way out of a `PASSWORD_EXPIRED`
/// sign-in, and an expired password gets no tokens to authenticate with. The
/// proof is the same one sign-in takes, two-factor included.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub email: String,
    pub current_password: String,
    pub new_password: String,
    /// Required when the account has two-factor enabled, exactly as at sign-in.
    pub totp_code: Option<String>,
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
    /// Display name. Lives on the user row rather than the profile row, so it is
    /// written separately — but it is edited on the same screen as everything
    /// else here, and a second endpoint for one field bought nothing.
    pub name: Option<String>,
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

/// Response carrying a user's *active* Curve25519 public key.
///
/// `version` says which entry of their keyring this is, so a client sealing a
/// DEK can record it on the key ref and know which secret key opens it later.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyResponse {
    pub user_id: String,
    pub public_key: String,
    pub version: i32,
}

/// One published version of a user's identity key.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyVersionResponse {
    pub version: i32,
    pub public_key: String,
    pub created_at: String,
    /// Null for the active version.
    pub retired_at: Option<String>,
}

/// A user's whole keyring, for a client that must open files sealed to a key
/// they have since rotated away from.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyRingResponse {
    pub user_id: String,
    /// Oldest first.
    pub keys: Vec<PublicKeyVersionResponse>,
    /// The version new work should be sealed to. Absent if none published.
    pub active_version: Option<i32>,
}
