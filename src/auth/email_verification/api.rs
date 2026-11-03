//! `/api/v1/auth/email/*`: following a verification link, asking for another,
//! and where the signed-in account stands.

use std::sync::Arc;

use actix_web::{get, post, web, HttpResponse};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use super::service::{EmailVerificationService, Resend};
use crate::shared::{ApiError, AuthenticatedUser};

pub struct EmailVerificationApiState {
    pub verification: Arc<EmailVerificationService>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct VerifyEmailRequest {
    pub token: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VerifyEmailResponse {
    /// The address that is now verified.
    pub email: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RequestVerificationRequest {
    pub email: String,
}

/// Where the signed-in account's address stands.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VerificationStatusResponse {
    pub email: String,
    pub verified: bool,
    pub verified_at: Option<chrono::NaiveDateTime>,
    /// `off`, `soft` or `enforce` — how strictly this server verifies.
    pub mode: String,
    /// When sign-in will be refused if the address is still unverified. Only
    /// set while that is enforced and pending.
    pub block_at: Option<chrono::NaiveDateTime>,
}

/// Follow a verification link.
///
/// Unauthenticated: the token is the proof. Marks the account's address verified.
#[utoipa::path(
    post,
    path = "/api/v1/auth/email/verify",
    request_body = VerifyEmailRequest,
    responses(
        (status = 200, description = "The address is verified", body = VerifyEmailResponse),
        (status = 404, description = "VERIFY_NOT_FOUND"),
        (status = 410, description = "VERIFY_REVOKED, VERIFY_USED or VERIFY_EXPIRED"),
    ),
    tag = "auth"
)]
#[post("/email/verify")]
pub async fn verify_email(
    state: web::Data<EmailVerificationApiState>,
    body: web::Json<VerifyEmailRequest>,
) -> Result<web::Json<VerifyEmailResponse>, ApiError> {
    let email = state.verification.verify(&body.token)?;
    Ok(web::Json(VerifyEmailResponse { email }))
}

/// Where the signed-in account's address stands.
#[utoipa::path(
    get,
    path = "/api/v1/auth/email/verification",
    responses((status = 200, description = "Verification status", body = VerificationStatusResponse)),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/email/verification")]
pub async fn verification_status(
    state: web::Data<EmailVerificationApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<VerificationStatusResponse>, ApiError> {
    // A guest session (an open share link) has no account to verify.
    if user.user_id.starts_with("guest:") {
        return Ok(web::Json(VerificationStatusResponse {
            email: user.email.clone(),
            verified: true,
            verified_at: None,
            mode: "off".into(),
            block_at: None,
        }));
    }
    let status = state.verification.status(&user.user_id)?;
    Ok(web::Json(VerificationStatusResponse {
        email: status.email,
        verified: status.verified_at.is_some(),
        verified_at: status.verified_at,
        mode: status.mode.as_str().into(),
        block_at: status.block_at,
    }))
}

/// Email the signed-in account a new verification link.
///
/// 202 when a link is on its way, 204 when the address is already verified. At most three links
/// an hour.
#[utoipa::path(
    post,
    path = "/api/v1/auth/email/verification/resend",
    responses(
        (status = 202, description = "A new link is on its way"),
        (status = 204, description = "Already verified"),
        (status = 400, description = "Verification is off on this server"),
        (status = 429, description = "TOO_MANY_REQUESTS"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[post("/email/verification/resend")]
pub async fn resend_verification(
    state: web::Data<EmailVerificationApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    match state.verification.resend(&user.user_id)? {
        Resend::AlreadyVerified => Ok(HttpResponse::NoContent().finish()),
        Resend::Send(pending) => {
            state.verification.send(pending).await;
            Ok(HttpResponse::Accepted().finish())
        }
    }
}

/// Email a new verification link to the account at this address.
///
/// For the sign-in page, when an account past its grace period cannot sign in to ask. Always 202,
/// whether or not the address has an account, and mailed after answering, so the form cannot be
/// used to find out who has one.
#[utoipa::path(
    post,
    path = "/api/v1/auth/email/verification/request",
    request_body = RequestVerificationRequest,
    responses(
        (status = 202, description = "If the address has an unverified account, a link is on its way"),
        (status = 400, description = "No address given"),
    ),
    tag = "auth"
)]
#[post("/email/verification/request")]
pub async fn request_verification(
    state: web::Data<EmailVerificationApiState>,
    body: web::Json<RequestVerificationRequest>,
) -> Result<HttpResponse, ApiError> {
    if let Some(pending) = state.verification.request_by_email(&body.email)? {
        let verification = state.verification.clone();
        actix_web::rt::spawn(async move { verification.send(pending).await });
    }
    Ok(HttpResponse::Accepted().finish())
}

/// Registered inside the `/auth` scope by `crate::auth::api::configure`.
pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(verify_email)
        .service(verification_status)
        .service(resend_verification)
        .service(request_verification);
}

#[derive(OpenApi)]
#[openapi(
    paths(verify_email, verification_status, resend_verification, request_verification),
    components(schemas(
        VerifyEmailRequest,
        VerifyEmailResponse,
        RequestVerificationRequest,
        VerificationStatusResponse
    ))
)]
pub struct EmailVerificationApiDoc;
