use actix_web::{get, put, web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::OpenApi;

use super::model::PasswordPolicyRecord;
use super::repository::{PasswordPolicyRepository, PasswordPolicyUpdate};
use crate::shared::{AdminUser, ApiError};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct PasswordPolicyState {
    pub repo: Arc<PasswordPolicyRepository>,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PasswordPolicyDto {
    pub min_length: i32,
    pub require_uppercase: bool,
    pub require_lowercase: bool,
    pub require_number: bool,
    pub require_symbol: bool,
    /// Days a password stays valid. `0` means passwords never expire on age.
    pub max_age_days: i32,
    pub updated_at: String,
    /// Characters a password may not contain, as the characters themselves.
    /// Empty forbids nothing.
    pub forbidden_characters: String,
    /// Consecutive failed sign-ins before the account locks. `0` means never.
    pub lockout_threshold: i32,
    /// How many previous passwords a new one is checked against. `0` is off.
    pub history_count: i32,
}

impl From<PasswordPolicyRecord> for PasswordPolicyDto {
    fn from(r: PasswordPolicyRecord) -> Self {
        PasswordPolicyDto {
            min_length: r.min_length,
            require_uppercase: r.require_uppercase,
            require_lowercase: r.require_lowercase,
            require_number: r.require_number,
            require_symbol: r.require_symbol,
            max_age_days: r.max_age_days,
            updated_at: r.updated_at.and_utc().to_rfc3339(),
            forbidden_characters: r.forbidden_characters,
            lockout_threshold: r.lockout_threshold,
            history_count: r.history_count,
        }
    }
}

/// Every field optional so the console can send only what changed.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePasswordPolicyRequest {
    pub min_length: Option<i32>,
    pub require_uppercase: Option<bool>,
    pub require_lowercase: Option<bool>,
    pub require_number: Option<bool>,
    pub require_symbol: Option<bool>,
    pub max_age_days: Option<i32>,
    pub forbidden_characters: Option<String>,
    pub lockout_threshold: Option<i32>,
    pub history_count: Option<i32>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Read the workspace password policy. Admin only.
///
/// The same row registration and password changes are checked against, so what the console shows
/// is what is being enforced rather than a second copy of the rules.
#[utoipa::path(
    get,
    path = "/api/v1/admin/password-policy",
    responses(
        (status = 200, description = "The current password policy", body = PasswordPolicyDto),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "password-policy"
)]
#[get("/password-policy")]
async fn get_password_policy(
    state: web::Data<PasswordPolicyState>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let repo = state.repo.clone();
    let record = web::block(move || repo.get())
        .await
        .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(PasswordPolicyDto::from(record)))
}

/// Change the workspace password policy. Admin only.
///
/// Applies to the next password anyone sets. Stored passwords cannot be re-checked against a
/// tightened rule — a hash cannot be inspected — so an existing password stays usable until its
/// owner changes it, or until `maxAgeDays` expires it.
#[utoipa::path(
    put,
    path = "/api/v1/admin/password-policy",
    request_body = UpdatePasswordPolicyRequest,
    responses(
        (status = 200, description = "The updated password policy", body = PasswordPolicyDto),
        (status = 400, description = "A value was out of range"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
    ),
    security(("bearer_auth" = [])),
    tag = "password-policy"
)]
#[put("/password-policy")]
async fn update_password_policy(
    state: web::Data<PasswordPolicyState>,
    body: web::Json<UpdatePasswordPolicyRequest>,
    _admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let repo = state.repo.clone();
    let record = web::block(move || {
        repo.update(PasswordPolicyUpdate {
            min_length: body.min_length,
            require_uppercase: body.require_uppercase,
            require_lowercase: body.require_lowercase,
            require_number: body.require_number,
            require_symbol: body.require_symbol,
            max_age_days: body.max_age_days,
            forbidden_characters: body.forbidden_characters,
            lockout_threshold: body.lockout_threshold,
            history_count: body.history_count,
        })
    })
    .await
    .map_err(|_| ApiError::internal("Task error"))??;
    Ok(HttpResponse::Ok().json(PasswordPolicyDto::from(record)))
}

pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(get_password_policy)
        .service(update_password_policy);
}

// ── OpenAPI doc ───────────────────────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(
    paths(get_password_policy, update_password_policy),
    components(schemas(PasswordPolicyDto, UpdatePasswordPolicyRequest)),
    tags((
        name = "password-policy",
        description = "The workspace's password rules — a minimum length, the character classes a password must contain, characters it may not contain, how long one stays valid, how many failed sign-ins lock an account, and how many previous passwords may not be reused. Enforced wherever a password is set; sign-in enforces the age and lockout rules. Admin only."
    )),
    modifiers(&SecurityAddon)
)]
pub struct PasswordPolicyApiDoc;

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

    fn test_state() -> web::Data<PasswordPolicyState> {
        web::Data::new(PasswordPolicyState {
            repo: Arc::new(PasswordPolicyRepository::new(test_pool())),
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
            .uri("/admin/password-policy")
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 401);

        let req = test::TestRequest::get()
            .uri("/admin/password-policy")
            .insert_header(("Authorization", non_admin_bearer(&ts)))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 403);
    }

    #[actix_web::test]
    async fn an_admin_reads_the_seeded_defaults() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let req = test::TestRequest::get()
            .uri("/admin/password-policy")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["minLength"], 8);
        assert_eq!(body["requireSymbol"], false);
        assert_eq!(body["maxAgeDays"], 0);
        assert_eq!(body["forbiddenCharacters"], "");
        assert_eq!(body["lockoutThreshold"], 0);
        assert_eq!(body["historyCount"], 0);
    }

    #[actix_web::test]
    async fn an_admin_tightens_the_policy() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let req = test::TestRequest::put()
            .uri("/admin/password-policy")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(
                r#"{"minLength":14,"requireSymbol":true,"maxAgeDays":90,
                    "forbiddenCharacters":"< > &","lockoutThreshold":5,"historyCount":3}"#,
            )
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["minLength"], 14);
        assert_eq!(body["requireSymbol"], true);
        assert_eq!(body["maxAgeDays"], 90);
        // Stored as the set, whatever separators were typed around it.
        assert_eq!(body["forbiddenCharacters"], "<>&");
        assert_eq!(body["lockoutThreshold"], 5);
        assert_eq!(body["historyCount"], 3);
    }

    #[actix_web::test]
    async fn a_minimum_below_the_floor_is_rejected() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let req = test::TestRequest::put()
            .uri("/admin/password-policy")
            .insert_header(("Authorization", admin_bearer(&ts)))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(r#"{"minLength":4}"#)
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 400);
    }
}
