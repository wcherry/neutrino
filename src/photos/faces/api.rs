use crate::photos::faces::{
    dto::{
        DetectFacesResponse, FaceResponse, ListFacesResponse, SaveFaceRequest, UpdateFaceRequest,
    },
    service::FacesService,
};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use actix_web::{delete, get, post, put, web, HttpResponse};
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

/// Request background face detection for a photo. Enqueues a worker job.
#[utoipa::path(
    post,
    path = "/api/v1/photos/{photoId}/faces/detect",
    params(("photoId" = String, Path, description = "Photo ID")),
    responses(
        (status = 202, description = "Detection job enqueued", body = DetectFacesResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Photo not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "faces"
)]
#[post("/photos/{photoId}/faces/detect")]
pub async fn detect_faces(
    state: web::Data<FacesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    let resp = state
        .faces_service
        .request_detection(&photo_id, &user.user_id)?;
    Ok(HttpResponse::Accepted().json(resp))
}

/// List every face detected across the user's photos.
#[utoipa::path(
    get,
    path = "/api/v1/faces",
    responses(
        (status = 200, description = "All faces for the user", body = ListFacesResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "faces"
)]
#[get("/faces")]
pub async fn list_all_faces(
    state: web::Data<FacesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListFacesResponse>, ApiError> {
    Ok(web::Json(state.faces_service.list_all_faces(&user.user_id)?))
}

/// Update a face (assign a person or correct its bounding box).
#[utoipa::path(
    put,
    path = "/api/v1/photos/{photoId}/faces/{faceId}",
    params(
        ("photoId" = String, Path, description = "Photo ID"),
        ("faceId" = String, Path, description = "Face ID"),
    ),
    request_body = UpdateFaceRequest,
    responses(
        (status = 200, description = "Updated face", body = FaceResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Face not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "faces"
)]
#[put("/photos/{photoId}/faces/{faceId}")]
pub async fn update_face(
    state: web::Data<FacesApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateFaceRequest>,
) -> Result<web::Json<FaceResponse>, ApiError> {
    let (photo_id, face_id) = path.into_inner();
    let face = state
        .faces_service
        .update_face(&photo_id, &face_id, &user.user_id, body.into_inner())?;
    Ok(web::Json(face))
}

/// Delete a detected face.
#[utoipa::path(
    delete,
    path = "/api/v1/photos/{photoId}/faces/{faceId}",
    params(
        ("photoId" = String, Path, description = "Photo ID"),
        ("faceId" = String, Path, description = "Face ID"),
    ),
    responses(
        (status = 204, description = "Face deleted"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Face not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "faces"
)]
#[delete("/photos/{photoId}/faces/{faceId}")]
pub async fn delete_face(
    state: web::Data<FacesApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (photo_id, face_id) = path.into_inner();
    state
        .faces_service
        .delete_face(&photo_id, &face_id, &user.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure_faces(cfg: &mut web::ServiceConfig) {
    // Register static/more-specific paths before the `{photoId}` catch-alls.
    cfg.service(list_all_faces)
        .service(detect_faces)
        .service(list_faces)
        .service(save_face)
        .service(update_face)
        .service(delete_face);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_faces,
        save_face,
        detect_faces,
        list_all_faces,
        update_face,
        delete_face,
    ),
    components(schemas(
        crate::photos::faces::dto::FaceBoundingBox,
        FaceResponse,
        ListFacesResponse,
        SaveFaceRequest,
        UpdateFaceRequest,
        DetectFacesResponse,
    )),
    tags((name = "faces", description = "Face detection")),
    security(("bearer_auth" = []))
)]
pub struct FacesApiDoc;
