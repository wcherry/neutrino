// ── themes::api ───────────────────────────────────────────────────────────────
//
// Mirrors `src/slides/slides/api.rs`'s theme endpoint style (handler
// signatures, `configure()`, `ThemesApiDoc`) and `src/drive/fonts/api.rs`'s
// test style (actix `test::init_service` + `TokenService` bearer tokens for
// different simulated users).

use std::sync::Arc;

use actix_web::{delete, get, patch, post, web, HttpResponse};
use utoipa::OpenApi;

use super::dto::{CreateThemeRequest, ListThemesResponse, ThemeResponse, UpdateThemeRequest};
use super::service::CustomThemesService;
use crate::shared::{ApiError, AuthenticatedUser};

pub struct ThemesApiState {
    pub service: Arc<CustomThemesService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/themes",
    responses(
        (status = 200, description = "List of visible themes (own + others' public)", body = ListThemesResponse),
        (status = 401, description = "Missing or invalid authentication token"),
    ),
    security(("bearer_auth" = [])),
    tag = "themes"
)]
#[get("/themes")]
pub async fn list_themes(
    state: web::Data<ThemesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListThemesResponse>, ApiError> {
    let result = state.service.list_themes(&user)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/themes",
    request_body = CreateThemeRequest,
    responses(
        (status = 201, description = "Theme created", body = ThemeResponse),
        (status = 400, description = "Invalid request (bad name, color scheme, or tokens)"),
        (status = 401, description = "Missing or invalid authentication token"),
    ),
    security(("bearer_auth" = [])),
    tag = "themes"
)]
#[post("/themes")]
pub async fn create_theme(
    state: web::Data<ThemesApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateThemeRequest>,
) -> Result<HttpResponse, ApiError> {
    let theme = state.service.create_theme(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(theme))
}

#[utoipa::path(
    patch,
    path = "/api/v1/themes/{id}",
    params(("id" = String, Path, description = "Theme ID")),
    request_body = UpdateThemeRequest,
    responses(
        (status = 200, description = "Theme updated", body = ThemeResponse),
        (status = 400, description = "Invalid request"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 404, description = "Not found, or not owned by the requesting user"),
    ),
    security(("bearer_auth" = [])),
    tag = "themes"
)]
#[patch("/themes/{id}")]
pub async fn update_theme(
    state: web::Data<ThemesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateThemeRequest>,
) -> Result<web::Json<ThemeResponse>, ApiError> {
    let theme_id = path.into_inner();
    let theme = state
        .service
        .update_theme(&user, &theme_id, body.into_inner())?;
    Ok(web::Json(theme))
}

