use crate::shared::{ApiError, AuthenticatedUser};
use crate::slides::slides::{
    dto::{
        CreateSlideRequest, ListSlidesResponse, SaveSlideRequest, SlideMetaResponse, SlideResponse,
        CreateThemeRequest, UpdateThemeRequest, ThemeResponse, ListThemesResponse,
    },
    service::SlidesService,
};
use actix_multipart::Multipart;
use actix_web::{delete, get, patch, post, put, web, HttpResponse};
use futures_util::StreamExt;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct SlidesApiState {
    pub slides_service: Arc<SlidesService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/slides",
    responses(
        (status = 200, description = "List of presentations", body = ListSlidesResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[get("/slides")]
pub async fn list_slides(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListSlidesResponse>, ApiError> {
    let result = state.slides_service.list_slides(&user).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/slides",
    request_body = CreateSlideRequest,
    responses(
        (status = 201, description = "Presentation created", body = SlideResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[post("/slides")]
pub async fn create_slide(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateSlideRequest>,
) -> Result<HttpResponse, ApiError> {
    let slide = state.slides_service.create_slide(&user, body.into_inner()).await?;
    Ok(HttpResponse::Created().json(slide))
}

#[utoipa::path(
    get,
    path = "/api/v1/slides/{id}",
    params(
        ("id" = String, Path, description = "Presentation ID")
    ),
    responses(
        (status = 200, description = "Presentation content", body = SlideResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[get("/slides/{id}")]
pub async fn get_slide(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<SlideResponse>, ApiError> {
    let slide_id = path.into_inner();
    let slide = state.slides_service.get_slide(&user, &slide_id).await?;
    Ok(web::Json(slide))
}

#[utoipa::path(
    patch,
    path = "/api/v1/slides/{id}",
    params(
        ("id" = String, Path, description = "Presentation ID")
    ),
    request_body = SaveSlideRequest,
    responses(
        (status = 200, description = "Presentation saved", body = SlideMetaResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[patch("/slides/{id}")]
pub async fn save_slide(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SaveSlideRequest>,
) -> Result<web::Json<SlideMetaResponse>, ApiError> {
    let slide_id = path.into_inner();
    let meta = state
        .slides_service
        .save_slide(&user, &slide_id, body.into_inner())
        .await?;
    Ok(web::Json(meta))
}

// ── Theme endpoints ──────────────────────────────────────────────────────────

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
    let theme = state.slides_service.create_theme(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(theme))
}

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
    let theme = state.slides_service.update_theme(&user, &theme_id, body.into_inner())?;
    Ok(web::Json(theme))
}

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

#[utoipa::path(
    put,
    path = "/api/v1/slides/{id}/autosave",
    params(("id" = String, Path, description = "Presentation ID")),
    responses(
        (status = 200, description = "Presentation autosaved", body = SlideMetaResponse),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides"
)]
#[put("/slides/{id}/autosave")]
pub async fn autosave_slide(
    state: web::Data<SlidesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    mut payload: Multipart,
) -> Result<web::Json<SlideMetaResponse>, ApiError> {
    let slide_id = path.into_inner();
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut title: Option<String> = None;

    while let Some(field) = payload.next().await {
        let mut field = field.map_err(|_| ApiError::bad_request("Invalid multipart data"))?;
        let content_disposition = field.content_disposition().cloned();
        let field_name = content_disposition
            .as_ref()
            .and_then(|cd| cd.get_name())
            .unwrap_or("")
            .to_string();
        let has_filename = content_disposition
            .as_ref()
            .and_then(|cd| cd.get_filename())
            .is_some();

        let mut bytes = Vec::new();
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|_| ApiError::bad_request("Upload interrupted"))?;
            bytes.extend_from_slice(&data);
        }

        if has_filename || field_name == "file" {
            file_bytes = Some(bytes);
        } else if field_name == "metadata" {
            if let Ok(s) = String::from_utf8(bytes) {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&s) {
                    title = meta.get("title").and_then(|v| v.as_str()).map(String::from);
                }
            }
        }
    }

    let bytes = file_bytes.ok_or_else(|| ApiError::bad_request("No file provided"))?;
    let meta = state
        .slides_service
        .autosave(&user, &slide_id, &bytes, title.as_deref())
        .await?;
    Ok(web::Json(meta))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    // Literal-segment routes (/slides/themes) must come before /slides/{id}.
    cfg.service(list_themes)
        .service(create_theme)
        .service(update_theme)
        .service(delete_theme)
        .service(list_slides)
        .service(create_slide)
        .service(get_slide)
        .service(save_slide)
        .service(autosave_slide);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_slides, create_slide, get_slide, save_slide, autosave_slide,
          list_themes, create_theme, update_theme, delete_theme),
    components(schemas(
        CreateSlideRequest,
        SaveSlideRequest,
        SlideResponse,
        SlideMetaResponse,
        ListSlidesResponse,
        CreateThemeRequest,
        UpdateThemeRequest,
        ThemeResponse,
        ListThemesResponse,
    )),
    tags((name = "slides", description = "Native presentation editor")),
    security(("bearer_auth" = []))
)]
pub struct SlidesApiDoc;
