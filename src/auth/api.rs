use super::dto::{
    AdminUpdateUserRequest, AdminUserListResponse, AdminUserResponse, AuthResponse,
    EmailPreferences, LoginRequest, LoginResponse, PublicKeyResponse, PublicKeyRingResponse,
    PublicKeyVersionResponse, PublicProfileResponse,
    RefreshRequest, RegisterRequest, RegisterResponse, SessionListResponse, SessionResponse,
    SetPublicKeyRequest, SocialLinks, TwoFactorConfirmRequest, TwoFactorDisableRequest,
    TwoFactorEnrollResponse, TwoFactorStatusResponse, UpdateProfileRequest, UserLookupResponse,
    UserProfileDetailsResponse, UserProfileResponse,
};
use super::service::AuthService;

use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, put, web};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::OpenApi;

use tracing::error;

pub struct AuthApiState {
    pub auth_service: Arc<AuthService>,
    /// Used to give every new account its default folders (see `register`).
    pub filesystem_service: Arc<crate::drive::filesystem::service::FilesystemService>,
}

/// Folder that editors upload pasted, linked and locally-chosen images into, so
/// a document can reference an image by id instead of carrying its bytes. Kept
/// in step with `ATTACHMENTS_FOLDER_NAME` in `web/apps/web/src/lib/driveImages.ts`,
/// which falls back to creating it for accounts that predate this.
const ATTACHMENTS_FOLDER_NAME: &str = "Attachments";

// ── Register ──────────────────────────────────────────────────────────────────

/// Create an account with an email, name and password.
///
/// Passwords are hashed with Argon2 and must be at least eight characters. This only creates
/// the row — the client still calls `POST /auth/login` to get tokens.
#[utoipa::path(
    post,
    path = "/api/v1/auth/register",
    request_body = RegisterRequest,
    responses(
        (status = 200, description = "User registered", body = RegisterResponse),
        (status = 400, description = "Invalid request"),
        (status = 409, description = "Email already in use"),
    ),
    tag = "auth"
)]
#[post("/register")]
pub async fn register(
    state: web::Data<AuthApiState>,
    body: web::Json<RegisterRequest>,
) -> Result<web::Json<RegisterResponse>, ApiError> {
    let result = state.auth_service.register(body.into_inner());
    match result {
        Ok(response) => {
            create_default_folders(&state, &response).await;
            Ok(web::Json(response))
        }
        Err(e) => {
            error!("Error {}", e);
            Err(e)
        }
    }
}

/// Seeds a brand-new account's Drive with the folders the apps expect.
///
/// Deliberately best-effort: the account exists and is usable by the time this
/// runs, so a folder that fails to create must not turn a successful
/// registration into an error the caller sees. Clients treat the folder as
/// get-or-create anyway, which is also what covers accounts made before this.
async fn create_default_folders(state: &AuthApiState, user: &RegisterResponse) {
    // `create_folder` records ownership through the permissions service, which
    // wants the caller as an `AuthenticatedUser`; at registration there is no
    // request identity yet, so stand one up for the user just created.
    let owner = AuthenticatedUser {
        user_id: user.id.clone(),
        email: user.email.clone(),
        token: String::new(),
        is_admin: false,
    };

    let request = crate::drive::filesystem::dto::CreateFolderRequest {
        name: ATTACHMENTS_FOLDER_NAME.to_string(),
        parent_id: None,
    };

    if let Err(e) = state
        .filesystem_service
        .create_folder(&owner, request)
        .await
    {
        error!(
            "Could not create the {} folder for user {}: {}",
            ATTACHMENTS_FOLDER_NAME, user.id, e
        );
    }
}

// ── Login ─────────────────────────────────────────────────────────────────────

