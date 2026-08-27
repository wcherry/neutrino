use super::service::{DetectedObject, PhotosAIService};
use crate::shared::{AiCredentials, ApiError, AuthenticatedUser};
use actix_web::{post, web};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub struct PhotosAIState {
    pub ai_service: Arc<PhotosAIService>,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OcrRequest {
    /// The provider and key from Settings → AI Assistant.
    #[serde(flatten)]
    pub credentials: AiCredentials,
    /// Base64-encoded image data (no data-URL prefix).
    pub image_base64: String,
    /// MIME type, e.g. "image/png" or "image/jpeg".
    #[serde(default = "default_media_type")]
    pub media_type: String,
}

fn default_media_type() -> String {
    "image/png".to_string()
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OcrResponse {
    pub text: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotIntelRequest {
    /// The provider and key from Settings → AI Assistant.
    #[serde(flatten)]
    pub credentials: AiCredentials,
    pub image_base64: String,
    #[serde(default = "default_media_type")]
    pub media_type: String,
    /// "table" | "document" | "diagram"
    pub output_type: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotIntelResponse {
    pub result: String,
}

/// Extract the text visible in an image.
///
/// Takes the image as base64 with its media type and returns the text, keeping line breaks and
/// structure where it can.
#[utoipa::path(
    post,
    path = "/api/v1/photos/ai/ocr",
    request_body = OcrRequest,
    responses(
        (status = 200, description = "Extracted text", body = OcrResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos-ai"
)]
#[post("/photos/ai/ocr")]
async fn ocr(
    state: web::Data<PhotosAIState>,
    _user: AuthenticatedUser,
    body: web::Json<OcrRequest>,
) -> Result<web::Json<OcrResponse>, ApiError> {
    let body = body.into_inner();
    let text = state
        .ai_service
        .ocr(&body.credentials, &body.image_base64, &body.media_type)
        .await?;
    Ok(web::Json(OcrResponse { text }))
}

/// Turn a screenshot into structured Markdown.
///
/// The `outputType` picks the shape: a Markdown table, a clean Markdown document, or a Mermaid
/// diagram of the structure shown.
#[utoipa::path(
    post,
    path = "/api/v1/photos/ai/screenshot-intel",
    request_body = ScreenshotIntelRequest,
    responses(
        (status = 200, description = "Converted content", body = ScreenshotIntelResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos-ai"
)]
#[post("/photos/ai/screenshot-intel")]
async fn screenshot_intel(
    state: web::Data<PhotosAIState>,
    _user: AuthenticatedUser,
    body: web::Json<ScreenshotIntelRequest>,
) -> Result<web::Json<ScreenshotIntelResponse>, ApiError> {
    let body = body.into_inner();
    let result = state
        .ai_service
        .screenshot_intelligence(
            &body.credentials,
            &body.image_base64,
            &body.media_type,
            &body.output_type,
        )
        .await?;
    Ok(web::Json(ScreenshotIntelResponse { result }))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetectObjectsRequest {
    /// The provider and key from Settings → AI Assistant.
    #[serde(flatten)]
    pub credentials: AiCredentials,
    pub image_base64: String,
    #[serde(default = "default_media_type")]
    pub media_type: String,
    /// "people" | "power_lines" | "cars" | "clutter"
    pub target: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetectedObjectDto {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub label: String,
}

impl From<DetectedObject> for DetectedObjectDto {
    fn from(o: DetectedObject) -> Self {
        Self { x: o.x, y: o.y, w: o.w, h: o.h, label: o.label }
    }
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetectObjectsResponse {
    pub objects: Vec<DetectedObjectDto>,
}

/// Locate objects of a given kind in an image.
///
/// Returns bounding boxes for the requested target — people, cars, power lines or background
/// clutter — which is what the cleanup and redaction tools work from.
#[utoipa::path(
    post,
    path = "/api/v1/photos/ai/detect-objects",
    request_body = DetectObjectsRequest,
    responses(
        (status = 200, description = "Detected objects with bounding boxes", body = DetectObjectsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos-ai"
)]
#[post("/photos/ai/detect-objects")]
async fn detect_objects(
    state: web::Data<PhotosAIState>,
    _user: AuthenticatedUser,
    body: web::Json<DetectObjectsRequest>,
) -> Result<web::Json<DetectObjectsResponse>, ApiError> {
    let body = body.into_inner();
    let objects = state
        .ai_service
        .detect_objects(
            &body.credentials,
            &body.image_base64,
            &body.media_type,
            &body.target,
        )
        .await?;
    Ok(web::Json(DetectObjectsResponse {
        objects: objects.into_iter().map(DetectedObjectDto::from).collect(),
    }))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(ocr).service(screenshot_intel).service(detect_objects);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(ocr, screenshot_intel, detect_objects),
    components(schemas(
        OcrRequest,
        OcrResponse,
        ScreenshotIntelRequest,
        ScreenshotIntelResponse,
        DetectObjectsRequest,
        DetectedObjectDto,
        DetectObjectsResponse,
        AiCredentials,
    )),
    tags((
        name = "photos-ai",
        description = "Vision applied to a single image the client uploads inline as base64: reading its text, converting a screenshot into a Markdown table, document or Mermaid diagram, and locating objects such as people or power lines with bounding boxes. Nothing is stored — the image is sent with the request and the result is returned — and each request carries the provider and API key set in Settings → AI Assistant."
    )),
    security(("bearer_auth" = []))
)]
pub struct PhotosAIApiDoc;
