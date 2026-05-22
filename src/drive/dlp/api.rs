use actix_web::{delete, get, post, web, HttpResponse};
use std::sync::Arc;
use crate::shared::{AdminUser, ApiError};
use crate::drive::dlp::{
    dto::*,
    service::DlpService,
};

pub struct DlpApiState {
    pub service: Arc<DlpService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/dlp/rules",
    responses(
        (status = 200, description = "List of DLP rules", body = DlpRuleListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-dlp"
)]
#[get("/dlp/rules")]
pub async fn list_rules(
    state: web::Data<DlpApiState>,
    _admin: AdminUser,
) -> Result<web::Json<DlpRuleListResponse>, ApiError> {
    let result = state.service.list_rules()?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/dlp/rules",
    request_body = CreateDlpRuleRequest,
    responses(
        (status = 200, description = "DLP rule created", body = DlpRuleResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-dlp"
)]
#[post("/dlp/rules")]
pub async fn create_rule(
    state: web::Data<DlpApiState>,
    admin: AdminUser,
    body: web::Json<CreateDlpRuleRequest>,
) -> Result<web::Json<DlpRuleResponse>, ApiError> {
    let result = state.service.create_rule(&admin.user_id, body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/dlp/rules/{id}",
    params(("id" = String, Path, description = "DLP rule ID")),
    responses(
        (status = 200, description = "DLP rule details", body = DlpRuleResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-dlp"
)]
#[get("/dlp/rules/{id}")]
pub async fn get_rule(
    state: web::Data<DlpApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<web::Json<DlpRuleResponse>, ApiError> {
    let id = path.into_inner();
    let result = state.service.get_rule(&id)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/dlp/rules/{id}",
    params(("id" = String, Path, description = "DLP rule ID")),
    responses(
        (status = 204, description = "DLP rule deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-dlp"
)]
#[delete("/dlp/rules/{id}")]
pub async fn delete_rule(
    state: web::Data<DlpApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    state.service.delete_rule(&id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/dlp/violations",
    params(
        ("page" = Option<i64>, Query, description = "Page number"),
        ("page_size" = Option<i64>, Query, description = "Items per page"),
        ("file_id" = Option<String>, Query, description = "Filter by file ID"),
    ),
    responses(
        (status = 200, description = "List of DLP violations", body = DlpViolationListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-dlp"
)]
#[get("/dlp/violations")]
pub async fn list_violations(
    state: web::Data<DlpApiState>,
    _admin: AdminUser,
    query: web::Query<DlpViolationQuery>,
) -> Result<web::Json<DlpViolationListResponse>, ApiError> {
    let result = state.service.list_violations(&query)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/dlp/violations/{id}/dismiss",
    params(("id" = String, Path, description = "Violation ID")),
    responses(
        (status = 204, description = "Violation dismissed"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-dlp"
)]
#[post("/dlp/violations/{id}/dismiss")]
pub async fn dismiss_violation(
    state: web::Data<DlpApiState>,
    admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    state.service.dismiss_violation(&id, &admin.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_rules)
        .service(create_rule)
        .service(get_rule)
        .service(delete_rule)
        .service(list_violations)
        .service(dismiss_violation);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        list_rules,
        create_rule,
        get_rule,
        delete_rule,
        list_violations,
        dismiss_violation,
    ),
    components(schemas(
        CreateDlpRuleRequest,
        UpdateDlpRuleRequest,
        DlpRuleResponse,
        DlpRuleListResponse,
        DlpViolationResponse,
        DlpViolationListResponse,
        DlpViolationQuery,
    )),
    tags((name = "drive-dlp", description = "Drive DLP endpoints")),
    security(("bearer_auth" = []))
)]
pub struct DlpApiDoc;
