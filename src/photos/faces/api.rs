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

/// List the faces detected in a photo.
///
/// Each face carries its bounding box and the person it has been assigned to, if any — what the
/// viewer draws its face boxes from.
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

/// Save one detected face for a photo. Worker endpoint.
///
/// Called once per face after a detection job runs, carrying the bounding box and the embedding
/// that clustering later groups people by. No user auth — this is a service-to-service call.
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

/// Request face detection for a photo.
///
/// Enqueues a worker job and returns 202 immediately rather than blocking — the detected faces
/// appear through the list endpoints once the worker has run.
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

/// List every face detected across the caller's library.
///
/// The whole set in one call, unassigned faces included, which is what the people-management
/// screens work from.
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

/// Assign a face to a person, or correct its bounding box.
///
/// Assigning by hand is also how a user overrides what clustering decided.
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
///
/// Removes a false positive so it stops appearing on the photo and in clustering. The photo
/// itself is untouched.
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
    tags((
        name = "faces",
        description = "Individual faces detected inside photos: their bounding boxes, the embedding used to group them, and which person each is assigned to. Detection runs as a background worker job that posts its results back here, and a user can correct a box, reassign a face or delete a false positive by hand."
    )),
    security(("bearer_auth" = []))
)]
pub struct FacesApiDoc;
