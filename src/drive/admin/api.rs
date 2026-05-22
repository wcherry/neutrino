use actix_web::{get, patch, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::OpenApi;

use crate::shared::{AdminUser, ApiError};
use crate::drive::service_registry::ServiceRegistry;
use super::service::{AdminDashboardService, DiskUsageInfo, ProcessInfo};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct AdminDashboardState {
    pub service: Arc<AdminDashboardService>,
    pub service_registry: Arc<ServiceRegistry>,
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct UpdateServiceFlagsRequest {
    /// Enable or disable the service
    enabled: Option<bool>,
    /// Enable or disable automatic updates for the service
    auto_update: Option<bool>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Return process information. Requires admin auth.
#[utoipa::path(
    get,
    path = "/api/v1/admin/processes",
    responses(
        (status = 200, description = "List of running processes", body = Vec<ProcessInfo>),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "admin"
)]
#[get("/processes")]
async fn get_processes(
    state: web::Data<AdminDashboardState>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let svc = state.service.clone();
    let procs = web::block(move || svc.get_processes())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(procs))
}

/// Return disk usage for the configured storage path. Requires admin auth.
#[utoipa::path(
    get,
    path = "/api/v1/admin/disk",
    responses(
        (status = 200, description = "Disk usage statistics for the storage path", body = DiskUsageInfo),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "admin"
)]
#[get("/disk")]
async fn get_disk_usage(
    state: web::Data<AdminDashboardState>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let svc = state.service.clone();
    let info = web::block(move || svc.get_disk_usage())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(info))
}

/// List all registered services. Requires admin auth.
#[utoipa::path(
    get,
    path = "/api/v1/admin/services",
    responses(
        (status = 200, description = "List of registered services", body = Vec<crate::drive::service_registry::ServiceInfo>),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "admin"
)]
#[get("/services")]
async fn list_services(
    state: web::Data<AdminDashboardState>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let registry = state.service_registry.clone();
    let services = web::block(move || registry.list())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(services))
}

/// Enable/disable or toggle auto_update on a registered service. Requires admin auth.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/services/{name}",
    params(
        ("name" = String, Path, description = "Registered service name")
    ),
    request_body = UpdateServiceFlagsRequest,
    responses(
        (status = 200, description = "Updated service information", body = crate::drive::service_registry::ServiceInfo),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "Service not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "admin"
)]
#[patch("/services/{name}")]
async fn update_service_flags(
    state: web::Data<AdminDashboardState>,
    path: web::Path<String>,
    body: web::Json<UpdateServiceFlagsRequest>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let name = path.into_inner();
    let body = body.into_inner();
    let registry = state.service_registry.clone();
    let info = web::block(move || {
        registry.update_flags(&name, body.enabled, body.auto_update)
    })
    .await
    .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(info))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(get_processes)
        .service(get_disk_usage)
        .service(list_services)
        .service(update_service_flags);
}

// ── OpenAPI doc ───────────────────────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(
    paths(
        get_processes,
        get_disk_usage,
        list_services,
        update_service_flags,
    ),
    components(schemas(
        ProcessInfo,
        crate::drive::admin::service::PathUsage,
        DiskUsageInfo,
        UpdateServiceFlagsRequest,
        crate::drive::service_registry::ServiceInfo,
    )),
    tags((name = "admin", description = "Admin dashboard endpoints — process info, disk usage, service management")),
    modifiers(&SecurityAddon)
)]
pub struct AdminApiDoc;

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

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, web, App};
    use std::sync::Arc;

    use crate::drive::admin::service::AdminDashboardService;
    use crate::drive::service_registry::{ServiceRegistry, repository::ServiceRegistrationRepository};
    use crate::shared::{DbPool, TokenService};

    // Build a minimal in-memory SQLite pool for tests
    fn test_pool() -> DbPool {
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel::SqliteConnection;
        use diesel_migrations::MigrationHarness;
        use crate::MIGRATIONS;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn test_state() -> web::Data<AdminDashboardState> {
        let pool = test_pool();
        let repo = Arc::new(ServiceRegistrationRepository::new(pool));
        let registry = ServiceRegistry::new(repo);
        let svc = Arc::new(AdminDashboardService::new(".".to_string()));
        web::Data::new(AdminDashboardState {
            service: svc,
            service_registry: registry,
        })
    }

    fn make_token_service() -> Arc<TokenService> {
        Arc::new(TokenService::new("test-secret-key-for-tests".to_string()))
    }

    fn admin_bearer(ts: &TokenService) -> String {
        let tok = ts
            .generate_access_token_with_admin("user-1", "admin@example.com", true)
            .expect("token");
        format!("Bearer {}", tok)
    }

    fn non_admin_bearer(ts: &TokenService) -> String {
        let tok = ts
            .generate_access_token("user-2", "user@example.com")
            .expect("token");
        format!("Bearer {}", tok)
    }

    macro_rules! make_app {
        ($state:expr, $ts:expr) => {{
            let ts_data = web::Data::new($ts);
            test::init_service(
                App::new()
                    .app_data($state)
                    .app_data(ts_data)
                    .service(web::scope("/api/v1/admin").configure(configure)),
            )
            .await
        }};
    }

    #[actix_web::test]
    async fn get_processes_requires_admin_auth() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get().uri("/api/v1/admin/processes").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn get_disk_requires_admin_auth() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get().uri("/api/v1/admin/disk").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn get_services_requires_admin_auth() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get().uri("/api/v1/admin/services").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn patch_service_requires_admin_auth() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::patch()
            .uri("/api/v1/admin/services/test-service")
            .insert_header(("Content-Type", "application/json"))
            .set_payload(r#"{"enabled":true}"#)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn get_processes_with_admin_auth_returns_200() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let req = test::TestRequest::get()
            .uri("/api/v1/admin/processes")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
    }

    #[actix_web::test]
    async fn get_disk_with_admin_auth_returns_200() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let req = test::TestRequest::get()
            .uri("/api/v1/admin/disk")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
    }

    #[actix_web::test]
    async fn get_services_with_admin_auth_returns_empty_list() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let req = test::TestRequest::get()
            .uri("/api/v1/admin/services")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert!(body.is_array());
    }
}
