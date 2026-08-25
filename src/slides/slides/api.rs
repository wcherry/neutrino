//! Slide theme endpoints.
//!
//! Presentation CRUD is served by the generic drive file endpoints now — a
//! presentation is a Drive file with `application/x-neutrino-slide` as its
//! mime type. Themes are user-owned records rather than files, so they keep
//! their own endpoints here.

use crate::shared::{ApiError, AuthenticatedUser};
use crate::slides::slides::{
    dto::{
        CreateThemeRequest, ListThemesResponse, ThemeResponse, UpdateThemeRequest,
    },
    service::SlidesService,
};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct SlidesApiState {
    pub slides_service: Arc<SlidesService>,
}

/// List the caller's presentation themes.
///
/// Slide themes are per user and separate from the app-shell themes under `/api/v1/themes`.
#[utoipa::path(
    get,
    path = "/api/v1/slides/themes",
    responses(
        (status = 200, description = "List of user themes", body = ListThemesResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[get("/slides/themes")]
pub async fn list_themes(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListThemesResponse>, ApiError> {
    let result = state.slides_service.list_themes(&user)?;
    Ok(web::Json(result))
}

/// Create a presentation theme.
///
/// Takes a name plus primary, background, text and accent colours, each validated as a hex
/// colour literal.
#[utoipa::path(
    post,
    path = "/api/v1/slides/themes",
    request_body = CreateThemeRequest,
    responses(
        (status = 201, description = "Theme created", body = ThemeResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[post("/slides/themes")]
pub async fn create_theme(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateThemeRequest>,
) -> Result<HttpResponse, ApiError> {
    let theme = state
        .slides_service
        .create_theme(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(theme))
}

/// Update a presentation theme the caller owns.
///
/// Patches the supplied fields; colours are validated the same way as on create. Another user's
/// theme is a 404.
#[utoipa::path(
    patch,
    path = "/api/v1/slides/themes/{id}",
    params(("id" = String, Path, description = "Theme ID")),
    request_body = UpdateThemeRequest,
    responses(
        (status = 200, description = "Theme updated", body = ThemeResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[patch("/slides/themes/{id}")]
pub async fn update_theme(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateThemeRequest>,
) -> Result<web::Json<ThemeResponse>, ApiError> {
    let theme_id = path.into_inner();
    let theme = state
        .slides_service
        .update_theme(&user, &theme_id, body.into_inner())?;
    Ok(web::Json(theme))
}

/// Delete a presentation theme the caller owns.
///
/// Presentations already using it keep the colours baked into their own content.
#[utoipa::path(
    delete,
    path = "/api/v1/slides/themes/{id}",
    params(("id" = String, Path, description = "Theme ID")),
    responses(
        (status = 204, description = "Theme deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[delete("/slides/themes/{id}")]
pub async fn delete_theme(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let theme_id = path.into_inner();
    state.slides_service.delete_theme(&user, &theme_id)?;
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
    components(schemas(
        CreateThemeRequest,
        UpdateThemeRequest,
        ThemeResponse,
        ListThemesResponse,
    )),
    tags((
        name = "slides",
        description = "Colour themes for presentations — a name plus primary, background, text and accent colours, owned by one user and validated as hex literals. Slide content itself is a Drive file, so this covers only the reusable look applied to it, and is separate from the app-shell themes under /api/v1/themes."
    )),
    security(("bearer_auth" = []))
)]
pub struct SlidesApiDoc;
