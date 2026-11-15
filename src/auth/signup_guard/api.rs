//! Admin endpoints for cleaning up after a sign-up attack: where recent
//! sign-ups came from, and a bulk soft delete by IP, email domain and
//! creation window.

use actix_web::{get, post, web};
use chrono::{Duration, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, OpenApi, ToSchema};

use super::repository::{GroupCount, UserFilter};
use super::service::SignupGuard;
use crate::shared::{ApiError, AuthenticatedUser};

pub struct SignupGuardApiState {
    pub guard: Arc<SignupGuard>,
}

fn require_admin(user: &AuthenticatedUser) -> Result<(), ApiError> {
    if user.is_admin {
        Ok(())
    } else {
        Err(ApiError::forbidden("Admin access required"))
    }
}

#[derive(Deserialize, IntoParams)]
pub struct SignupSummaryQuery {
    /// How far back to look, in hours. Default 24, at most 720 (30 days).
    pub hours: Option<i64>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignupGroup {
    /// The IP address (or IPv6 /64) or email domain.
    pub key: String,
    pub total: i64,
    /// How many of them have not verified their email address.
    pub unverified: i64,
}

impl From<GroupCount> for SignupGroup {
    fn from(g: GroupCount) -> Self {
        SignupGroup { key: g.key, total: g.total, unverified: g.unverified }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignupSummaryResponse {
    pub hours: i64,
    /// Live accounts created in the window.
    pub total: i64,
    pub unverified: i64,
    /// Busiest sign-up IPs. Only accounts created since sign-up events were
    /// recorded have one.
    pub by_ip: Vec<SignupGroup>,
    /// Busiest email domains.
    pub by_domain: Vec<SignupGroup>,
}

/// Where recent sign-ups came from. Admin only.
#[utoipa::path(
    get,
    path = "/api/v1/admin/signups/summary",
    params(SignupSummaryQuery),
    responses(
        (status = 200, description = "Sign-up summary", body = SignupSummaryResponse),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[get("/admin/signups/summary")]
pub async fn signup_summary(
    state: web::Data<SignupGuardApiState>,
    user: AuthenticatedUser,
    query: web::Query<SignupSummaryQuery>,
) -> Result<web::Json<SignupSummaryResponse>, ApiError> {
    require_admin(&user)?;
    let hours = query.hours.unwrap_or(24).clamp(1, 720);
    let since = Utc::now().naive_utc() - Duration::hours(hours);
    let repo = state.guard.repo();
    let (total, unverified) = repo.created_since(since)?;
    Ok(web::Json(SignupSummaryResponse {
        hours,
        total,
        unverified,
        by_ip: repo.top_ips(since, 25)?.into_iter().map(Into::into).collect(),
        by_domain: repo.top_domains(since, 25)?.into_iter().map(Into::into).collect(),
    }))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkDeleteUsersRequest {
    /// Sign-up IP (or IPv6 /64), as the summary shows it.
    pub ip: Option<String>,
    /// Email domain, e.g. `example.com`.
    pub email_domain: Option<String>,
    /// Created at or after this instant (ISO 8601, UTC).
    pub created_after: Option<NaiveDateTime>,
    /// Created before this instant (ISO 8601, UTC).
    pub created_before: Option<NaiveDateTime>,
    /// Also delete accounts that verified their email. Default false: a bot
    /// rarely verifies, a real person caught by a broad filter often has.
    #[serde(default)]
    pub include_verified: bool,
    /// Only report what would be deleted. Default true, so deleting is always
    /// a deliberate second call.
    #[serde(default = "default_true")]
    pub dry_run: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkDeleteUser {
    pub id: String,
    pub email: String,
    pub name: String,
    pub created_at: NaiveDateTime,
    pub email_verified: bool,
    pub signup_ip: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkDeleteUsersResponse {
    pub dry_run: bool,
    /// Accounts the filter matches.
    pub matched: i64,
    /// Accounts soft-deleted by this call; 0 on a dry run.
    pub deleted: usize,
    /// Up to 100 of the matched accounts, newest first.
    pub sample: Vec<BulkDeleteUser>,
}

/// Soft-delete every account matching a filter. Admin only.
///
/// At least one of `ip`, `emailDomain` or `createdAfter` is required. Admins and the caller are
/// never matched, and only unverified accounts are unless `includeVerified` is set. A dry run (the
/// default) reports the match without changing anything. Deleted accounts lose their sessions and
/// can be restored from the user list until they are purged, like any other soft deletion.
#[utoipa::path(
    post,
    path = "/api/v1/admin/users/bulk-delete",
    request_body = BulkDeleteUsersRequest,
    responses(
        (status = 200, description = "Matched (and, unless a dry run, deleted)", body = BulkDeleteUsersResponse),
        (status = 400, description = "No narrowing filter given"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
#[post("/admin/users/bulk-delete")]
pub async fn bulk_delete_users(
    state: web::Data<SignupGuardApiState>,
    user: AuthenticatedUser,
    body: web::Json<BulkDeleteUsersRequest>,
) -> Result<web::Json<BulkDeleteUsersResponse>, ApiError> {
    require_admin(&user)?;
    let body = body.into_inner();
    let trimmed = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let filter = UserFilter {
        ip: trimmed(body.ip),
        email_domain: trimmed(body.email_domain)
            .map(|d| d.trim_start_matches('@').to_ascii_lowercase()),
        created_after: body.created_after,
        created_before: body.created_before,
        include_verified: body.include_verified,
    };
    if filter.ip.is_none() && filter.email_domain.is_none() && filter.created_after.is_none() {
        return Err(ApiError::new(
            400,
            "FILTER_REQUIRED",
            "Give at least an IP, an email domain or a start time.",
        ));
    }

    let repo = state.guard.repo();
    let (matched, rows) = repo.match_users(&filter, &user.user_id, 100)?;
    let deleted = if body.dry_run {
        0
    } else {
        let n = repo.soft_delete_matching(&filter, &user.user_id, Utc::now().naive_utc())?;
        tracing::warn!(admin = %user.user_id, deleted = n, ?filter, "bulk-deleted accounts");
        n
    };
    Ok(web::Json(BulkDeleteUsersResponse {
        dry_run: body.dry_run,
        matched,
        deleted,
        sample: rows
            .into_iter()
            .map(|r| BulkDeleteUser {
                id: r.id,
                email: r.email,
                name: r.name,
                created_at: r.created_at,
                email_verified: r.email_verified_at.is_some(),
                signup_ip: r.ip,
            })
            .collect(),
    }))
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(signup_summary).service(bulk_delete_users);
}

#[derive(OpenApi)]
#[openapi(
    paths(signup_summary, bulk_delete_users),
    components(schemas(
        SignupSummaryResponse,
        SignupGroup,
        BulkDeleteUsersRequest,
        BulkDeleteUsersResponse,
        BulkDeleteUser
    ))
)]
pub struct SignupGuardApiDoc;
