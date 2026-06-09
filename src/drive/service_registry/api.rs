use actix_web::{get, patch, post, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;

use super::{ServiceInfo, ServiceRegistry};
use crate::shared::ApiError;

pub struct ServiceRegistryState {
    pub registry: Arc<ServiceRegistry>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct RegisterRequest {
    name: String,
    endpoint: String,
    version: String,
    health_check_url: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct UpdateFlagsRequest {
    enabled: Option<bool>,
    auto_update: Option<bool>,
}

#[utoipa::path(
    post,
    path = "/api/v1/internal/services/register",
    request_body = RegisterRequest,
    responses(
        (status = 200, description = "Service registered", body = ServiceInfo),
        (status = 400, description = "Invalid request"),
    ),
    tag = "drive-service-registry"
)]
#[post("/services/register")]
async fn register_service(
    state: web::Data<ServiceRegistryState>,
    body: web::Json<RegisterRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let name = body.name.clone();
    let info = web::block(move || {
        state.registry.register(
            &body.name,
            &body.endpoint,
            &body.version,
            &body.health_check_url,
        )
    })
    .await
    .map_err(|_| ApiError::internal("Task error"))??;
    tracing::info!(
        "Service '{}' registered (v{}, enabled={}, auto_update={})",
        name,
        info.version,
        info.enabled,
        info.auto_update
    );
    Ok(HttpResponse::Ok().json(info))
}

#[utoipa::path(
    get,
    path = "/api/v1/internal/services",
    responses(
        (status = 200, description = "List of registered services", body = Vec<ServiceInfo>),
    ),
    tag = "drive-service-registry"
)]
#[get("/services")]
async fn list_services(state: web::Data<ServiceRegistryState>) -> Result<HttpResponse, ApiError> {
    let services = web::block(move || state.registry.list())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(services))
}

#[utoipa::path(
    patch,
    path = "/api/v1/internal/services/{name}",
    params(("name" = String, Path, description = "Service name")),
    request_body = UpdateFlagsRequest,
    responses(
        (status = 200, description = "Service flags updated", body = ServiceInfo),
        (status = 404, description = "Service not found"),
    ),
    tag = "drive-service-registry"
)]
#[patch("/services/{name}")]
async fn update_service_flags(
    state: web::Data<ServiceRegistryState>,
    path: web::Path<String>,
    body: web::Json<UpdateFlagsRequest>,
) -> Result<HttpResponse, ApiError> {
    let name = path.into_inner();
    let body = body.into_inner();
    let info = web::block(move || {
        state
            .registry
            .update_flags(&name, body.enabled, body.auto_update)
    })
    .await
    .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(info))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(register_service)
        .service(list_services)
        .service(update_service_flags);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(register_service, list_services, update_service_flags),
    components(schemas(RegisterRequest, UpdateFlagsRequest, ServiceInfo)),
    tags((name = "drive-service-registry", description = "Drive service registry endpoints"))
)]
pub struct ServiceRegistryApiDoc;
