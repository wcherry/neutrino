use actix_web::{delete, get, post, web, HttpResponse};
use std::sync::Arc;
use crate::shared::{AdminUser, ApiError};
use crate::drive::security::{
    dto::*,
    service::SecurityService,
};

pub struct SecurityApiState {
    pub service: Arc<SecurityService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/security/ransomware/events",
    responses(
        (status = 200, description = "List of ransomware events", body = RansomwareEventListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-security"
)]
#[get("/security/ransomware/events")]
pub async fn list_ransomware_events(
    state: web::Data<SecurityApiState>,
    _admin: AdminUser,
) -> Result<web::Json<RansomwareEventListResponse>, ApiError> {
    let result = state.service.list_ransomware_events()?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/security/ransomware/events/{id}/resolve",
    params(("id" = String, Path, description = "Ransomware event ID")),
    responses(
        (status = 204, description = "Event resolved"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-security"
)]
#[post("/security/ransomware/events/{id}/resolve")]
pub async fn resolve_ransomware_event(
    state: web::Data<SecurityApiState>,
    admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.service.resolve_ransomware_event(&path.into_inner(), &admin.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/security/siem",
    responses(
        (status = 200, description = "List of SIEM configurations", body = SiemConfigListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-security"
)]
#[get("/security/siem")]
pub async fn list_siem_configs(
    state: web::Data<SecurityApiState>,
    _admin: AdminUser,
) -> Result<web::Json<SiemConfigListResponse>, ApiError> {
    let result = state.service.list_siem_configs()?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/security/siem",
    request_body = CreateSiemConfigRequest,
    responses(
        (status = 200, description = "SIEM configuration created", body = SiemConfigResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-security"
)]
#[post("/security/siem")]
pub async fn create_siem_config(
    state: web::Data<SecurityApiState>,
    _admin: AdminUser,
    body: web::Json<CreateSiemConfigRequest>,
) -> Result<web::Json<SiemConfigResponse>, ApiError> {
    let result = state.service.create_siem_config(body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/security/siem/{id}",
    params(("id" = String, Path, description = "SIEM config ID")),
    responses(
        (status = 204, description = "SIEM configuration deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-security"
)]
#[delete("/security/siem/{id}")]
pub async fn delete_siem_config(
    state: web::Data<SecurityApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.service.delete_siem_config(&path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/security/siem/export",
    responses(
        (status = 200, description = "SIEM export triggered"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-security"
)]
#[post("/security/siem/export")]
pub async fn trigger_siem_export(
    state: web::Data<SecurityApiState>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let count = state.service.export_to_siem()?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "exported": count })))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/security/cmek",
    request_body = CmekKeyRequest,
    responses(
        (status = 200, description = "CMEK configured", body = CmekKeyResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-security"
)]
#[post("/security/cmek")]
pub async fn configure_cmek(
    state: web::Data<SecurityApiState>,
    _admin: AdminUser,
    body: web::Json<CmekKeyRequest>,
) -> Result<web::Json<CmekKeyResponse>, ApiError> {
    let result = state.service.configure_cmek(body.into_inner())?;
    Ok(web::Json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_ransomware_events)
        .service(resolve_ransomware_event)
        .service(list_siem_configs)
        .service(create_siem_config)
        .service(delete_siem_config)
        .service(trigger_siem_export)
        .service(configure_cmek);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        list_ransomware_events,
        resolve_ransomware_event,
        list_siem_configs,
        create_siem_config,
        delete_siem_config,
        trigger_siem_export,
        configure_cmek,
    ),
    components(schemas(
        RansomwareEventResponse,
        RansomwareEventListResponse,
        CreateSiemConfigRequest,
        UpdateSiemConfigRequest,
        SiemConfigResponse,
        SiemConfigListResponse,
        CmekKeyRequest,
        CmekKeyResponse,
    )),
    tags((name = "drive-security", description = "Drive security endpoints")),
    security(("bearer_auth" = []))
)]
pub struct SecurityApiDoc;
