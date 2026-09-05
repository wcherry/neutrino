use actix_web::{get, patch, web, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use utoipa::OpenApi;

use super::catalog;
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
    /// The team that owns this flag, from the server's catalog. `None` for a row whose key nothing
    /// declares any more — the admin list is the surface for spotting exactly that.
    pub owner: Option<String>,
    /// The condition under which this flag comes out, from the catalog. Rendered next to the
    /// toggle so "can this go yet?" is answerable where it is asked, rather than being a question
    /// that has to be taken to whoever added the flag.
    pub removal: Option<String>,
    /// True when the server declares this key but the table has no row for it. The admin list is
    /// the only place such a key is visible at all: it has no row to render, so it is synthesised
    /// here, disabled, with this flag set.
    pub missing_row: bool,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateFeatureFlagRequest {
    pub enabled: bool,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Fetch the feature flags as a key-to-boolean map.
///
/// Unauthenticated, because the frontend needs the flags before anyone signs in in order to
/// decide what to render.
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

/// List the feature flags in full. Admin only.
///
/// Adds the description, timestamps, owner and removal condition that the public key-to-boolean
/// map leaves out, for the admin toggle list.
///
/// Reads the table unreconciled and reports the gaps in the payload instead of refusing. This is
/// the surface an operator uses to diagnose a table the public endpoint has started rejecting, so
/// failing it for the same reason would hide the evidence: a declared key with no row appears here
/// as a disabled entry with `missingRow` set, which is the only way to see it at all.
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
    let flags = web::block(move || repo.list_unchecked())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;

    let present: Vec<String> = flags.iter().map(|f| f.key.clone()).collect();

    let mut dtos: Vec<FeatureFlagDto> = flags
        .into_iter()
        .map(|f| {
            let declared = catalog::DECLARED_FLAGS.iter().find(|d| d.key == f.key);
            FeatureFlagDto {
                enabled: f.enabled != 0,
                key: f.key,
                description: f.description,
                updated_at: f.updated_at,
                owner: declared.map(|d| d.owner.to_string()),
                removal: declared.map(|d| d.removal.to_string()),
                missing_row: false,
            }
        })
        .collect();

    for key in catalog::missing_keys(&present) {
        let declared = catalog::DECLARED_FLAGS.iter().find(|d| d.key == key);
        dtos.push(FeatureFlagDto {
            key: key.to_string(),
            enabled: false,
            description: Some(
                "Declared by the server but no row exists. Until a migration seeds it, the public \
                 flag endpoint fails rather than reporting this key as off."
                    .to_string(),
            ),
            updated_at: String::new(),
            owner: declared.map(|d| d.owner.to_string()),
            removal: declared.map(|d| d.removal.to_string()),
            missing_row: true,
        });
    }

    dtos.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(HttpResponse::Ok().json(dtos))
}

/// Turn one feature flag on or off. Admin only.
///
/// Takes effect for every client on its next read of the public flags endpoint.
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

    let declared = catalog::DECLARED_FLAGS.iter().find(|d| d.key == record.key);
    let dto = FeatureFlagDto {
        enabled: record.enabled != 0,
        owner: declared.map(|d| d.owner.to_string()),
        removal: declared.map(|d| d.removal.to_string()),
        key: record.key,
        description: record.description,
        updated_at: record.updated_at,
        missing_row: false,
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
    tags((
        name = "feature-flags",
        description = "Server-side switches for optional functionality. The public endpoint returns a key-to-boolean map with no authentication, because the frontend needs it before sign-in; the admin endpoints add metadata and are the only way to change a flag."
    )),
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
        assert!(body.get("teamSpaces").is_some());
        // Off in the seed, and the map has to say so rather than omit the key.
        assert_eq!(body["teamSpaces"], false);
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
            .uri("/admin/feature-flags/teamSpaces")
            .insert_header(("Authorization", token.clone()))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(r#"{"enabled":true}"#)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["key"], "teamSpaces");
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

    /// A key the server declares but the table has no row for must not read as a feature that is
    /// off. This is the exact shape of the bug #183 found — `docsCompare` and three others had no
    /// row, so the client read `undefined`, and a feature nobody had disabled was disabled forever
    /// with nothing anywhere to say so.
    #[actix_web::test]
    async fn public_endpoint_fails_loudly_when_a_declared_key_has_no_row() {
        use crate::schema::feature_flags;
        use diesel::prelude::*;

        let pool = test_pool();
        diesel::delete(feature_flags::table.filter(feature_flags::key.eq("teamSpaces")))
            .execute(&mut pool.get().expect("conn"))
            .expect("delete row");

        let state = web::Data::new(FeatureFlagsState {
            repo: Arc::new(FeatureFlagsRepository::new(pool)),
        });
        let app = make_app!(state, make_token_service());

        let req = test::TestRequest::get().uri("/feature-flags").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 500);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert!(
            body["error"]["message"]
                .as_str()
                .unwrap_or_default()
                .contains("teamSpaces"),
            "the error has to name the missing key, or it is another silent failure: {body}"
        );
    }

    /// The admin list is how an operator diagnoses the failure above, so it answers rather than
    /// failing, and surfaces the missing key as a synthesised disabled row.
    #[actix_web::test]
    async fn admin_list_surfaces_a_declared_key_with_no_row() {
        use crate::schema::feature_flags;
        use diesel::prelude::*;

        let pool = test_pool();
        diesel::delete(feature_flags::table.filter(feature_flags::key.eq("teamSpaces")))
            .execute(&mut pool.get().expect("conn"))
            .expect("delete row");

        let state = web::Data::new(FeatureFlagsState {
            repo: Arc::new(FeatureFlagsRepository::new(pool)),
        });
        let ts = make_token_service();
        let app = make_app!(state, ts.clone());

        let req = test::TestRequest::get()
            .uri("/admin/feature-flags")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);

        let body: serde_json::Value = test::read_body_json(resp).await;
        let row = body
            .as_array()
            .expect("array")
            .iter()
            .find(|f| f["key"] == "teamSpaces")
            .expect("the missing key still has to appear in the admin list");
        assert_eq!(row["missingRow"], true);
        assert_eq!(row["enabled"], false);
        assert_eq!(row["owner"], "drive");
    }

    /// Every flag the admin list serves carries the two things that make it removable later.
    #[actix_web::test]
    async fn admin_list_carries_owner_and_removal_condition() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let req = test::TestRequest::get()
            .uri("/admin/feature-flags")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .to_request();
        let body: serde_json::Value =
            test::read_body_json(test::call_service(&app, req).await).await;

        for flag in body.as_array().expect("array") {
            assert!(
                flag["owner"].is_string() && flag["removal"].is_string(),
                "{} has no owner or no removal condition",
                flag["key"]
            );
        }
    }
}
