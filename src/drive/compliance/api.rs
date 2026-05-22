use actix_web::{delete, get, post, put, web, HttpResponse};
use std::sync::Arc;
use crate::shared::{AdminUser, ApiError};
use crate::drive::compliance::{
    dto::*,
    service::ComplianceService,
};

pub struct ComplianceApiState {
    pub service: Arc<ComplianceService>,
}

// Legal Holds
#[utoipa::path(
    get,
    path = "/api/v1/admin/compliance/holds",
    responses(
        (status = 200, description = "List of legal holds", body = LegalHoldListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[get("/compliance/holds")]
pub async fn list_holds(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
) -> Result<web::Json<LegalHoldListResponse>, ApiError> {
    let result = state.service.list_holds()?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/compliance/holds",
    request_body = CreateLegalHoldRequest,
    responses(
        (status = 200, description = "Legal hold created", body = LegalHoldResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[post("/compliance/holds")]
pub async fn create_hold(
    state: web::Data<ComplianceApiState>,
    admin: AdminUser,
    body: web::Json<CreateLegalHoldRequest>,
) -> Result<web::Json<LegalHoldResponse>, ApiError> {
    let result = state.service.create_hold(&admin.user_id, body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/compliance/holds/{id}",
    params(("id" = String, Path, description = "Legal hold ID")),
    responses(
        (status = 200, description = "Legal hold details", body = LegalHoldResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[get("/compliance/holds/{id}")]
pub async fn get_hold(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<web::Json<LegalHoldResponse>, ApiError> {
    let result = state.service.get_hold(&path.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/compliance/holds/{id}",
    params(("id" = String, Path, description = "Legal hold ID")),
    request_body = UpdateLegalHoldRequest,
    responses(
        (status = 200, description = "Legal hold updated", body = LegalHoldResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[put("/compliance/holds/{id}")]
pub async fn update_hold(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
    body: web::Json<UpdateLegalHoldRequest>,
) -> Result<web::Json<LegalHoldResponse>, ApiError> {
    let result = state.service.update_hold(&path.into_inner(), body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/compliance/holds/{id}",
    params(("id" = String, Path, description = "Legal hold ID")),
    responses(
        (status = 204, description = "Legal hold deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[delete("/compliance/holds/{id}")]
pub async fn delete_hold(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.service.delete_hold(&path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/compliance/holds/{id}/files/{file_id}",
    params(
        ("id" = String, Path, description = "Legal hold ID"),
        ("file_id" = String, Path, description = "File ID"),
    ),
    responses(
        (status = 204, description = "Hold applied to file"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[post("/compliance/holds/{id}/files/{file_id}")]
pub async fn apply_hold_to_file(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (hold_id, file_id) = path.into_inner();
    state.service.apply_hold_to_file(&hold_id, &file_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/compliance/holds/{id}/files/{file_id}",
    params(
        ("id" = String, Path, description = "Legal hold ID"),
        ("file_id" = String, Path, description = "File ID"),
    ),
    responses(
        (status = 204, description = "Hold removed from file"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[delete("/compliance/holds/{id}/files/{file_id}")]
pub async fn remove_hold_from_file(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (hold_id, file_id) = path.into_inner();
    state.service.remove_hold_from_file(&hold_id, &file_id)?;
    Ok(HttpResponse::NoContent().finish())
}

// Retention Policies
#[utoipa::path(
    get,
    path = "/api/v1/admin/compliance/retention",
    responses(
        (status = 200, description = "List of retention policies", body = RetentionPolicyListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[get("/compliance/retention")]
pub async fn list_policies(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
) -> Result<web::Json<RetentionPolicyListResponse>, ApiError> {
    let result = state.service.list_policies()?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/compliance/retention",
    request_body = CreateRetentionPolicyRequest,
    responses(
        (status = 200, description = "Retention policy created", body = RetentionPolicyResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[post("/compliance/retention")]
pub async fn create_policy(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    body: web::Json<CreateRetentionPolicyRequest>,
) -> Result<web::Json<RetentionPolicyResponse>, ApiError> {
    let result = state.service.create_policy(body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/compliance/retention/{id}",
    params(("id" = String, Path, description = "Policy ID")),
    responses(
        (status = 200, description = "Retention policy details", body = RetentionPolicyResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[get("/compliance/retention/{id}")]
pub async fn get_policy(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<web::Json<RetentionPolicyResponse>, ApiError> {
    let result = state.service.get_policy(&path.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/compliance/retention/{id}",
    params(("id" = String, Path, description = "Policy ID")),
    responses(
        (status = 204, description = "Retention policy deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[delete("/compliance/retention/{id}")]
pub async fn delete_policy(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.service.delete_policy(&path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

// eDiscovery
#[utoipa::path(
    post,
    path = "/api/v1/admin/compliance/ediscovery/search",
    request_body = EDiscoverySearchRequest,
    responses(
        (status = 200, description = "eDiscovery search results", body = EDiscoverySearchResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-compliance"
)]
#[post("/compliance/ediscovery/search")]
pub async fn ediscovery_search(
    state: web::Data<ComplianceApiState>,
    _admin: AdminUser,
    body: web::Json<EDiscoverySearchRequest>,
) -> Result<web::Json<EDiscoverySearchResponse>, ApiError> {
    let result = state.service.ediscovery_search(body.into_inner())?;
    Ok(web::Json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_holds)
        .service(create_hold)
        .service(get_hold)
        .service(update_hold)
        .service(delete_hold)
        .service(apply_hold_to_file)
        .service(remove_hold_from_file)
        .service(list_policies)
        .service(create_policy)
        .service(get_policy)
        .service(delete_policy)
        .service(ediscovery_search);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        list_holds,
        create_hold,
        get_hold,
        update_hold,
        delete_hold,
        apply_hold_to_file,
        remove_hold_from_file,
        list_policies,
        create_policy,
        get_policy,
        delete_policy,
        ediscovery_search,
    ),
    components(schemas(
        CreateLegalHoldRequest,
        UpdateLegalHoldRequest,
        LegalHoldResponse,
        LegalHoldListResponse,
        CreateRetentionPolicyRequest,
        UpdateRetentionPolicyRequest,
        RetentionPolicyResponse,
        RetentionPolicyListResponse,
        EDiscoverySearchRequest,
        EDiscoveryResult,
        EDiscoverySearchResponse,
    )),
    tags((name = "drive-compliance", description = "Drive compliance endpoints")),
    security(("bearer_auth" = []))
)]
pub struct ComplianceApiDoc;