/// Exchange email and password for an access and refresh token pair.
///
/// When the account has TOTP enabled and no `totp_code` is supplied, the call succeeds with
/// `requiresTwoFactor: true` and no tokens; retry with the code to finish. The device name,
/// user agent and IP are recorded against the new session.
#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = LoginResponse),
        (status = 401, description = "Invalid credentials"),
    ),
    tag = "auth"
)]
#[post("/login")]
pub async fn login(
    state: web::Data<AuthApiState>,
    req: actix_web::HttpRequest,
    body: web::Json<LoginRequest>,
) -> Result<web::Json<LoginResponse>, ApiError> {
    let device_name = req
        .headers()
        .get("X-Device-Name")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let user_agent = req
        .headers()
        .get("User-Agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let ip_address = req
        .connection_info()
        .realip_remote_addr()
        .map(|s| s.to_string());

    let response =
        state
            .auth_service
            .login(body.into_inner(), device_name, user_agent, ip_address)?;
    Ok(web::Json(response))
}

// ── Refresh ───────────────────────────────────────────────────────────────────

/// Trade a refresh token for a fresh access token.
///
/// Refresh tokens are single-use: the presented token is deleted and a new one is returned
/// alongside the access token. Expired tokens are dropped and rejected with a 401.
#[utoipa::path(
    post,
    path = "/api/v1/auth/refresh",
    request_body = RefreshRequest,
    responses(
        (status = 200, description = "Token refreshed", body = AuthResponse),
        (status = 401, description = "Invalid or expired refresh token"),
    ),
    tag = "auth"
)]
#[post("/refresh")]
pub async fn refresh(
    state: web::Data<AuthApiState>,
    body: web::Json<RefreshRequest>,
) -> Result<web::Json<AuthResponse>, ApiError> {
    let response = state.auth_service.refresh(body.into_inner())?;
    Ok(web::Json(response))
}

// ── Me ────────────────────────────────────────────────────────────────────────

