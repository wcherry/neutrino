use actix_web::{get, post, put, web, HttpResponse};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::OpenApi;

use super::model::QuotaRequestRecord;
use super::repository::{QuotaRequestWithUser, QuotaRequestsRepository};
use super::{MAX_REQUESTABLE_BYTES, STATUS_APPROVED, STATUS_DENIED, STATUS_PENDING};
use crate::drive::storage::service::StorageService;
use crate::shared::{AdminUser, ApiError, AuthenticatedUser};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct QuotaRequestsState {
    pub repo: Arc<QuotaRequestsRepository>,
    /// Approving a request writes the new limit, and the admin quota routes
    /// below read and write it directly. The storage service owns that column,
    /// so this module borrows it rather than keeping a second way to set a
    /// quota.
    pub storage_service: Arc<StorageService>,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuotaRequestDto {
    pub id: String,
    pub user_id: String,
    /// The new total limit asked for, in bytes.
    pub requested_bytes: i64,
    pub reason: Option<String>,
    /// `pending`, `approved` or `denied`.
    pub status: String,
    /// What was actually granted, which may be less than was asked for.
    pub granted_bytes: Option<i64>,
    pub decision_note: Option<String>,
    pub decided_at: Option<String>,
    pub created_at: String,
    /// Present on the admin queue only — a user reading their own requests
    /// already knows who they are.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
}

impl From<QuotaRequestRecord> for QuotaRequestDto {
    fn from(r: QuotaRequestRecord) -> Self {
        QuotaRequestDto {
            id: r.id,
            user_id: r.user_id,
            requested_bytes: r.requested_bytes,
            reason: r.reason,
            status: r.status,
            granted_bytes: r.granted_bytes,
            decision_note: r.decision_note,
            decided_at: r.decided_at.map(|t| t.and_utc().to_rfc3339()),
            created_at: r.created_at.and_utc().to_rfc3339(),
            user_email: None,
            user_name: None,
        }
    }
}

impl From<QuotaRequestWithUser> for QuotaRequestDto {
    fn from(r: QuotaRequestWithUser) -> Self {
        QuotaRequestDto {
            user_email: Some(r.user_email),
            user_name: Some(r.user_name),
            ..QuotaRequestDto::from(r.request)
        }
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateQuotaRequestRequest {
    /// The new total limit being asked for, in bytes — not an increment.
    pub requested_bytes: i64,
    /// Free text shown to the admin reviewing the queue.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApproveQuotaRequestRequest {
    /// The limit to actually grant. Omitted, the request is granted in full.
    pub granted_bytes: Option<i64>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DenyQuotaRequestRequest {
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct QueueQuery {
    /// `pending` (the default), `approved`, `denied`, or `all`.
    pub status: Option<String>,
}

/// One user's storage limits, for the admin console's user list.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserQuotaDto {
    pub user_id: String,
    /// Occupancy, recomputed from the file and version rows on every read.
    pub used_bytes: i64,
    /// `null` means unlimited.
    pub quota_bytes: Option<i64>,
    /// `null` means unlimited.
    pub daily_cap_bytes: Option<i64>,
    pub daily_upload_bytes: i64,
}

/// Both fields are authoritative: this replaces the user's limits rather than
/// patching them, and `null` means unlimited. The console reads the current
/// values before it writes, so it always sends both.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetUserQuotaRequest {
    pub quota_bytes: Option<i64>,
    pub daily_cap_bytes: Option<i64>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuotasQuery {
    /// Comma-separated user ids. The console asks for the ids on the page it is
    /// showing, which is one request per page rather than one per row.
    pub user_ids: String,
}

// ── User-facing handlers ──────────────────────────────────────────────────────

/// Ask an administrator for a bigger storage limit.
///
/// What the storage meter's "Request Additional" link sends (issue #144). The ask is a new *total*
/// limit, and lands in the admin console's work queue; nothing about the caller's quota changes
/// until an admin approves it. One request at a time — a second while the first is unanswered is
/// refused with 409 rather than filed twice.
#[utoipa::path(
    post,
    path = "/api/v1/drive/quota/requests",
    request_body = CreateQuotaRequestRequest,
    responses(
        (status = 201, description = "Request filed", body = QuotaRequestDto),
        (status = 400, description = "The requested size is not a plausible limit"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 409, description = "This user already has a request awaiting review"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[post("/quota/requests")]
async fn create_quota_request(
    state: web::Data<QuotaRequestsState>,
    user: AuthenticatedUser,
    body: web::Json<CreateQuotaRequestRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    if body.requested_bytes <= 0 || body.requested_bytes > MAX_REQUESTABLE_BYTES {
        return Err(ApiError::bad_request(
            "Ask for a size between one byte and 100 TB",
        ));
    }
    // A limit below what the account already holds would be a request to be cut
    // off, which is never what the link means.
    let current = state.storage_service.get_quota(&user.user_id)?;
    if body.requested_bytes <= current.used_bytes {
        return Err(ApiError::bad_request(
            "Ask for more than the storage already in use",
        ));
    }

    let reason = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_string);
    let repo = state.repo.clone();
    let user_id = user.user_id.clone();
    let record = web::block(move || repo.create(&user_id, body.requested_bytes, reason.as_deref()))
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Created().json(QuotaRequestDto::from(record)))
}

/// List the caller's own storage requests, newest first.
///
/// So the meter can say "requested — awaiting review" rather than offering to ask again, and can
/// report what was decided.
#[utoipa::path(
    get,
    path = "/api/v1/drive/quota/requests",
    responses(
        (status = 200, description = "The caller's requests", body = Vec<QuotaRequestDto>),
        (status = 401, description = "Missing or invalid authentication token"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[get("/quota/requests")]
async fn list_my_quota_requests(
    state: web::Data<QuotaRequestsState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let repo = state.repo.clone();
    let user_id = user.user_id.clone();
    let records = web::block(move || repo.list_for_user(&user_id))
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    let dtos: Vec<QuotaRequestDto> = records.into_iter().map(QuotaRequestDto::from).collect();
    Ok(HttpResponse::Ok().json(dtos))
}

// ── Admin handlers ────────────────────────────────────────────────────────────

/// The storage-request work queue, oldest first. Admin only.
///
/// Defaults to the pending requests — the ones that are actually work. Pass `status=approved`,
/// `denied` or `all` to see what has already been decided.
#[utoipa::path(
    get,
    path = "/api/v1/admin/quota-requests",
    params(("status" = Option<String>, Query, description = "pending (default), approved, denied, or all")),
    responses(
        (status = 200, description = "The work queue", body = Vec<QuotaRequestDto>),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[get("/quota-requests")]
async fn list_quota_requests(
    state: web::Data<QuotaRequestsState>,
    query: web::Query<QueueQuery>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let status = match query.into_inner().status.as_deref() {
        None | Some(STATUS_PENDING) => Some(STATUS_PENDING.to_string()),
        Some("all") => None,
        Some(s @ (STATUS_APPROVED | STATUS_DENIED)) => Some(s.to_string()),
        Some(_) => {
            return Err(ApiError::bad_request(
                "status must be pending, approved, denied or all",
            ))
        }
    };

    let repo = state.repo.clone();
    let records = web::block(move || repo.list(status.as_deref()))
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    let dtos: Vec<QuotaRequestDto> = records.into_iter().map(QuotaRequestDto::from).collect();
    Ok(HttpResponse::Ok().json(dtos))
}

/// Approve a storage request and raise the user's limit. Admin only.
///
/// The decision is recorded first and only then is the quota written, so a request two admins
/// approve at once raises the limit once: the second decision is refused with 409 before it can
/// grant anything. `grantedBytes` may be less than was asked for.
#[utoipa::path(
    post,
    path = "/api/v1/admin/quota-requests/{id}/approve",
    params(("id" = String, Path, description = "Request ID")),
    request_body = ApproveQuotaRequestRequest,
    responses(
        (status = 200, description = "Request approved and the quota raised", body = QuotaRequestDto),
        (status = 400, description = "The granted size is not a plausible limit"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "Request not found"),
        (status = 409, description = "The request has already been decided"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[post("/quota-requests/{id}/approve")]
async fn approve_quota_request(
    state: web::Data<QuotaRequestsState>,
    path: web::Path<String>,
    body: web::Json<ApproveQuotaRequestRequest>,
    admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    let body = body.into_inner();

    let repo = state.repo.clone();
    let lookup_id = id.clone();
    let existing = web::block(move || repo.find(&lookup_id))
        .await
        .map_err(|_| ApiError::internal("Task error"))??
        .ok_or_else(|| ApiError::not_found("Request not found"))?;

    let granted = body.granted_bytes.unwrap_or(existing.requested_bytes);
    if granted <= 0 || granted > MAX_REQUESTABLE_BYTES {
        return Err(ApiError::bad_request(
            "Grant a size between one byte and 100 TB",
        ));
    }

    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string);
    let repo = state.repo.clone();
    let decide_id = id.clone();
    let admin_id = admin.user_id.clone();
    let record = web::block(move || {
        repo.decide(
            &decide_id,
            STATUS_APPROVED,
            Some(granted),
            note.as_deref(),
            &admin_id,
            Utc::now().naive_utc(),
        )
    })
    .await
    .map_err(|_| ApiError::internal("Task error"))??;

    // Only the limit is set here. The daily cap is a separate control an admin
    // manages from the user list, and a storage request says nothing about it.
    let current = state.storage_service.get_quota(&record.user_id)?;
    state.storage_service.set_quota_limits(
        &record.user_id,
        Some(granted),
        current.daily_cap_bytes,
    )?;

    Ok(HttpResponse::Ok().json(QuotaRequestDto::from(record)))
}

/// Deny a storage request. Admin only.
///
/// Leaves the user's quota exactly as it is. The note is the answer they see, so it is worth
/// filling in.
#[utoipa::path(
    post,
    path = "/api/v1/admin/quota-requests/{id}/deny",
    params(("id" = String, Path, description = "Request ID")),
    request_body = DenyQuotaRequestRequest,
    responses(
        (status = 200, description = "Request denied", body = QuotaRequestDto),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "Request not found"),
        (status = 409, description = "The request has already been decided"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[post("/quota-requests/{id}/deny")]
async fn deny_quota_request(
    state: web::Data<QuotaRequestsState>,
    path: web::Path<String>,
    body: web::Json<DenyQuotaRequestRequest>,
    admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    let note = body
        .into_inner()
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string);
    let repo = state.repo.clone();
    let admin_id = admin.user_id.clone();
    let record = web::block(move || {
        repo.decide(
            &id,
            STATUS_DENIED,
            None,
            note.as_deref(),
            &admin_id,
            Utc::now().naive_utc(),
        )
    })
    .await
    .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(QuotaRequestDto::from(record)))
}

/// Read one user's storage limits and occupancy. Admin only.
#[utoipa::path(
    get,
    path = "/api/v1/admin/users/{user_id}/quota",
    params(("user_id" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "That user's quota", body = UserQuotaDto),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[get("/users/{user_id}/quota")]
async fn get_user_quota(
    state: web::Data<QuotaRequestsState>,
    path: web::Path<String>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let user_id = path.into_inner();
    let quota = state.storage_service.get_quota(&user_id)?;
    Ok(HttpResponse::Ok().json(UserQuotaDto {
        user_id,
        used_bytes: quota.used_bytes,
        quota_bytes: quota.quota_bytes,
        daily_cap_bytes: quota.daily_cap_bytes,
        daily_upload_bytes: quota.daily_upload_bytes,
    }))
}

/// Set one user's storage limit and daily upload cap. Admin only.
///
/// Replaces both: `null` means unlimited, and a field left out is a field set to unlimited. A limit
/// below what the account already stores is allowed and is how an over-quota account is created —
/// nothing is deleted, but they cannot upload again until they are back under it.
#[utoipa::path(
    put,
    path = "/api/v1/admin/users/{user_id}/quota",
    params(("user_id" = String, Path, description = "User ID")),
    request_body = SetUserQuotaRequest,
    responses(
        (status = 200, description = "The updated quota", body = UserQuotaDto),
        (status = 400, description = "A negative size"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[put("/users/{user_id}/quota")]
async fn set_user_quota(
    state: web::Data<QuotaRequestsState>,
    path: web::Path<String>,
    body: web::Json<SetUserQuotaRequest>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let user_id = path.into_inner();
    let body = body.into_inner();
    let quota =
        state
            .storage_service
            .set_quota_limits(&user_id, body.quota_bytes, body.daily_cap_bytes)?;
    Ok(HttpResponse::Ok().json(UserQuotaDto {
        user_id,
        used_bytes: quota.used_bytes,
        quota_bytes: quota.quota_bytes,
        daily_cap_bytes: quota.daily_cap_bytes,
        daily_upload_bytes: quota.daily_upload_bytes,
    }))
}

/// Read the quotas of several users at once. Admin only.
///
/// What the console's user list reads: one request for the page on screen rather than one per row.
/// Unknown ids come back with the defaults their quota row would be created with, since that is
/// what they would get on their first upload.
#[utoipa::path(
    get,
    path = "/api/v1/admin/quotas",
    params(("userIds" = String, Query, description = "Comma-separated user ids")),
    responses(
        (status = 200, description = "Quotas for the requested users", body = Vec<UserQuotaDto>),
        (status = 400, description = "No ids, or too many"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "quota-requests"
)]
#[get("/quotas")]
async fn list_user_quotas(
    state: web::Data<QuotaRequestsState>,
    query: web::Query<QuotasQuery>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let ids: Vec<String> = query
        .into_inner()
        .user_ids
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if ids.is_empty() {
        return Err(ApiError::bad_request("userIds is required"));
    }
    // The admin listing pages at 100, so anything past that is not a page.
    if ids.len() > 100 {
        return Err(ApiError::bad_request("At most 100 ids at a time"));
    }

    let mut quotas = Vec::with_capacity(ids.len());
    for user_id in ids {
        let quota = state.storage_service.get_quota(&user_id)?;
        quotas.push(UserQuotaDto {
            user_id,
            used_bytes: quota.used_bytes,
            quota_bytes: quota.quota_bytes,
            daily_cap_bytes: quota.daily_cap_bytes,
            daily_upload_bytes: quota.daily_upload_bytes,
        });
    }
    Ok(HttpResponse::Ok().json(quotas))
}

// ── Route configuration ───────────────────────────────────────────────────────

/// Mounted under `/api/v1/drive`.
pub fn configure_user(cfg: &mut web::ServiceConfig) {
    cfg.service(create_quota_request)
        .service(list_my_quota_requests);
}

/// Mounted under `/api/v1/admin`.
pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(list_quota_requests)
        .service(approve_quota_request)
        .service(deny_quota_request)
        .service(get_user_quota)
        .service(set_user_quota)
        .service(list_user_quotas);
}

// ── OpenAPI doc ───────────────────────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(
    paths(
        create_quota_request,
        list_my_quota_requests,
        list_quota_requests,
        approve_quota_request,
        deny_quota_request,
        get_user_quota,
        set_user_quota,
        list_user_quotas,
    ),
    components(schemas(
        QuotaRequestDto,
        CreateQuotaRequestRequest,
        ApproveQuotaRequestRequest,
        DenyQuotaRequestRequest,
        UserQuotaDto,
        SetUserQuotaRequest,
    )),
    tags((
        name = "quota-requests",
        description = "Storage limits and the queue of requests to raise them. A user who has run out of room asks from the storage meter; an admin works the queue and approving is what writes the new limit. The admin routes also read and set any user's limit directly."
    )),
    modifiers(&SecurityAddon)
)]
pub struct QuotaRequestsApiDoc;

struct SecurityAddon;
impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::HttpBuilder::new()
                        .scheme(utoipa::openapi::security::HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }
}
