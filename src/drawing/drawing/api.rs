use crate::drawing::drawing::{
    dto::{
        CreateDrawingRequest, DrawingMetaResponse, DrawingResponse, ListDrawingsResponse,
        SaveDrawingRequest,
    },
    service::DrawingService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_multipart::Multipart;
use actix_web::{get, patch, post, put, web, HttpResponse};
use futures_util::StreamExt;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct DrawingApiState {
    pub drawing_service: Arc<DrawingService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/drawing",
    responses(
        (status = 200, description = "List of drawings", body = ListDrawingsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drawing"
)]
#[get("/drawing")]
pub async fn list_drawings(
    state: web::Data<DrawingApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListDrawingsResponse>, ApiError> {
    let result = state.drawing_service.list_drawings(&user).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drawing",
    request_body = CreateDrawingRequest,
    responses(
        (status = 201, description = "Drawing created", body = DrawingResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drawing"
)]
#[post("/drawing")]
pub async fn create_drawing(
    state: web::Data<DrawingApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateDrawingRequest>,
) -> Result<HttpResponse, ApiError> {
    let drawing = state
        .drawing_service
        .create_drawing(&user, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(drawing))
}

#[utoipa::path(
    get,
    path = "/api/v1/drawing/{id}",
    params(
        ("id" = String, Path, description = "Drawing ID")
    ),
    responses(
        (status = 200, description = "Drawing metadata", body = DrawingResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drawing"
)]
#[get("/drawing/{id}")]
pub async fn get_drawing(
    state: web::Data<DrawingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<DrawingResponse>, ApiError> {
    let drawing_id = path.into_inner();
    let drawing = state
        .drawing_service
        .get_drawing(&user, &drawing_id)
        .await?;
    Ok(web::Json(drawing))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drawing/{id}",
    params(
        ("id" = String, Path, description = "Drawing ID")
    ),
    request_body = SaveDrawingRequest,
    responses(
        (status = 200, description = "Drawing saved", body = DrawingMetaResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drawing"
)]
#[patch("/drawing/{id}")]
pub async fn save_drawing(
    state: web::Data<DrawingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SaveDrawingRequest>,
) -> Result<web::Json<DrawingMetaResponse>, ApiError> {
    let drawing_id = path.into_inner();
    let meta = state
        .drawing_service
        .save_drawing(&user, &drawing_id, body.into_inner())
        .await?;
    Ok(web::Json(meta))
}

#[utoipa::path(
    put,
    path = "/api/v1/drawing/{id}/autosave",
    params(("id" = String, Path, description = "Drawing ID")),
    responses(
        (status = 200, description = "Drawing autosaved", body = DrawingMetaResponse),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drawing"
)]
#[put("/drawing/{id}/autosave")]
pub async fn autosave_drawing(
    state: web::Data<DrawingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    mut payload: Multipart,
) -> Result<web::Json<DrawingMetaResponse>, ApiError> {
    let drawing_id = path.into_inner();
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
        .drawing_service
        .autosave(&user, &drawing_id, &bytes, title.as_deref())
        .await?;
    Ok(web::Json(meta))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_drawings)
        .service(create_drawing)
        .service(get_drawing)
        .service(save_drawing)
        .service(autosave_drawing);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_drawings, create_drawing, get_drawing, save_drawing, autosave_drawing),
    components(schemas(
        CreateDrawingRequest,
        SaveDrawingRequest,
        DrawingResponse,
        DrawingMetaResponse,
        ListDrawingsResponse,
    )),
    tags((name = "drawing", description = "Native drawing/whiteboard editor")),
    security(("bearer_auth" = []))
)]
pub struct DrawingApiDoc;
