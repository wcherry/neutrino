use crate::shared::{AiCredentials, ApiError, AuthenticatedUser};
use crate::slides::ai::service::SlidesAIService;
use actix_web::{post, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;

pub struct SlidesAIApiState {
    pub ai_service: Arc<SlidesAIService>,
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmartComposeRequest {
    /// The provider and key from Settings → AI Assistant.
    #[serde(flatten)]
    pub credentials: AiCredentials,
    pub slide_text: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImageSearchRequest {
    pub query: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DesignRequest {
    /// The provider and key from Settings → AI Assistant.
    #[serde(flatten)]
    pub credentials: AiCredentials,
    pub slide_content: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoFormatRequest {
    /// The provider and key from Settings → AI Assistant.
    #[serde(flatten)]
    pub credentials: AiCredentials,
    pub slide_json: String,
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/// Complete or tighten the text on a slide.
///
/// Sends the slide's text to the caller's configured provider and returns an improved version.
/// The provider and key come with the request, from Settings → AI Assistant.
#[utoipa::path(
    post,
    path = "/api/v1/slides/{id}/ai/complete",
    params(("id" = String, Path, description = "Presentation ID")),
    request_body = SmartComposeRequest,
    responses(
        (status = 200, description = "AI-completed slide text"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides-ai"
)]
#[post("/slides/{id}/ai/complete")]
pub async fn smart_compose(
    state: web::Data<SlidesAIApiState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<SmartComposeRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();

    let completed = state
        .ai_service
        .smart_compose(&req.credentials, &req.slide_text)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "text": completed })))
}

/// Find images in the caller's Drive to put on a slide.
///
/// Searches Drive by name for image files rather than the public web, and degrades to an empty
/// result list if Drive is unreachable instead of failing the request.
#[utoipa::path(
    post,
    path = "/api/v1/slides/{id}/ai/image-search",
    params(("id" = String, Path, description = "Presentation ID")),
    request_body = ImageSearchRequest,
    responses(
        (status = 200, description = "Image search results"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides-ai"
)]
#[post("/slides/{id}/ai/image-search")]
pub async fn image_search(
    state: web::Data<SlidesAIApiState>,
    user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<ImageSearchRequest>,
) -> Result<HttpResponse, ApiError> {
    let query_req = body.into_inner();

    let results = state
        .ai_service
        .search_images(&query_req.query, &user.token)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "images": results })))
}

/// Suggest a layout for a slide.
///
/// Returns a layout name, a colour scheme, font suggestions and a list of tips. The provider and
/// key come with the request, from Settings → AI Assistant.
#[utoipa::path(
    post,
    path = "/api/v1/slides/{id}/ai/design",
    params(("id" = String, Path, description = "Presentation ID")),
    request_body = DesignRequest,
    responses(
        (status = 200, description = "AI design suggestions"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides-ai"
)]
#[post("/slides/{id}/ai/design")]
pub async fn help_design(
    state: web::Data<SlidesAIApiState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<DesignRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();

    let result = state
        .ai_service
        .help_design(&req.credentials, &req.slide_content)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(result))
}

/// Rebalance a slide's layout.
///
/// Takes the slide's JSON and returns the same structure with element positions, sizes and text
/// scales adjusted for spacing and visual hierarchy.
#[utoipa::path(
    post,
    path = "/api/v1/slides/{id}/ai/autoformat",
    params(("id" = String, Path, description = "Presentation ID")),
    request_body = AutoFormatRequest,
    responses(
        (status = 200, description = "Auto-formatted slide JSON"),
    ),
    security(("bearer_auth" = [])),
    tag = "slides-ai"
)]
#[post("/slides/{id}/ai/autoformat")]
pub async fn auto_format(
    state: web::Data<SlidesAIApiState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<AutoFormatRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();

    let result = state
        .ai_service
        .auto_format(&req.credentials, &req.slide_json)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(smart_compose)
        .service(image_search)
        .service(help_design)
        .service(auto_format);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(smart_compose, image_search, help_design, auto_format),
    components(schemas(
        SmartComposeRequest,
        ImageSearchRequest,
        DesignRequest,
        AutoFormatRequest,
        AiCredentials,
    )),
    tags((
        name = "slides-ai",
        description = "Authoring help for a presentation: completing slide text, suggesting a layout and colour scheme, rebalancing a slide's geometry, and finding images to use. The model-backed routes carry the provider and API key set in Settings → AI Assistant; image search calls no model at all — it reads the caller's own Drive rather than the public web."
    )),
    security(("bearer_auth" = []))
)]
pub struct SlidesAIApiDoc;
