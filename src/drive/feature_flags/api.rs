use actix_web::{get, patch, web, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use utoipa::OpenApi;

use super::repository::FeatureFlagsRepository;
use crate::shared::{AdminUser, ApiError};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct FeatureFlagsState {
    pub repo: Arc<FeatureFlagsRepository>,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlagDto {
    pub key: String,
    pub enabled: bool,
    pub description: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateFeatureFlagRequest {
    pub enabled: bool,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Return all feature flags as a key→boolean map (no auth required).
#[utoipa::path(
    get,
    path = "/api/v1/feature-flags",
    responses(
        (status = 200, description = "Feature flags as a key→boolean map"),
    ),
    tag = "feature-flags"
)]
#[get("/feature-flags")]
async fn get_feature_flags_public(
    state: web::Data<FeatureFlagsState>,
) -> Result<HttpResponse, ApiError> {
    let repo = state.repo.clone();
    let flags = web::block(move || repo.list())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;

    let mut map = serde_json::Map::new();
    for f in flags {
        map.insert(f.key, json!(f.enabled != 0));
    }
    Ok(HttpResponse::Ok().json(serde_json::Value::Object(map)))
}

/// List all feature flags with metadata. Requires admin auth.
#[utoipa::path(
    get,
    path = "/api/v1/admin/feature-flags",
    responses(
        (status = 200, description = "List of feature flags", body = Vec<FeatureFlagDto>),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "feature-flags"
)]
#[get("/feature-flags")]
async fn list_feature_flags_admin(
    state: web::Data<FeatureFlagsState>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let repo = state.repo.clone();
    let flags = web::block(move || repo.list())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;

    let dtos: Vec<FeatureFlagDto> = flags
        .into_iter()
        .map(|f| FeatureFlagDto {
            enabled: f.enabled != 0,
            key: f.key,
            description: f.description,
            updated_at: f.updated_at,
        })
        .collect();
    Ok(HttpResponse::Ok().json(dtos))
}

/// Enable or disable a feature flag. Requires admin auth.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/feature-flags/{key}",
    params(
        ("key" = String, Path, description = "Feature flag key")
    ),
    request_body = UpdateFeatureFlagRequest,
    responses(
        (status = 200, description = "Updated feature flag", body = FeatureFlagDto),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "Feature flag not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "feature-flags"
)]
#[patch("/feature-flags/{key}")]
async fn update_feature_flag(
    state: web::Data<FeatureFlagsState>,
    path: web::Path<String>,
    body: web::Json<UpdateFeatureFlagRequest>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let key = path.into_inner();
    let enabled = body.into_inner().enabled;
    let repo = state.repo.clone();
    let record = web::block(move || repo.update(&key, enabled))
        .await
        .map_err(|_| ApiError::internal("Task error"))??;

    let dto = FeatureFlagDto {
        enabled: record.enabled != 0,
        key: record.key,
        description: record.description,
        updated_at: record.updated_at,
    };
    Ok(HttpResponse::Ok().json(dto))
}

pub fn configure_public(cfg: &mut web::ServiceConfig) {
    cfg.service(get_feature_flags_public);
}

pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(list_feature_flags_admin)
        .service(update_feature_flag);
}

// ── OpenAPI doc ───────────────────────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(
    paths(get_feature_flags_public, list_feature_flags_admin, update_feature_flag),
    components(schemas(FeatureFlagDto, UpdateFeatureFlagRequest)),
    tags((name = "feature-flags", description = "Feature flag management — public read, admin write")),
    modifiers(&SecurityAddon)
)]
pub struct FeatureFlagsApiDoc;

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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, web, App};
    use std::sync::Arc;

    use crate::shared::{DbPool, TokenService};

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel::SqliteConnection;
        use diesel_migrations::MigrationHarness;

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

    fn test_state() -> web::Data<FeatureFlagsState> {
        let pool = test_pool();
        let repo = Arc::new(FeatureFlagsRepository::new(pool));
        web::Data::new(FeatureFlagsState { repo })
    }

    fn make_token_service() -> Arc<TokenService> {
        Arc::new(TokenService::new("test-secret-for-tests".to_string()))
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
                    .configure(configure_public)
                    .service(web::scope("/admin").configure(configure_admin)),
            )
            .await
        }};
    }

    #[actix_web::test]
    async fn public_endpoint_returns_flag_map() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get().uri("/feature-flags").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert!(body.is_object());
        assert!(body.get("search").is_some());
    }

    #[actix_web::test]
    async fn admin_list_requires_admin_auth() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get()
            .uri("/admin/feature-flags")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn admin_list_rejects_non_admin() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = non_admin_bearer(&ts);
        let req = test::TestRequest::get()
            .uri("/admin/feature-flags")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 403);
    }

    #[actix_web::test]
    async fn admin_list_returns_flags_for_admin() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let req = test::TestRequest::get()
            .uri("/admin/feature-flags")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert!(body.is_array());
        assert!(!body.as_array().unwrap().is_empty());
    }

    #[actix_web::test]
    async fn admin_patch_toggles_flag() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let req = test::TestRequest::patch()
            .uri("/admin/feature-flags/search")
            .insert_header(("Authorization", token.clone()))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(r#"{"enabled":true}"#)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["key"], "search");
        assert_eq!(body["enabled"], true);
    }

    #[actix_web::test]
    async fn admin_patch_unknown_flag_returns_404() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let req = test::TestRequest::patch()
            .uri("/admin/feature-flags/nonexistent")
            .insert_header(("Authorization", token))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(r#"{"enabled":true}"#)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);
    }
}
