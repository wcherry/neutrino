use crate::photos::persons::{
    dto::{
        FaceEmbeddingsResponse, ListPersonsResponse, MergePersonsRequest,
        PersonRelationshipsResponse, PersonResponse, PersonTimelineResponse, ReassignFaceRequest,
        RenamePersonRequest, SaveClustersRequest, UsersWithFacesResponse,
    },
    service::PersonsService,
};
use crate::photos::photos::{dto::ListPhotosResponse, service::PhotosService};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct PersonsApiState {
    pub persons_service: Arc<PersonsService>,
    pub photos_service: Arc<PhotosService>,
    pub albums_service: Arc<crate::photos::albums::service::AlbumsService>,
}

/// List all person clusters for the authenticated user.
#[utoipa::path(
    get,
    path = "/api/v1/photos/persons/list",
    responses(
        (status = 200, description = "All person clusters for the user", body = ListPersonsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[get("/photos/persons/list")]
pub async fn list_persons(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListPersonsResponse>, ApiError> {
    let result = state.persons_service.list_persons(&user.user_id)?;
    Ok(web::Json(result))
}

/// Rename a person cluster.
#[utoipa::path(
    patch,
    path = "/api/v1/photos/persons/{personId}",
    params(("personId" = String, Path, description = "Person ID")),
    request_body = RenamePersonRequest,
    responses(
        (status = 200, description = "Person renamed", body = PersonResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[patch("/photos/persons/{personId}")]
pub async fn rename_person(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<RenamePersonRequest>,
) -> Result<web::Json<PersonResponse>, ApiError> {
    let person_id = path.into_inner();
    let result = state
        .persons_service
        .rename_person(&person_id, &user.user_id, body.into_inner())?;
    Ok(web::Json(result))
}

/// Merge another person cluster into this one (source is absorbed and deleted).
#[utoipa::path(
    post,
    path = "/api/v1/photos/persons/{personId}/merge",
    params(("personId" = String, Path, description = "Target person ID")),
    request_body = MergePersonsRequest,
    responses(
        (status = 200, description = "Persons merged", body = PersonResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[post("/photos/persons/{personId}/merge")]
pub async fn merge_persons(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<MergePersonsRequest>,
) -> Result<web::Json<PersonResponse>, ApiError> {
    let target_id = path.into_inner();
    let result = state
        .persons_service
        .merge_persons(&target_id, &user.user_id, body.into_inner())?;
    Ok(web::Json(result))
}

/// Move a face from this person to a different person.
#[utoipa::path(
    patch,
    path = "/api/v1/photos/persons/{personId}/faces/{faceId}",
    params(
        ("personId" = String, Path, description = "Person ID"),
        ("faceId" = String, Path, description = "Face ID"),
    ),
    request_body = ReassignFaceRequest,
    responses(
        (status = 204, description = "Face reassigned"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[patch("/photos/persons/{personId}/faces/{faceId}")]
pub async fn reassign_face(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<ReassignFaceRequest>,
) -> Result<HttpResponse, ApiError> {
    let (person_id, face_id) = path.into_inner();
    state
        .persons_service
        .reassign_face(&person_id, &face_id, &user.user_id, body.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Remove a face from this person (unassigns it; person deleted if now empty).
#[utoipa::path(
    delete,
    path = "/api/v1/photos/persons/{personId}/faces/{faceId}",
    params(
        ("personId" = String, Path, description = "Person ID"),
        ("faceId" = String, Path, description = "Face ID"),
    ),
    responses(
        (status = 204, description = "Face removed from person"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[delete("/photos/persons/{personId}/faces/{faceId}")]
pub async fn remove_face(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (person_id, face_id) = path.into_inner();
    state
        .persons_service
        .remove_face_from_person(&person_id, &face_id, &user.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

/// Get photos for a specific person cluster.
#[utoipa::path(
    get,
    path = "/api/v1/photos/persons/{personId}/photos",
    params(("personId" = String, Path, description = "Person ID")),
    responses(
        (status = 200, description = "Photos containing this person", body = ListPhotosResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[get("/photos/persons/{personId}/photos")]
pub async fn list_person_photos(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListPhotosResponse>, ApiError> {
    let person_id = path.into_inner();
    let photo_ids = state
        .persons_service
        .get_photo_ids_for_person(&person_id, &user.user_id)?;
    let result = state
        .photos_service
        .list_photos_by_ids(&user, &photo_ids)
        .await?;
    Ok(web::Json(result))
}

/// Get photos of a person in chronological timeline groups.
#[utoipa::path(
    get,
    path = "/api/v1/photos/persons/{personId}/timeline",
    params(("personId" = String, Path, description = "Person ID")),
    responses(
        (status = 200, description = "Chronological timeline of person's photos", body = PersonTimelineResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[get("/photos/persons/{personId}/timeline")]
pub async fn get_person_timeline(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<PersonTimelineResponse>, ApiError> {
    let person_id = path.into_inner();
    // Fetch photo IDs for this person.
    let photo_ids = state
        .persons_service
        .get_photo_ids_for_person(&person_id, &user.user_id)?;
    // Resolve photos (including Drive file info) via PhotosService.
    let photos_resp = state
        .photos_service
        .list_photos_by_ids(&user, &photo_ids)
        .await?;
    let result = state
        .persons_service
        .build_timeline(&person_id, &user.user_id, photos_resp.photos)?;
    Ok(web::Json(result))
}

/// Get relationship insights: persons who frequently co-appear in photos.
#[utoipa::path(
    get,
    path = "/api/v1/photos/persons/relationships",
    responses(
        (status = 200, description = "Co-appearance relationship insights", body = PersonRelationshipsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[get("/photos/persons/relationships")]
pub async fn get_person_relationships(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<PersonRelationshipsResponse>, ApiError> {
    let result = state.persons_service.get_relationships(&user.user_id)?;
    Ok(web::Json(result))
}

/// Create or refresh a smart album for a named person.
#[utoipa::path(
    post,
    path = "/api/v1/photos/persons/{personId}/smart-album",
    params(("personId" = String, Path, description = "Person ID")),
    responses(
        (status = 200, description = "Smart album created or refreshed", body = crate::photos::albums::dto::AlbumResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Person not found or has no name"),
    ),
    security(("bearer_auth" = [])),
    tag = "persons"
)]
#[post("/photos/persons/{personId}/smart-album")]
pub async fn create_person_smart_album(
    state: web::Data<PersonsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let person_id = path.into_inner();
    let person = state
        .persons_service
        .get_person_for_user(&person_id, &user.user_id)?;
    let person_name = person
        .name
        .as_deref()
        .unwrap_or("Unknown person");
    let photo_ids = state
        .persons_service
        .get_photo_ids_for_person(&person_id, &user.user_id)?;
    let album = state
        .albums_service
        .upsert_person_smart_album(&user.user_id, &person_id, person_name, &photo_ids)?;
    Ok(HttpResponse::Ok().json(album))
}

// ── Internal endpoints (called by the worker, no JWT) ────────────────────────

/// Return all user_ids that have face embeddings (used by worker to trigger cluster-all).
#[utoipa::path(
    get,
    path = "/api/v1/internal/users-with-faces",
    responses(
        (status = 200, description = "User IDs that have face embeddings", body = UsersWithFacesResponse),
    ),
    tag = "internal"
)]
#[get("/internal/users-with-faces")]
pub async fn list_users_with_faces(
    state: web::Data<PersonsApiState>,
) -> Result<web::Json<UsersWithFacesResponse>, ApiError> {
    let result = state.persons_service.list_users_with_face_embeddings()?;
    Ok(web::Json(result))
}

/// Return all face embeddings for a user so the worker can run clustering.
#[utoipa::path(
    get,
    path = "/api/v1/internal/users/{userId}/face-embeddings",
    params(("userId" = String, Path, description = "User ID")),
    responses(
        (status = 200, description = "Face embeddings for clustering", body = FaceEmbeddingsResponse),
    ),
    tag = "internal"
)]
#[get("/internal/users/{userId}/face-embeddings")]
pub async fn get_face_embeddings(
    state: web::Data<PersonsApiState>,
    path: web::Path<String>,
) -> Result<web::Json<FaceEmbeddingsResponse>, ApiError> {
    let user_id = path.into_inner();
    let result = state.persons_service.get_face_embeddings(&user_id)?;
    Ok(web::Json(result))
}

/// Accept clustering results from the worker and persist persons.
#[utoipa::path(
    post,
    path = "/api/v1/internal/persons/clusters",
    request_body = SaveClustersRequest,
    responses(
        (status = 204, description = "Clusters saved"),
        (status = 400, description = "Invalid request"),
    ),
    tag = "internal"
)]
#[post("/internal/persons/clusters")]
pub async fn save_clusters(
    state: web::Data<PersonsApiState>,
    body: web::Json<SaveClustersRequest>,
) -> Result<HttpResponse, ApiError> {
    state.persons_service.save_clusters(body.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure_persons(cfg: &mut web::ServiceConfig) {
    cfg.service(list_persons)
        .service(get_person_relationships)
        .service(rename_person)
        .service(merge_persons)
        .service(reassign_face)
        .service(remove_face)
        .service(list_person_photos)
        .service(get_person_timeline)
        .service(create_person_smart_album)
        .service(list_users_with_faces)
        .service(get_face_embeddings)
        .service(save_clusters);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_persons,
        rename_person,
        merge_persons,
        reassign_face,
        remove_face,
        list_person_photos,
        get_person_timeline,
        get_person_relationships,
        create_person_smart_album,
        list_users_with_faces,
        get_face_embeddings,
        save_clusters,
    ),
    components(schemas(
        crate::photos::persons::dto::PersonFaceThumbnail,
        PersonResponse,
        ListPersonsResponse,
        RenamePersonRequest,
        MergePersonsRequest,
        ReassignFaceRequest,
        UsersWithFacesResponse,
        crate::photos::persons::dto::FaceEmbeddingEntry,
        FaceEmbeddingsResponse,
        crate::photos::persons::dto::ClusterEntry,
        SaveClustersRequest,
        crate::photos::persons::dto::TimelineGroup,
        PersonTimelineResponse,
        crate::photos::persons::dto::PersonRelationship,
        PersonRelationshipsResponse,
        crate::photos::photos::dto::PhotoResponse,
        crate::photos::photos::dto::ListPhotosResponse,
        crate::photos::albums::dto::AlbumResponse,
    )),
    tags(
        (name = "persons", description = "Face clustering and person management"),
        (name = "internal", description = "Internal worker endpoints"),
    ),
    security(("bearer_auth" = []))
)]
pub struct PersonsApiDoc;
