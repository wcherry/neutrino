use crate::photos::faces::{
    dto::{FaceResponse, ListFacesResponse, SaveFaceRequest},
    service::FacesService,
};
use actix_web::{get, post, web, HttpResponse};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use std::sync::Arc;
use tracing::debug;
use utoipa::OpenApi;

pub struct FacesApiState {
    pub faces_service: Arc<FacesService>,
}

/// List faces detected in a photo.
#[utoipa::path(
    get,
    path = "/api/v1/photos/{photoId}/faces",
    params(("photoId" = String, Path, description = "Photo ID")),
    responses(
        (status = 200, description = "Detected faces for the photo", body = ListFacesResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Photo not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "faces"
)]
#[get("/photos/{photoId}/faces")]
pub async fn list_faces(
    state: web::Data<FacesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListFacesResponse>, ApiError> {
    let photo_id = path.into_inner();
    let result = state.faces_service.list_faces(&photo_id, &user.user_id)?;
    Ok(web::Json(result))
}

/// Worker endpoint — saves a single detected face for a photo.
/// No user auth: called by the background worker after face detection.
#[utoipa::path(
    post,
    path = "/api/v1/photos/{photoId}/faces",
    params(("photoId" = String, Path, description = "Photo ID")),
    request_body = SaveFaceRequest,
    responses(
        (status = 201, description = "Face saved", body = FaceResponse),
        (status = 400, description = "Invalid request"),
        (status = 404, description = "Photo not found"),
    ),
    tag = "faces"
)]
#[post("/photos/{photoId}/faces")]
pub async fn save_face(
    state: web::Data<FacesApiState>,
    path: web::Path<String>,
    body: web::Json<SaveFaceRequest>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    let body = body.into_inner();
    debug!("SAVE_FACE: {:?}", &body);
    let face: FaceResponse = state.faces_service.save_face(&photo_id, body)?;
    Ok(HttpResponse::Created().json(face))
}

pub fn configure_faces(cfg: &mut web::ServiceConfig) {
    cfg.service(list_faces).service(save_face);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_faces, save_face),
    components(schemas(
        crate::photos::faces::dto::FaceBoundingBox,
        FaceResponse,
        ListFacesResponse,
        SaveFaceRequest,
    )),
    tags((name = "faces", description = "Face detection")),
    security(("bearer_auth" = []))
)]
pub struct FacesApiDoc;
