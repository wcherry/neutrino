//! `/api/v1/invites`: the caller's personal link and emailed invites, and the
//! public check the register page runs on a token.

use std::sync::Arc;

use actix_web::{delete, get, post, web, HttpResponse};
use chrono::{NaiveDateTime, SecondsFormat, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use super::model::InviteRecord;
use super::service::{InviteService, InviteStatus, PersonalLink};
use crate::shared::{ApiError, AuthenticatedUser};

pub struct InvitesApiState {
    pub invites: Arc<InviteService>,
}

/// RFC 3339, UTC, `Z`-suffixed.
fn rfc3339(t: NaiveDateTime) -> String {
    Utc.from_utc_datetime(&t)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// One emailed invite as its sender sees it.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InviteDto {
    pub id: String,
    /// The invited address.
    pub email: String,
    /// `pending`, `accepted`, `expired` or `revoked`.
    #[schema(value_type = String)]
    pub status: InviteStatus,
    pub created_at: String,
    pub expires_at: String,
    pub accepted_at: Option<String>,
}

impl InviteDto {
    fn from_record(r: &InviteRecord, now: NaiveDateTime) -> Self {
        InviteDto {
            id: r.id.clone(),
            email: r.invitee_email.clone().unwrap_or_default(),
            status: r.status(now),
            created_at: rfc3339(r.created_at),
            expires_at: rfc3339(r.expires_at),
            accepted_at: r.accepted_at.map(rfc3339),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct InviteListResponse {
    pub invites: Vec<InviteDto>,
}

fn list_response(rows: &[InviteRecord]) -> InviteListResponse {
    let now = Utc::now().naive_utc();
    InviteListResponse {
        invites: rows
            .iter()
            .map(|r| InviteDto::from_record(r, now))
            .collect(),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SendInvitesRequest {
    pub emails: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// The caller's reusable invite link.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonalInviteLinkDto {
    pub token: String,
    /// `{DRIVE_URL}/register?invite={token}`.
    pub url: String,
    pub expires_at: String,
    pub use_count: i32,
}

impl PersonalInviteLinkDto {
    fn new(link: PersonalLink, svc: &InviteService) -> Self {
        PersonalInviteLinkDto {
            url: svc.invite_url(&link.token),
            token: link.token,
            expires_at: rfc3339(link.expires_at),
            use_count: link.use_count,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ValidateInviteRequest {
    pub token: String,
}

/// Who sent a token, for the register page.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InviteValidationDto {
    /// `email` or `link`.
    pub kind: String,
    pub inviter_name: String,
    /// The invited address, to pre-fill; emailed invites only.
    pub email: Option<String>,
    pub expires_at: String,
}

/// List the caller's emailed invites with their status, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/invites",
    responses((status = 200, description = "Invites sent", body = InviteListResponse)),
    security(("bearer_auth" = [])),
    tag = "invites"
)]
#[get("")]
pub async fn list_invites(
    state: web::Data<InvitesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<InviteListResponse>, ApiError> {
    let rows = state.invites.list_mine(&user.user_id)?;
    Ok(web::Json(list_response(&rows)))
}

/// Email invitations to up to 20 addresses, with an optional note.
///
/// Each invite works once and expires after 14 days. At most 20 emailed invites per user per
/// rolling 24 hours. Re-inviting an address with a pending invite revokes the old one.
#[utoipa::path(
    post,
    path = "/api/v1/invites",
    request_body = SendInvitesRequest,
    responses(
        (status = 201, description = "Invites created and sent", body = InviteListResponse),
        (status = 400, description = "INVALID_EMAIL or NOTE_TOO_LONG"),
        (status = 429, description = "INVITE_LIMIT_EXCEEDED"),
    ),
    security(("bearer_auth" = [])),
    tag = "invites"
)]
#[post("")]
pub async fn send_invites(
    state: web::Data<InvitesApiState>,
    user: AuthenticatedUser,
    body: web::Json<SendInvitesRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let rows = state
        .invites
        .send_email_invites(&user.user_id, &body.emails, body.note.as_deref())
        .await?;
    Ok(HttpResponse::Created().json(list_response(&rows)))
}

/// Revoke one of the caller's pending invites.
#[utoipa::path(
    delete,
    path = "/api/v1/invites/{id}",
    params(("id" = String, Path, description = "Invite id")),
    responses(
        (status = 204, description = "Revoked"),
        (status = 404, description = "INVITE_NOT_FOUND"),
        (status = 409, description = "INVITE_USED"),
    ),
    security(("bearer_auth" = [])),
    tag = "invites"
)]
#[delete("/{id}")]
pub async fn revoke_invite(
    state: web::Data<InvitesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.invites.revoke(&user.user_id, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// The caller's personal invite link, minted when none is live.
#[utoipa::path(
    get,
    path = "/api/v1/invites/link",
    responses((status = 200, description = "Personal link", body = PersonalInviteLinkDto)),
    security(("bearer_auth" = [])),
    tag = "invites"
)]
#[get("/link")]
pub async fn get_link(
    state: web::Data<InvitesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<PersonalInviteLinkDto>, ApiError> {
    let link = state.invites.personal_link(&user.user_id)?;
    Ok(web::Json(PersonalInviteLinkDto::new(link, &state.invites)))
}

/// Kill the caller's personal link and mint a new one.
#[utoipa::path(
    post,
    path = "/api/v1/invites/link/reset",
    responses((status = 200, description = "New personal link", body = PersonalInviteLinkDto)),
    security(("bearer_auth" = [])),
    tag = "invites"
)]
#[post("/link/reset")]
pub async fn reset_link(
    state: web::Data<InvitesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<PersonalInviteLinkDto>, ApiError> {
    let link = state.invites.reset_personal_link(&user.user_id)?;
    Ok(web::Json(PersonalInviteLinkDto::new(link, &state.invites)))
}

/// Check an invite token without spending it. Public.
#[utoipa::path(
    post,
    path = "/api/v1/invites/validate",
    request_body = ValidateInviteRequest,
    responses(
        (status = 200, description = "Valid invite", body = InviteValidationDto),
        (status = 404, description = "INVITE_NOT_FOUND"),
        (status = 410, description = "INVITE_REVOKED, INVITE_USED or INVITE_EXPIRED"),
    ),
    tag = "invites"
)]
#[post("/validate")]
pub async fn validate_invite(
    state: web::Data<InvitesApiState>,
    body: web::Json<ValidateInviteRequest>,
) -> Result<web::Json<InviteValidationDto>, ApiError> {
    let v = state.invites.validate(&body.token)?;
    Ok(web::Json(InviteValidationDto {
        kind: v.record.kind,
        inviter_name: v.inviter_name,
        email: v.record.invitee_email,
        expires_at: rfc3339(v.record.expires_at),
    }))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/invites")
            // Literal paths ahead of `/{id}`.
            .service(get_link)
            .service(reset_link)
            .service(validate_invite)
            .service(list_invites)
            .service(send_invites)
            .service(revoke_invite),
    );
}

#[derive(OpenApi)]
#[openapi(
    paths(list_invites, send_invites, revoke_invite, get_link, reset_link, validate_invite),
    components(schemas(
        InviteDto,
        InviteListResponse,
        SendInvitesRequest,
        PersonalInviteLinkDto,
        ValidateInviteRequest,
        InviteValidationDto,
    )),
    tags((
        name = "invites",
        description = "Friend invites: a reusable personal link and single-use emailed invitations, each expiring after 14 days, which let someone sign up even when the server's public sign-up is closed. POST /api/v1/invites/validate is public; the register page uses it to say who sent a token."
    )),
    security(("bearer_auth" = []))
)]
pub struct InvitesApiDoc;
