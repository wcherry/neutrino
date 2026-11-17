use std::sync::Arc;

use actix_web::{delete, get, post, web, HttpResponse};
use utoipa::OpenApi;

use super::dto::{
    AppPasswordResponse, CreateAppPasswordRequest, CreatedAppPasswordResponse, ListAppPasswordsResponse,
};
use super::service::AppPasswordsService;
use crate::shared::{ApiError, AuthenticatedUser};

pub struct AppPasswordsApiState {
    pub app_passwords: Arc<AppPasswordsService>,
}

/// List the caller's app passwords.
///
/// Revoked passwords are not listed. The passwords themselves are never returned here.
#[utoipa::path(
    get,
    path = "/api/v1/auth/app-passwords",
    responses((status = 200, description = "The caller's app passwords", body = ListAppPasswordsResponse)),
    security(("bearer_auth" = [])),
    tag = "app-passwords"
)]
#[get("/app-passwords")]
pub async fn list_app_passwords(
    state: web::Data<AppPasswordsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListAppPasswordsResponse>, ApiError> {
    let app_passwords = state.app_passwords.list(&user)?;
    Ok(web::Json(ListAppPasswordsResponse { app_passwords }))
}

/// Create an app password for a calendar or reminders app.
///
/// The response carries the password in the clear; it is shown once and can't be read again.
#[utoipa::path(
    post,
    path = "/api/v1/auth/app-passwords",
    request_body = CreateAppPasswordRequest,
    responses(
        (status = 201, description = "Created; the only time the password is returned", body = CreatedAppPasswordResponse),
        (status = 400, description = "No name, or one too long"),
    ),
    security(("bearer_auth" = [])),
    tag = "app-passwords"
)]
#[post("/app-passwords")]
pub async fn create_app_password(
    state: web::Data<AppPasswordsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateAppPasswordRequest>,
) -> Result<HttpResponse, ApiError> {
    let created = state.app_passwords.create(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(created))
}

/// Revoke an app password. Devices using it are signed out at once.
#[utoipa::path(
    delete,
    path = "/api/v1/auth/app-passwords/{id}",
    params(("id" = String, Path, description = "App password id")),
    responses(
        (status = 204, description = "Revoked"),
        (status = 404, description = "No such app password"),
    ),
    security(("bearer_auth" = [])),
    tag = "app-passwords"
)]
#[delete("/app-passwords/{id}")]
pub async fn revoke_app_password(
    state: web::Data<AppPasswordsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.app_passwords.revoke(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Registered inside the `/auth` scope (`auth::api::configure`): a second `/auth/...` route
/// beside that scope would never be reached.
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_app_passwords)
        .service(create_app_password)
        .service(revoke_app_password);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_app_passwords, create_app_password, revoke_app_password),
    components(schemas(
        AppPasswordResponse,
        ListAppPasswordsResponse,
        CreateAppPasswordRequest,
        CreatedAppPasswordResponse,
    )),
    tags((
        name = "app-passwords",
        description = "Passwords for calendar and reminders apps that sign in to CalDAV (/dav) with the account email. Each is shown once, can be revoked on its own, and never signs in anywhere else."
    )),
    security(("bearer_auth" = []))
)]
pub struct AppPasswordsApiDoc;