/// Return the signed-in user's profile.
///
/// Guest sessions — issued when someone opens a share link without an account — have no user
/// row, so they get a minimal synthetic profile with the `guest` role instead of a 401.
#[utoipa::path(
    get,
    path = "/api/v1/auth/me",
    responses(
        (status = 200, description = "Current user profile", body = UserProfileResponse),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/me")]
pub async fn me(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<UserProfileResponse>, ApiError> {
    // Guest sessions (issued when opening a share link without an account) have a
    // synthetic `guest:<token>` subject and no backing user row. Return a minimal
    // profile so the app shell renders instead of 401-redirecting them to sign-in.
    if user.user_id.starts_with("guest:") {
        return Ok(web::Json(UserProfileResponse {
            id: user.user_id.clone(),
            email: user.email.clone(),
            name: "Guest".to_string(),
            created_at: chrono::Utc::now().naive_utc(),
            role: "guest".to_string(),
            totp_enabled: false,
        }));
    }
    let profile = state.auth_service.get_profile(&user.user_id)?;
    Ok(web::Json(profile))
}

/// Delete the caller's own account.
///
/// Soft-deletes the user row so it can no longer sign in or be found, then revokes every
/// refresh token so the still-valid access token cannot mint a new session. Guest sessions
/// have no account to delete and get a 403.
#[utoipa::path(
    delete,
    path = "/api/v1/auth/me",
    responses(
        (status = 204, description = "Account deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Guest sessions have no account to delete"),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[delete("/me")]
pub async fn delete_own_account(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
) -> Result<actix_web::HttpResponse, ApiError> {
    // A guest session has a synthetic `guest:<token>` subject and no user row
    // behind it — see `me` above — so there is nothing here to delete.
    if user.user_id.starts_with("guest:") {
        return Err(ApiError::forbidden("Guest sessions have no account to delete"));
    }
    state.auth_service.delete_own_account(&user.user_id)?;
    Ok(actix_web::HttpResponse::NoContent().finish())
}

// ── User Lookup ───────────────────────────────────────────────────────────────

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SearchUsersQuery {
    pub q: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct LookupByEmailQuery {
    pub email: String,
}

/// Find a user by their exact email address.
///
/// Used when sharing, to resolve a typed address to the user ID and public key a share is
/// granted to. Returns 404 when no account matches.
#[utoipa::path(
    get,
    path = "/api/v1/auth/users/lookup",
    params(
        ("email" = String, Query, description = "Email address to look up"),
    ),
    responses(
        (status = 200, description = "User found", body = UserLookupResponse),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/users/lookup")]
pub async fn lookup_user_by_email(
    state: web::Data<AuthApiState>,
    _user: AuthenticatedUser,
    query: web::Query<LookupByEmailQuery>,
) -> Result<web::Json<UserLookupResponse>, ApiError> {
    match state.auth_service.lookup_user_by_email(&query.email)? {
        Some(u) => Ok(web::Json(u)),
        None => Err(ApiError::not_found("User not found")),
    }
}

/// Search users by partial email or name.
///
/// Case-insensitive substring match against both fields, for recipient pickers that resolve
/// a half-typed name to a user ID. Returns the matches as a plain list.
#[utoipa::path(
    get,
    path = "/api/v1/auth/users/search",
    params(
        ("q" = String, Query, description = "Search query (matches email or name)"),
    ),
    responses(
        (status = 200, description = "Matching users", body = Vec<UserLookupResponse>),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/users/search")]
pub async fn search_users(
    state: web::Data<AuthApiState>,
    _user: AuthenticatedUser,
    query: web::Query<SearchUsersQuery>,
) -> Result<web::Json<Vec<UserLookupResponse>>, ApiError> {
    let q = query.q.trim();
    if q.is_empty() {
        return Ok(web::Json(vec![]));
    }
    let results = state.auth_service.search_users(q)?;
    Ok(web::Json(results))
}

/// Look up a single user by ID.
///
/// Returns the same minimal record as the email lookup, for resolving IDs stored on shares,
/// comments and activity entries into something displayable.
#[utoipa::path(
    get,
    path = "/api/v1/auth/users/{user_id}",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "User found", body = UserLookupResponse),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/users/{user_id}")]
pub async fn get_user_by_id(
    state: web::Data<AuthApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<UserLookupResponse>, ApiError> {
    let user_id = path.into_inner();
    match state.auth_service.get_user_by_id(&user_id)? {
        Some(u) => Ok(web::Json(u)),
        None => Err(ApiError::not_found("User not found")),
    }
}

/// Fetch another user's public profile.
///
/// Returns only the fields safe to show any signed-in user — name, bio, avatar, website,
/// social links, language and country. Email preferences and private fields are omitted.
#[utoipa::path(
    get,
    path = "/api/v1/auth/users/{user_id}/profile",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "Public user profile", body = PublicProfileResponse),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/users/{user_id}/profile")]
pub async fn get_user_public_profile(
    state: web::Data<AuthApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<PublicProfileResponse>, ApiError> {
    let user_id = path.into_inner();
    let profile = state.auth_service.get_public_profile(&user_id)?;
    Ok(web::Json(profile))
}

// ── 2FA ───────────────────────────────────────────────────────────────────────

/// Report whether TOTP two-factor is enabled for the caller.
///
/// A cheap check the settings screen uses to decide between offering enrollment and offering
/// to disable.
#[utoipa::path(
    get,
    path = "/api/v1/auth/2fa/status",
    responses(
        (status = 200, description = "2FA status", body = TwoFactorStatusResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/2fa/status")]
pub async fn two_factor_status(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<TwoFactorStatusResponse>, ApiError> {
    let status = state.auth_service.get_two_factor_status(&user.user_id)?;
    Ok(web::Json(status))
}

/// Begin TOTP enrollment.
///
/// Generates a secret, returns its `otpauth://` URI for the authenticator app to scan, and
/// issues ten single-use backup codes. Two-factor is not active until the code is confirmed.
#[utoipa::path(
    post,
    path = "/api/v1/auth/2fa/enroll",
    responses(
        (status = 200, description = "2FA enrollment initiated", body = TwoFactorEnrollResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[post("/2fa/enroll")]
pub async fn two_factor_enroll(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<TwoFactorEnrollResponse>, ApiError> {
    let result = state
        .auth_service
        .enroll_two_factor(&user.user_id, &user.email)?;
    Ok(web::Json(result))
}

/// Finish TOTP enrollment by verifying a code.
///
/// Checks the supplied code against the secret minted at enrollment and, if it matches,
/// switches two-factor on for the account.
#[utoipa::path(
    post,
    path = "/api/v1/auth/2fa/confirm",
    request_body = TwoFactorConfirmRequest,
    responses(
        (status = 200, description = "2FA confirmed and enabled", body = TwoFactorStatusResponse),
        (status = 400, description = "Invalid TOTP code"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[post("/2fa/confirm")]
pub async fn two_factor_confirm(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    body: web::Json<TwoFactorConfirmRequest>,
) -> Result<web::Json<TwoFactorStatusResponse>, ApiError> {
    state
        .auth_service
        .confirm_two_factor(&user.user_id, &body.code)?;
    Ok(web::Json(TwoFactorStatusResponse { enabled: true }))
}

/// Turn off TOTP two-factor for the caller.
///
/// Requires the account password as well as a current code, and clears the stored secret and
/// backup codes.
#[utoipa::path(
    post,
    path = "/api/v1/auth/2fa/disable",
    request_body = TwoFactorDisableRequest,
    responses(
        (status = 200, description = "2FA disabled", body = TwoFactorStatusResponse),
        (status = 400, description = "Invalid password or TOTP code"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[post("/2fa/disable")]
pub async fn two_factor_disable(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    body: web::Json<TwoFactorDisableRequest>,
) -> Result<web::Json<TwoFactorStatusResponse>, ApiError> {
    state
        .auth_service
        .disable_two_factor(&user.user_id, body.into_inner())?;
    Ok(web::Json(TwoFactorStatusResponse { enabled: false }))
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/// List the caller's active sessions.
///
/// Each entry is a live refresh token with the device name, user agent, IP and last-used time
/// recorded at login.
#[utoipa::path(
    get,
    path = "/api/v1/auth/sessions",
    responses(
        (status = 200, description = "List of active sessions", body = SessionListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/sessions")]
pub async fn list_sessions(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<SessionListResponse>, ApiError> {
    let result = state.auth_service.list_sessions(&user.user_id)?;
    Ok(web::Json(result))
}

/// Revoke a single session.
///
/// Deletes that session's refresh token, so the device cannot renew once its access token
/// expires.
#[utoipa::path(
    delete,
    path = "/api/v1/auth/sessions/{session_id}",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 204, description = "Session revoked"),
        (status = 404, description = "Session not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[delete("/sessions/{session_id}")]
pub async fn revoke_session(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<actix_web::HttpResponse, ApiError> {
    let session_id = path.into_inner();
    state
        .auth_service
        .revoke_session(&user.user_id, &session_id)?;
    Ok(actix_web::HttpResponse::NoContent().finish())
}

/// Revoke every session for the caller.
///
/// Drops all refresh tokens, including the one belonging to the calling device — the sign out
/// everywhere action.
#[utoipa::path(
    delete,
    path = "/api/v1/auth/sessions",
    responses(
        (status = 204, description = "All sessions revoked"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[delete("/sessions")]
pub async fn revoke_all_sessions(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
) -> Result<actix_web::HttpResponse, ApiError> {
    state.auth_service.revoke_all_sessions(&user.user_id)?;
    Ok(actix_web::HttpResponse::NoContent().finish())
}

// ── Admin ─────────────────────────────────────────────────────────────────────

fn require_admin(user: &AuthenticatedUser) -> Result<(), ApiError> {
    if !user.is_admin {
        Err(ApiError::forbidden("Admin access required"))
    } else {
        Ok(())
    }
}

/// Query for the admin user listing.
///
/// camelCase to match the only client there is: `adminApi.listUsers` has always
/// sent `pageSize`, which under the previous snake_case naming serde simply
/// dropped — harmless while the value it sent equalled the default, and a
/// silently ignored parameter the moment it did not.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    /// Include soft-deleted accounts, which every other listing hides. The
    /// admin console sets this for its "show deleted" view, where restoring
    /// them is the point.
    pub include_deleted: Option<bool>,
}

/// List all accounts, paginated. Admin only.
///
/// Page size is clamped to 100. Pass `includeDeleted` to also return soft-deleted accounts
/// along with the date they will be purged.
#[utoipa::path(
    get,
    path = "/api/v1/admin/users",
    params(
        ("page" = Option<i64>, Query, description = "Page number (1-based)"),
        ("pageSize" = Option<i64>, Query, description = "Items per page"),
        ("includeDeleted" = Option<bool>, Query, description = "Include soft-deleted accounts"),
    ),
    responses(
        (status = 200, description = "List of users", body = AdminUserListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/admin/users")]
pub async fn admin_list_users(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    query: web::Query<AdminListQuery>,
) -> Result<web::Json<AdminUserListResponse>, ApiError> {
    require_admin(&user)?;
    let result = state.auth_service.admin_list_users(
        query.page.unwrap_or(1),
        query.page_size.unwrap_or(20),
        query.include_deleted.unwrap_or(false),
    )?;
    Ok(web::Json(result))
}

/// Fetch one account's admin view. Admin only.
///
/// Includes the fields hidden from the public profile — role, two-factor state, and deletion
/// and purge timestamps.
#[utoipa::path(
    get,
    path = "/api/v1/admin/users/{user_id}",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "User details", body = AdminUserResponse),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/admin/users/{user_id}")]
pub async fn admin_get_user(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<AdminUserResponse>, ApiError> {
    require_admin(&user)?;
    let target_id = path.into_inner();
    let result = state.auth_service.admin_get_user(&target_id)?;
    Ok(web::Json(result))
}

/// Change an account's role or force two-factor off. Admin only.
///
/// The role must be `user` or `admin`. Setting `totpEnabled` to false clears the stored TOTP
/// secret, which is the recovery path for a user who has lost their authenticator.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/users/{user_id}",
    params(("user_id" = String, Path, description = "User ID")),
    request_body = AdminUpdateUserRequest,
    responses(
        (status = 200, description = "User updated", body = AdminUserResponse),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[patch("/admin/users/{user_id}")]
pub async fn admin_update_user(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<AdminUpdateUserRequest>,
) -> Result<web::Json<AdminUserResponse>, ApiError> {
    require_admin(&user)?;
    let target_id = path.into_inner();
    let result = state
        .auth_service
        .admin_update_user(&target_id, body.into_inner())?;
    Ok(web::Json(result))
}

/// Soft-delete an account. Admin only.
///
/// Leaves the user in the same state as self-serve deletion — invisible to every lookup, with
/// all refresh tokens revoked — and starts the purge clock rather than erasing rows outright.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/users/{user_id}",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 204, description = "User deleted"),
        (status = 404, description = "User not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[delete("/admin/users/{user_id}")]
pub async fn admin_delete_user(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<actix_web::HttpResponse, ApiError> {
    require_admin(&user)?;
    let target_id = path.into_inner();
    state.auth_service.admin_delete_user(&target_id)?;
    Ok(actix_web::HttpResponse::NoContent().finish())
}

/// Undo a soft deletion. Admin only.
///
/// Works only while the account is still inside its purge window; restoring an account that
/// is not deleted returns 400 and one already purged returns 404.
#[utoipa::path(
    post,
    path = "/api/v1/admin/users/{user_id}/restore",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "User restored", body = AdminUserResponse),
        (status = 400, description = "User is not deleted"),
        (status = 404, description = "User not found, or already purged"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[post("/admin/users/{user_id}/restore")]
pub async fn admin_restore_user(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<AdminUserResponse>, ApiError> {
    require_admin(&user)?;
    let target_id = path.into_inner();
    let result = state.auth_service.admin_restore_user(&target_id)?;
    Ok(web::Json(result))
}

// ── Extended Profile ──────────────────────────────────────────────────────────

/// Fetch the caller's extended profile.
///
/// Covers the fields `/auth/me` leaves out — theme, bio, avatar, website, social links,
/// language, timezone, country and email preferences.
#[utoipa::path(
    get,
    path = "/api/v1/auth/profile",
    responses(
        (status = 200, description = "Extended profile details", body = UserProfileDetailsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/profile")]
pub async fn get_profile_details(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<UserProfileDetailsResponse>, ApiError> {
    let profile = state.auth_service.get_extended_profile(&user.user_id)?;
    Ok(web::Json(profile))
}

/// Update the caller's extended profile.
///
/// Every field is optional; only the ones supplied are written. Returns the full profile as
/// stored.
#[utoipa::path(
    put,
    path = "/api/v1/auth/profile",
    request_body = UpdateProfileRequest,
    responses(
        (status = 200, description = "Profile updated", body = UserProfileDetailsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[put("/profile")]
pub async fn update_profile_details(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    body: web::Json<UpdateProfileRequest>,
) -> Result<web::Json<UserProfileDetailsResponse>, ApiError> {
    let profile = state
        .auth_service
        .update_extended_profile(&user.user_id, body.into_inner())?;
    Ok(web::Json(profile))
}

// ── E2EE Public Key ───────────────────────────────────────────────────────────

/// Publish the authenticated user's Curve25519 public key as a new version.
///
/// Append-only. Publishing a key that differs from the active one retires that
/// one and mints the next version; publishing the active key again returns it
/// unchanged. Nothing is ever overwritten, because `file_key_refs.key_version`
/// refers to these versions by number.
#[utoipa::path(
    post,
    path = "/api/v1/auth/keys",
    request_body = SetPublicKeyRequest,
    responses(
        (status = 200, description = "Public key published", body = PublicKeyResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[post("/keys")]
pub async fn set_public_key(
    state: web::Data<AuthApiState>,
    user: AuthenticatedUser,
    body: web::Json<SetPublicKeyRequest>,
) -> Result<web::Json<PublicKeyResponse>, ApiError> {
    let pk = body.into_inner().public_key;
    if pk.is_empty() {
        return Err(ApiError::bad_request("public_key cannot be empty"));
    }
    let published = state.auth_service.publish_public_key(&user.user_id, &pk)?;
    Ok(web::Json(PublicKeyResponse {
        user_id: user.user_id,
        public_key: published.public_key,
        version: published.version,
    }))
}

/// Fetch any user's *active* Curve25519 public key (needed for sharing).
///
/// This is what a client seals a new DEK to. To open a file sealed to a key the
/// owner has since rotated away from, read the whole keyring instead.
#[utoipa::path(
    get,
    path = "/api/v1/auth/users/{user_id}/public-key",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "User public key", body = PublicKeyResponse),
        (status = 404, description = "No public key registered"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/users/{user_id}/public-key")]
pub async fn get_user_public_key(
    state: web::Data<AuthApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<PublicKeyResponse>, ApiError> {
    let target_id = path.into_inner();
    let keys = state.auth_service.list_public_keys(&target_id)?;
    let active = keys
        .into_iter()
        .find(|k| k.retired_at.is_none())
        .ok_or_else(|| ApiError::not_found("No public key registered for this user"))?;

    Ok(web::Json(PublicKeyResponse {
        user_id: target_id,
        public_key: active.public_key,
        version: active.version,
    }))
}

/// Fetch any user's full identity keyring, oldest version first.
///
/// A rotated key is retired, never deleted: files sealed to it stay readable,
/// and `file_key_refs.key_version` is what says which one a given file wants.
#[utoipa::path(
    get,
    path = "/api/v1/auth/users/{user_id}/public-keys",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "The user's published key versions", body = PublicKeyRingResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/users/{user_id}/public-keys")]
pub async fn get_user_public_keys(
    state: web::Data<AuthApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<PublicKeyRingResponse>, ApiError> {
    let target_id = path.into_inner();
    let keys = state.auth_service.list_public_keys(&target_id)?;

    let active_version = keys.iter().find(|k| k.retired_at.is_none()).map(|k| k.version);

    Ok(web::Json(PublicKeyRingResponse {
        user_id: target_id,
        keys: keys
            .into_iter()
            .map(|k| PublicKeyVersionResponse {
                version: k.version,
                public_key: k.public_key,
                created_at: k.created_at.and_utc().to_rfc3339(),
                retired_at: k.retired_at.map(|t| t.and_utc().to_rfc3339()),
            })
            .collect(),
        active_version,
    }))
}

// ── Route Configuration ───────────────────────────────────────────────────────

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(
        web::scope("/auth")
            .service(register)
            .service(login)
            .service(refresh)
            .service(me)
            .service(delete_own_account)
            .service(get_profile_details)
            .service(update_profile_details)
            .service(lookup_user_by_email)
            .service(search_users)
            .service(get_user_by_id)
            .service(get_user_public_profile)
            .service(two_factor_status)
            .service(two_factor_enroll)
            .service(two_factor_confirm)
            .service(two_factor_disable)
            .service(list_sessions)
            .service(revoke_session)
            .service(revoke_all_sessions)
            .service(set_public_key)
            .service(get_user_public_key)
            .service(get_user_public_keys)
            // Wrapped identity-key storage — /auth/keyvault*
            .configure(crate::auth::keyvault::api::configure),
    )
    .service(admin_list_users)
    .service(admin_get_user)
    .service(admin_update_user)
    .service(admin_delete_user)
    .service(admin_restore_user);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        register,
        login,
        refresh,
        me,
        delete_own_account,
        lookup_user_by_email,
        search_users,
        get_user_by_id,
        get_user_public_profile,
        two_factor_status,
        two_factor_enroll,
        two_factor_confirm,
        two_factor_disable,
        list_sessions,
        revoke_session,
        revoke_all_sessions,
        get_profile_details,
        update_profile_details,
        set_public_key,
        get_user_public_key,
        get_user_public_keys,
        admin_list_users,
        admin_get_user,
        admin_update_user,
        admin_delete_user,
        admin_restore_user,
    ),
    components(schemas(
        RegisterRequest,
        LoginRequest,
        RefreshRequest,
        AuthResponse,
        LoginResponse,
        RegisterResponse,
        UserProfileResponse,
        UserLookupResponse,
        PublicProfileResponse,
        SocialLinks,
        TwoFactorStatusResponse,
        TwoFactorEnrollResponse,
        TwoFactorConfirmRequest,
        TwoFactorDisableRequest,
        SessionResponse,
        SessionListResponse,
        AdminUserResponse,
        AdminUserListResponse,
        AdminUpdateUserRequest,
        UserProfileDetailsResponse,
        UpdateProfileRequest,
        EmailPreferences,
        SetPublicKeyRequest,
        PublicKeyResponse,
        PublicKeyVersionResponse,
        PublicKeyRingResponse,
        LookupByEmailQuery,
        AdminListQuery,
    )),
    tags((
        name = "auth",
        description = "Accounts and sessions: registration, password login with optional TOTP two-factor, refresh-token rotation, profile reads and writes, and per-device session management. It also serves the append-only Curve25519 public keyring that end-to-end encryption seals file keys to, and the admin-only user console endpoints under /api/v1/admin/users."
    )),
    security(("bearer_auth" = []))
)]
pub struct AuthApiDoc;