#[utoipa::path(
    delete,
    path = "/api/v1/themes/{id}",
    params(("id" = String, Path, description = "Theme ID")),
    responses(
        (status = 204, description = "Theme deleted"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 404, description = "Not found, or not owned by the requesting user"),
    ),
    security(("bearer_auth" = [])),
    tag = "themes"
)]
#[delete("/themes/{id}")]
pub async fn delete_theme(
    state: web::Data<ThemesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let theme_id = path.into_inner();
    state.service.delete_theme(&user, &theme_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_themes)
        .service(create_theme)
        .service(update_theme)
        .service(delete_theme);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_themes, create_theme, update_theme, delete_theme),
    components(schemas(CreateThemeRequest, UpdateThemeRequest, ThemeResponse, ListThemesResponse)),
    tags((name = "themes", description = "User-owned custom themes — own+public list, owner-only mutate")),
    security(("bearer_auth" = []))
)]
pub struct ThemesApiDoc;

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};

    use crate::themes::repository::{CustomThemesRepository, DbPool};
    use crate::shared::TokenService;

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

    /// The `custom_themes.user_id` column has a `FOREIGN KEY REFERENCES
    /// users(id)`, enforced by this SQLite build — every simulated user
    /// referenced by a bearer token in these tests needs a matching `users`
    /// row or inserts 500 with a `ForeignKeyViolation`.
    fn insert_user(pool: &DbPool, id: &str, email: &str) {
        use diesel::prelude::*;
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
             VALUES (?, ?, ?, 'hash', datetime('now'), 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(email)
        .bind::<diesel::sql_types::Text, _>(id)
        .execute(&mut conn)
        .expect("insert user");
    }

    fn test_state() -> web::Data<ThemesApiState> {
        let pool = test_pool();
        insert_user(&pool, "user-a", "user-a@example.com");
        insert_user(&pool, "user-b", "user-b@example.com");
        let repo = Arc::new(CustomThemesRepository::new(pool));
        let service = Arc::new(CustomThemesService::new(repo));
        web::Data::new(ThemesApiState { service })
    }

    fn make_token_service() -> Arc<TokenService> {
        Arc::new(TokenService::new("test-secret-for-tests".to_string()))
    }

    fn bearer_for(ts: &TokenService, user_id: &str) -> String {
        let tok = ts
            .generate_access_token(user_id, &format!("{user_id}@example.com"))
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
                    .configure(configure),
            )
            .await
        }};
    }

    fn create_body(name: &str, is_public: bool) -> serde_json::Value {
        serde_json::json!({
            "name": name,
            "colorScheme": "dark",
            "tokens": { "--color-bg": "#111111" },
            "isPublic": is_public
        })
    }

    // ── GET /themes ─────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn list_themes_requires_authentication() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get().uri("/themes").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn list_themes_returns_empty_array_when_none_exist() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = bearer_for(&ts, "user-a");
        let req = test::TestRequest::get()
            .uri("/themes")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert!(body["themes"].as_array().unwrap().is_empty());
    }

    // ── Full ownership round trip ───────────────────────────────────────────

    #[actix_web::test]
    async fn owner_can_create_list_update_and_delete_their_own_theme() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token_a = bearer_for(&ts, "user-a");

        // Create.
        let create_req = test::TestRequest::post()
            .uri("/themes")
            .insert_header(("Authorization", token_a.clone()))
            .set_json(create_body("A's Theme", false))
            .to_request();
        let create_resp = test::call_service(&app, create_req).await;
        assert_eq!(create_resp.status(), 201);
        let created: serde_json::Value = test::read_body_json(create_resp).await;
        assert_eq!(created["name"], "A's Theme");
        assert_eq!(created["isOwner"], true);
        let theme_id = created["id"].as_str().expect("id").to_string();

        // List — owner sees it.
        let list_req = test::TestRequest::get()
            .uri("/themes")
            .insert_header(("Authorization", token_a.clone()))
            .to_request();
        let list_resp = test::call_service(&app, list_req).await;
        let list_body: serde_json::Value = test::read_body_json(list_resp).await;
        let ids: Vec<&str> = list_body["themes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&theme_id.as_str()));

        // Update.
        let update_req = test::TestRequest::patch()
            .uri(&format!("/themes/{}", theme_id))
            .insert_header(("Authorization", token_a.clone()))
            .set_json(serde_json::json!({ "name": "Renamed" }))
            .to_request();
        let update_resp = test::call_service(&app, update_req).await;
        assert_eq!(update_resp.status(), 200);
        let updated: serde_json::Value = test::read_body_json(update_resp).await;
        assert_eq!(updated["name"], "Renamed");

        // Delete.
        let delete_req = test::TestRequest::delete()
            .uri(&format!("/themes/{}", theme_id))
            .insert_header(("Authorization", token_a))
            .to_request();
        let delete_resp = test::call_service(&app, delete_req).await;
        assert_eq!(delete_resp.status(), 204);
    }

    #[actix_web::test]
    async fn non_owner_sees_a_public_theme_in_list_but_gets_404_on_patch_and_delete() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token_a = bearer_for(&ts, "user-a");
        let token_b = bearer_for(&ts, "user-b");

        let create_req = test::TestRequest::post()
            .uri("/themes")
            .insert_header(("Authorization", token_a))
            .set_json(create_body("A's Public Theme", true))
            .to_request();
        let create_resp = test::call_service(&app, create_req).await;
        assert_eq!(create_resp.status(), 201);
        let created: serde_json::Value = test::read_body_json(create_resp).await;
        let theme_id = created["id"].as_str().expect("id").to_string();

        // User B sees it in the list, and is not the owner.
        let list_req = test::TestRequest::get()
            .uri("/themes")
            .insert_header(("Authorization", token_b.clone()))
            .to_request();
        let list_resp = test::call_service(&app, list_req).await;
        assert_eq!(list_resp.status(), 200);
        let list_body: serde_json::Value = test::read_body_json(list_resp).await;
        let seen = list_body["themes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == theme_id)
            .expect("user B should see A's public theme in GET /themes");
        assert_eq!(seen["isOwner"], false);

        // User B cannot PATCH it.
        let update_req = test::TestRequest::patch()
            .uri(&format!("/themes/{}", theme_id))
            .insert_header(("Authorization", token_b.clone()))
            .set_json(serde_json::json!({ "name": "Hijacked" }))
            .to_request();
        let update_resp = test::call_service(&app, update_req).await;
        assert_eq!(update_resp.status(), 404);

        // User B cannot DELETE it.
        let delete_req = test::TestRequest::delete()
            .uri(&format!("/themes/{}", theme_id))
            .insert_header(("Authorization", token_b))
            .to_request();
        let delete_resp = test::call_service(&app, delete_req).await;
        assert_eq!(delete_resp.status(), 404);
    }

    #[actix_web::test]
    async fn non_owner_does_not_see_a_private_theme_in_list_at_all() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token_a = bearer_for(&ts, "user-a");
        let token_b = bearer_for(&ts, "user-b");

        let create_req = test::TestRequest::post()
            .uri("/themes")
            .insert_header(("Authorization", token_a))
            .set_json(create_body("A's Private Theme", false))
            .to_request();
        let create_resp = test::call_service(&app, create_req).await;
        assert_eq!(create_resp.status(), 201);
        let created: serde_json::Value = test::read_body_json(create_resp).await;
        let theme_id = created["id"].as_str().expect("id").to_string();

        let list_req = test::TestRequest::get()
            .uri("/themes")
            .insert_header(("Authorization", token_b))
            .to_request();
        let list_resp = test::call_service(&app, list_req).await;
        let list_body: serde_json::Value = test::read_body_json(list_resp).await;
        let ids: Vec<&str> = list_body["themes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap())
            .collect();
        assert!(!ids.contains(&theme_id.as_str()));
    }
}
