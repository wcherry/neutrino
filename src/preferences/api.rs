// ── preferences::api ──────────────────────────────────────────────────────────
//
// Follows `themes::api`'s handler, `configure()` and test style. A successful
// write here is signalled to the user's other devices as `preferences.changed`
// by the drive-events middleware (`shared::drive_events`), on the notification
// socket every tab already holds.

use std::sync::Arc;

use actix_web::{get, patch, put, web};
use utoipa::OpenApi;

use super::dto::{PatchPreferencesRequest, PreferencesResponse, PutVaultRequest, VaultResponse};
use super::service::PreferencesService;
use crate::shared::{ApiError, AuthenticatedUser};

pub struct PreferencesApiState {
    pub service: Arc<PreferencesService>,
}

/// The caller's synced preferences.
///
/// The plain values they have set, keyed as in the preference registry, and their sealed vault
/// if they have one. Keys they never set are absent; the client resolves those to defaults.
#[utoipa::path(
    get,
    path = "/api/v1/preferences",
    responses(
        (status = 200, description = "Synced preferences", body = PreferencesResponse),
        (status = 401, description = "Missing or invalid authentication token"),
    ),
    security(("bearer_auth" = [])),
    tag = "preferences"
)]
#[get("/preferences")]
pub async fn get_preferences(
    state: web::Data<PreferencesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<PreferencesResponse>, ApiError> {
    Ok(web::Json(state.service.get(&user)?))
}

/// Set or clear plain preferences.
///
/// Every key must be a plain-tier key the server declares and every value must match its type;
/// otherwise nothing is written and the response is 400. `null` clears a key back to its default.
#[utoipa::path(
    patch,
    path = "/api/v1/preferences",
    request_body = PatchPreferencesRequest,
    responses(
        (status = 200, description = "Preferences after the change", body = PreferencesResponse),
        (status = 400, description = "Unknown key or invalid value"),
        (status = 401, description = "Missing or invalid authentication token"),
    ),
    security(("bearer_auth" = [])),
    tag = "preferences"
)]
#[patch("/preferences")]
pub async fn patch_preferences(
    state: web::Data<PreferencesApiState>,
    user: AuthenticatedUser,
    body: web::Json<PatchPreferencesRequest>,
) -> Result<web::Json<PreferencesResponse>, ApiError> {
    Ok(web::Json(state.service.patch(&user, body.into_inner())?))
}

/// Replace the sealed vault.
///
/// The blob is ciphertext sealed in the browser to the caller's own public key; the server cannot
/// read it. The write names the version it was based on and is refused with 409 if another
/// device has written since, so neither copy is lost silently.
#[utoipa::path(
    put,
    path = "/api/v1/preferences/vault",
    request_body = PutVaultRequest,
    responses(
        (status = 200, description = "Vault stored", body = VaultResponse),
        (status = 400, description = "Not base64url, or too large"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 409, description = "The vault changed since the version named in the request"),
    ),
    security(("bearer_auth" = [])),
    tag = "preferences"
)]
#[put("/preferences/vault")]
pub async fn put_vault(
    state: web::Data<PreferencesApiState>,
    user: AuthenticatedUser,
    body: web::Json<PutVaultRequest>,
) -> Result<web::Json<VaultResponse>, ApiError> {
    Ok(web::Json(state.service.put_vault(&user, body.into_inner())?))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(get_preferences).service(patch_preferences).service(put_vault);
}

