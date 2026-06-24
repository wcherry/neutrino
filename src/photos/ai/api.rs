use super::service::{DetectedObject, PhotosAIService};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{post, web};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub struct PhotosAIState {
    pub ai_service: Arc<PhotosAIService>,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OcrRequest {
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
        .ocr(&body.image_base64, &body.media_type)
        .await?;
    Ok(web::Json(OcrResponse { text }))
}

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
        .screenshot_intelligence(&body.image_base64, &body.media_type, &body.output_type)
        .await?;
    Ok(web::Json(ScreenshotIntelResponse { result }))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetectObjectsRequest {
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
        .detect_objects(&body.image_base64, &body.media_type, &body.target)
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
    paths(ocr, screenshot_intel),
    components(schemas(
        OcrRequest,
        OcrResponse,
        ScreenshotIntelRequest,
        ScreenshotIntelResponse,
    )),
    tags((name = "photos-ai", description = "Photos AI endpoints")),
    security(("bearer_auth" = []))
)]
pub struct PhotosAIApiDoc;
