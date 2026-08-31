use actix_web::{get, put, web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::OpenApi;

use super::model::VersionRetentionRecord;
use super::repository::VersionRetentionRepository;
use crate::shared::{AdminUser, ApiError};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct VersionRetentionState {
    pub repo: Arc<VersionRetentionRepository>,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VersionRetentionDto {
    /// Whether the worker prunes version history at all.
    pub enabled: bool,
    /// Versions older than this are eligible for deletion.
    pub retention_days: i32,
    /// How many of the newest versions survive regardless of age.
    pub min_versions: i32,
    pub updated_at: String,
}

impl From<VersionRetentionRecord> for VersionRetentionDto {
    fn from(r: VersionRetentionRecord) -> Self {
        VersionRetentionDto {
            enabled: r.enabled,
            retention_days: r.retention_days,
            min_versions: r.min_versions,
            updated_at: r.updated_at.and_utc().to_rfc3339(),
        }
    }
}

/// Every field optional so the console can send only what changed.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVersionRetentionRequest {
    pub enabled: Option<bool>,
    pub retention_days: Option<i32>,
    pub min_versions: Option<i32>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Read the version-retention policy. Admin only.
///
/// The same row the background worker's sweep reads, so what the console shows is what is being
/// enforced rather than a second copy of the rules.
#[utoipa::path(
    get,
    path = "/api/v1/admin/version-retention",
    responses(
        (status = 200, description = "The current retention policy", body = VersionRetentionDto),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "version-retention"
)]
#[get("/version-retention")]
async fn get_version_retention(
    state: web::Data<VersionRetentionState>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let repo = state.repo.clone();
    let record = web::block(move || repo.get())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(VersionRetentionDto::from(record)))
}

/// Change the version-retention policy. Admin only.
///
/// Takes effect on the worker's next sweep, which runs hourly — there is nothing to restart.
/// Lowering either number makes versions eligible that were not before, and the sweep deletes
/// them for good.
#[utoipa::path(
    put,
    path = "/api/v1/admin/version-retention",
    request_body = UpdateVersionRetentionRequest,
    responses(
        (status = 200, description = "The updated retention policy", body = VersionRetentionDto),
        (status = 400, description = "A value was out of range"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "version-retention"
)]
#[put("/version-retention")]
async fn update_version_retention(
    state: web::Data<VersionRetentionState>,
    body: web::Json<UpdateVersionRetentionRequest>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let repo = state.repo.clone();
    let record = web::block(move || {
        repo.update(body.enabled, body.retention_days, body.min_versions)
    })
    .await
    .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(VersionRetentionDto::from(record)))
}

pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(get_version_retention)
        .service(update_version_retention);
}

// ── OpenAPI doc ───────────────────────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(
    paths(get_version_retention, update_version_retention),
    components(schemas(VersionRetentionDto, UpdateVersionRetentionRequest)),
    tags((
        name = "version-retention",
        description = "How long file version history is kept. One workspace-wide policy of two numbers — an age in days and a floor on how many of the newest versions survive regardless — enforced by the background worker, not by these routes. Admin only."
    )),
    modifiers(&SecurityAddon)
)]
pub struct VersionRetentionApiDoc;

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
    use actix_web::{test, App};
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;

    use crate::shared::{DbPool, TokenService};

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn test_state() -> web::Data<VersionRetentionState> {
        web::Data::new(VersionRetentionState {
            repo: Arc::new(VersionRetentionRepository::new(test_pool())),
        })
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
                    .service(web::scope("/admin").configure(configure_admin)),
            )
            .await
        }};
    }

    #[actix_web::test]
    async fn reading_the_policy_requires_admin_auth() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());

        let req = test::TestRequest::get()
            .uri("/admin/version-retention")
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 401);

        let req = test::TestRequest::get()
            .uri("/admin/version-retention")
            .insert_header(("Authorization", non_admin_bearer(&ts)))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 403);
    }

    #[actix_web::test]
    async fn an_admin_reads_the_seeded_defaults() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let req = test::TestRequest::get()
            .uri("/admin/version-retention")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["enabled"], true);
        assert_eq!(body["retentionDays"], 30);
        assert_eq!(body["minVersions"], 10);
    }

    #[actix_web::test]
    async fn an_admin_writes_the_policy() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let req = test::TestRequest::put()
            .uri("/admin/version-retention")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(r#"{"retentionDays":90,"minVersions":3}"#)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["retentionDays"], 90);
        assert_eq!(body["minVersions"], 3);
    }

    #[actix_web::test]
    async fn an_out_of_range_value_is_rejected() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let req = test::TestRequest::put()
            .uri("/admin/version-retention")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(r#"{"retentionDays":-5}"#)
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 400);
    }
}
