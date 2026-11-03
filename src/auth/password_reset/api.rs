//! `/api/v1/auth/password/forgot` and `/api/v1/auth/password/reset*`: asking
//! for a reset link, checking one, and setting a password with it. All three
//! are unauthenticated — the user has no password to sign in with.

use std::sync::Arc;

use actix_web::{post, web, HttpResponse};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use super::service::PasswordResetService;
use crate::shared::ApiError;

pub struct PasswordResetApiState {
    pub resets: Arc<PasswordResetService>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CheckResetRequest {
    pub token: String,
}

/// What the reset page needs before it asks for a password.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckResetResponse {
    /// The account's address.
    pub email: String,
    /// The account has two-factor on, so the reset needs a code.
    pub requires_two_factor: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
    /// Required when the account has two-factor enabled.
    pub totp_code: Option<String>,
}

/// Email a password reset link to the account at this address.
///
/// Always 202, whether or not the address has an account, so the form cannot be used to find out
/// who has one. The link works once and expires in an hour; asking again replaces it. An account
/// is sent at most three links an hour, and a disabled account none.
#[utoipa::path(
    post,
    path = "/api/v1/auth/password/forgot",
    request_body = ForgotPasswordRequest,
    responses(
        (status = 202, description = "If the address has an account, a reset link is on its way"),
        (status = 400, description = "No address given"),
    ),
    tag = "auth"
)]
#[post("/password/forgot")]
pub async fn forgot_password(
    state: web::Data<PasswordResetApiState>,
    body: web::Json<ForgotPasswordRequest>,
) -> Result<HttpResponse, ApiError> {
    if let Some(pending) = state.resets.create(&body.email)? {
        // Sent after answering, so how long the mail server takes cannot tell
        // an address with an account from one without.
        let resets = state.resets.clone();
        actix_web::rt::spawn(async move { resets.send(pending).await });
    }
    Ok(HttpResponse::Accepted().finish())
}

/// Check a reset link before asking for a new password.
#[utoipa::path(
    post,
    path = "/api/v1/auth/password/reset/check",
    request_body = CheckResetRequest,
    responses(
        (status = 200, description = "The link can be used", body = CheckResetResponse),
        (status = 403, description = "ACCOUNT_DISABLED"),
        (status = 404, description = "RESET_NOT_FOUND"),
        (status = 410, description = "RESET_REVOKED, RESET_USED or RESET_EXPIRED"),
    ),
    tag = "auth"
)]
#[post("/password/reset/check")]
pub async fn check_reset(
    state: web::Data<PasswordResetApiState>,
    body: web::Json<CheckResetRequest>,
) -> Result<web::Json<CheckResetResponse>, ApiError> {
    let check = state.resets.check(&body.token)?;
    Ok(web::Json(CheckResetResponse {
        email: check.email,
        requires_two_factor: check.requires_two_factor,
    }))
}

/// Set a new password with a reset link.
///
/// The password is checked against the workspace policy before the link is spent, so a refused
/// one can be retried with the same link. Succeeding clears a forced expiry and a failed-sign-in
/// lockout, signs every device out, revokes any other reset link and emails the owner that the
/// password changed. Encryption keys are unaffected.
#[utoipa::path(
    post,
    path = "/api/v1/auth/password/reset",
    request_body = ResetPasswordRequest,
    responses(
        (status = 204, description = "Password reset; sign in with it"),
        (status = 400, description = "The password breaks the workspace policy, or matches the current one"),
        (status = 401, description = "Missing or invalid two-factor code"),
        (status = 403, description = "ACCOUNT_DISABLED"),
        (status = 404, description = "RESET_NOT_FOUND"),
        (status = 410, description = "RESET_REVOKED, RESET_USED or RESET_EXPIRED"),
    ),
    tag = "auth"
)]
#[post("/password/reset")]
pub async fn reset_password(
    state: web::Data<PasswordResetApiState>,
    body: web::Json<ResetPasswordRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let user = state
        .resets
        .reset(&body.token, &body.new_password, body.totp_code.as_deref())?;
    state.resets.send_changed_notice(&user).await;
    Ok(HttpResponse::NoContent().finish())
}

/// Registered inside the `/auth` scope by `crate::auth::api::configure`: a
/// second `/auth` scope would never be reached.
pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(forgot_password)
        .service(check_reset)
        .service(reset_password);
}

#[derive(OpenApi)]
#[openapi(
    paths(forgot_password, check_reset, reset_password),
    components(schemas(
        ForgotPasswordRequest,
        CheckResetRequest,
        CheckResetResponse,
        ResetPasswordRequest
    ))
)]
pub struct PasswordResetApiDoc;