#[derive(OpenApi)]
#[openapi(
    paths(get_preferences, patch_preferences, put_vault),
    components(schemas(PreferencesResponse, VaultResponse, PatchPreferencesRequest, PutVaultRequest)),
    tags((
        name = "preferences",
        description = "A user's synced preferences: plain values the server validates against its catalog (theme, look, density, calendar and editor settings), and one sealed vault for what it must not read (the AI API key, personal libraries). Device-only preferences never reach the server."
    )),
    security(("bearer_auth" = []))
)]
pub struct PreferencesApiDoc;

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};
    use serde_json::json;

    use crate::preferences::repository::{DbPool, PreferencesRepository};
    use crate::shared::TokenService;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel::SqliteConnection;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get().expect("conn").run_pending_migrations(MIGRATIONS).expect("migrations");
        pool
    }

    /// Rows reference `users(id)`; each simulated user needs one or inserts fail on the key.
    fn insert_user(pool: &DbPool, id: &str) {
        use diesel::prelude::*;
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
             VALUES (?, ?, ?, 'hash', datetime('now'), 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(format!("{id}@example.com"))
        .bind::<diesel::sql_types::Text, _>(id)
        .execute(&mut conn)
        .expect("insert user");
    }

    fn test_state() -> web::Data<PreferencesApiState> {
        let pool = test_pool();
        insert_user(&pool, "user-a");
        insert_user(&pool, "user-b");
        let repo = Arc::new(PreferencesRepository::new(pool));
        web::Data::new(PreferencesApiState { service: Arc::new(PreferencesService::new(repo)) })
    }

    fn tokens() -> Arc<TokenService> {
        Arc::new(TokenService::new("test-secret-for-tests".to_string()))
    }

    fn bearer(ts: &TokenService, user: &str) -> String {
        format!("Bearer {}", ts.generate_access_token(user, &format!("{user}@example.com")).expect("token"))
    }

    macro_rules! app {
        ($state:expr, $ts:expr) => {
            test::init_service(App::new().app_data($state).app_data(web::Data::new($ts)).configure(configure)).await
        };
    }

    macro_rules! call {
        ($app:expr, $req:expr) => {{
            let resp = test::call_service(&$app, $req.to_request()).await;
            let status = resp.status().as_u16();
            let body: serde_json::Value = serde_json::from_slice(&test::read_body(resp).await).unwrap_or(json!(null));
            (status, body)
        }};
    }

    #[actix_web::test]
    async fn requires_authentication() {
        let app = app!(test_state(), tokens());
        let (status, _) = call!(app, test::TestRequest::get().uri("/preferences"));
        assert_eq!(status, 401);
    }

    #[actix_web::test]
    async fn starts_empty_and_round_trips_what_is_set() {
        let ts = tokens();
        let app = app!(test_state(), ts.clone());
        let auth = ("Authorization", bearer(&ts, "user-a"));

        let (status, body) = call!(app, test::TestRequest::get().uri("/preferences").insert_header(auth.clone()));
        assert_eq!(status, 200);
        assert_eq!(body, json!({ "values": {}, "vault": null }));

        let (status, body) = call!(
            app,
            test::TestRequest::patch().uri("/preferences").insert_header(auth.clone()).set_json(json!({
                "values": { "appearance.look": "precision", "calendar.weekStart": 1, "docs.spellCheck": false }
            }))
        );
        assert_eq!(status, 200);
        assert_eq!(body["values"]["appearance.look"], "precision");
        assert_eq!(body["values"]["calendar.weekStart"], 1);
        assert_eq!(body["values"]["docs.spellCheck"], false);

        // null clears a key back to its default.
        let (_, body) = call!(
            app,
            test::TestRequest::patch().uri("/preferences").insert_header(auth.clone())
                .set_json(json!({ "values": { "calendar.weekStart": null } }))
        );
        assert!(body["values"].get("calendar.weekStart").is_none());
        assert_eq!(body["values"]["appearance.look"], "precision");
    }

    #[actix_web::test]
    async fn refuses_unknown_keys_invalid_values_and_device_keys_and_writes_nothing() {
        let ts = tokens();
        let app = app!(test_state(), ts.clone());
        let auth = ("Authorization", bearer(&ts, "user-a"));
        for values in [
            json!({ "appearance.look": "neon" }),
            json!({ "calendar.weekStart": 9 }),
            json!({ "made.up": true }),
            // Device-tier and vault-tier keys never belong on the server in the clear.
            json!({ "shell.sidebarCollapsed": true }),
            json!({ "ai.apiKey": "sk-live-…" }),
            // One bad key fails the whole request — no partial writes.
            json!({ "appearance.look": "precision", "appearance.theme": "</style>" }),
        ] {
            let (status, _) = call!(
                app,
                test::TestRequest::patch().uri("/preferences").insert_header(auth.clone()).set_json(json!({ "values": values }))
            );
            assert_eq!(status, 400, "{values}");
        }
        let (_, body) = call!(app, test::TestRequest::get().uri("/preferences").insert_header(auth));
        assert_eq!(body["values"], json!({}));
    }

    #[actix_web::test]
    async fn one_users_preferences_are_invisible_to_another() {
        let ts = tokens();
        let app = app!(test_state(), ts.clone());
        call!(
            app,
            test::TestRequest::patch().uri("/preferences").insert_header(("Authorization", bearer(&ts, "user-a")))
                .set_json(json!({ "values": { "appearance.density": "compact" } }))
        );
        let (_, body) = call!(app, test::TestRequest::get().uri("/preferences").insert_header(("Authorization", bearer(&ts, "user-b"))));
        assert_eq!(body["values"], json!({}));
    }

    #[actix_web::test]
    async fn vault_writes_must_name_the_version_they_were_based_on() {
        let ts = tokens();
        let app = app!(test_state(), ts.clone());
        let auth = ("Authorization", bearer(&ts, "user-a"));
        let put = |blob: &str, base: serde_json::Value| {
            test::TestRequest::put().uri("/preferences/vault").insert_header(auth.clone())
                .set_json(json!({ "blob": blob, "baseUpdatedAt": base }))
        };

        // First write: no vault yet, so the base is null.
        let (status, first) = call!(app, put("c2VhbGVk", json!(null)));
        assert_eq!(status, 200);
        let v1 = first["updatedAt"].as_str().unwrap().to_string();

        // A second device that still thinks there is no vault is refused, not allowed to overwrite.
        let (status, body) = call!(app, put("b3RoZXI", json!(null)));
        assert_eq!(status, 409);
        assert_eq!(body["error"]["code"], "VAULT_CONFLICT");

        // Writing on top of the version it read succeeds and moves the version on.
        let (status, second) = call!(app, put("bmV3ZXI", json!(v1)));
        assert_eq!(status, 200);
        assert_ne!(second["updatedAt"], json!(v1));

        // The stale version is now the conflict.
        let (status, _) = call!(app, put("c3RhbGU", json!(v1)));
        assert_eq!(status, 409);

        let (_, body) = call!(app, test::TestRequest::get().uri("/preferences").insert_header(auth.clone()));
        assert_eq!(body["vault"]["blob"], "bmV3ZXI");
    }

    #[actix_web::test]
    async fn the_vault_only_holds_base64url() {
        let ts = tokens();
        let app = app!(test_state(), ts.clone());
        let (status, _) = call!(
            app,
            test::TestRequest::put().uri("/preferences/vault").insert_header(("Authorization", bearer(&ts, "user-a")))
                .set_json(json!({ "blob": "plaintext secret!", "baseUpdatedAt": null }))
        );
        assert_eq!(status, 400);
    }
}
