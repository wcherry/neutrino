use crate::photos::photos::{
    dto::{
        BackedUpPhotosResponse, ListPhotosResponse, MemoriesResponse, PhotoEditParams,
        PhotoEditResponse, PhotoResponse, RegisterPhotoRequest, SetupLockedFolderRequest,
        ShareSettingsRequest, UnlockFolderRequest, UnlockTokenResponse, UpdatePhotoRequest,
        YearInReviewResponse,
    },
    service::PhotosService,
};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use actix_web::{delete, get, patch, post, put, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct PhotosApiState {
    pub photos_service: Arc<PhotosService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/photos",
    params(
        ("archivedOnly" = Option<bool>, Query, description = "Include archived photos"),
        ("starredOnly" = Option<bool>, Query, description = "Show only starred photos"),
        ("personIds" = Option<String>, Query, description = "Comma-separated person IDs to filter by (AND logic)"),
        ("excludePersonIds" = Option<String>, Query, description = "Comma-separated person IDs to exclude"),
    ),
    responses(
        (status = 200, description = "List of photos", body = ListPhotosResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos")]
pub async fn list_photos(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<web::Json<ListPhotosResponse>, ApiError> {
    let parse_ids = |key: &str| -> Vec<String> {
        query
            .get(key)
            .map(|v| {
                v.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };

    let person_ids = parse_ids("personIds");
    let exclude_person_ids = parse_ids("excludePersonIds");

    let result = if !person_ids.is_empty() || !exclude_person_ids.is_empty() {
        state
            .photos_service
            .list_photos_by_person_filter(&user, &person_ids, &exclude_person_ids)
            .await?
    } else {
        let include_archived = query
            .get("archivedOnly")
            .map(|v| v == "true")
            .unwrap_or(false);
        let starred_only = query
            .get("starredOnly")
            .map(|v| v == "true")
            .unwrap_or(false);
        state
            .photos_service
            .list_photos(&user, include_archived, starred_only)
            .await?
    };
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/photos",
    request_body = RegisterPhotoRequest,
    responses(
        (status = 201, description = "Photo registered", body = PhotoResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[post("/photos")]
pub async fn register_photo(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    body: web::Json<RegisterPhotoRequest>,
) -> Result<HttpResponse, ApiError> {
    let photo = state
        .photos_service
        .register_photo(&user, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(photo))
}

#[utoipa::path(
    get,
    path = "/api/v1/photos/{id}",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 200, description = "Photo metadata", body = PhotoResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos/{id}")]
pub async fn get_photo(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<PhotoResponse>, ApiError> {
    let photo_id = path.into_inner();
    let photo = state.photos_service.get_photo(&user, &photo_id).await?;
    Ok(web::Json(photo))
}

#[utoipa::path(
    patch,
    path = "/api/v1/photos/{id}",
    params(("id" = String, Path, description = "Photo ID")),
    request_body = UpdatePhotoRequest,
    responses(
        (status = 200, description = "Photo updated", body = PhotoResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[patch("/photos/{id}")]
pub async fn update_photo(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdatePhotoRequest>,
) -> Result<web::Json<PhotoResponse>, ApiError> {
    let photo_id = path.into_inner();
    let photo = state
        .photos_service
        .update_photo(&user, &photo_id, body.into_inner())
        .await?;
    Ok(web::Json(photo))
}

#[utoipa::path(
    delete,
    path = "/api/v1/photos/{id}",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 204, description = "Photo moved to trash"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[delete("/photos/{id}")]
pub async fn trash_photo(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    state.photos_service.trash_photo(&user, &photo_id).await?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/photos/{id}/restore",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 200, description = "Photo restored", body = PhotoResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[post("/photos/{id}/restore")]
pub async fn restore_photo(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<PhotoResponse>, ApiError> {
    let photo_id = path.into_inner();
    let photo = state.photos_service.restore_photo(&user, &photo_id).await?;
    Ok(web::Json(photo))
}

#[utoipa::path(
    get,
    path = "/api/v1/photos/trash",
    responses(
        (status = 200, description = "Trashed photos", body = ListPhotosResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos/trash")]
pub async fn list_trash(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListPhotosResponse>, ApiError> {
    let result = state.photos_service.list_trash(&user).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/photos/trash",
    responses(
        (status = 204, description = "Trash emptied"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[delete("/photos/trash")]
pub async fn empty_trash(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    state.photos_service.empty_trash(&user)?;
    Ok(HttpResponse::NoContent().finish())
}

/// Worker endpoint — stores extracted image metadata for a photo.
/// Accepts a JSON body. No user auth required (worker-to-service call).
#[utoipa::path(
    put,
    path = "/api/v1/photos/{id}/metadata",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 204, description = "Metadata saved"),
        (status = 400, description = "Invalid JSON"),
        (status = 404, description = "Photo not found"),
    ),
    tag = "photos"
)]
#[put("/photos/{id}/metadata")]
pub async fn put_metadata(
    state: web::Data<PhotosApiState>,
    path: web::Path<String>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    let metadata = String::from_utf8(body.to_vec())
        .map_err(|_| ApiError::bad_request("Invalid UTF-8 in metadata body"))?;
    state.photos_service.save_metadata(&photo_id, metadata)?;
    Ok(HttpResponse::NoContent().finish())
}

// ---- 6.7.1 Photo Map ----

#[utoipa::path(
    get,
    path = "/api/v1/photos/map",
    params(
        ("bbox" = Option<String>, Query, description = "Bounding box filter: 'minLat,minLon,maxLat,maxLon'"),
        ("limit" = Option<i64>, Query, description = "Maximum number of results (default 500)"),
    ),
    responses(
        (status = 200, description = "Photos with GPS coordinates", body = PhotoMapResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos/map")]
pub async fn get_photo_map(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let bbox = query.get("bbox").map(|s| s.as_str());
    let limit: i64 = query
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(500);
    let result = state.photos_service.get_photo_map(&user, bbox, limit)?;
    Ok(HttpResponse::Ok().json(result))
}

// ---- 6.7.2 Photo Edits ----

#[utoipa::path(
    put,
    path = "/api/v1/photos/{id}/edits",
    params(("id" = String, Path, description = "Photo ID")),
    request_body = PhotoEditParams,
    responses(
        (status = 200, description = "Edits saved", body = PhotoEditResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[put("/photos/{id}/edits")]
pub async fn put_photo_edits(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<PhotoEditParams>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    let result = state
        .photos_service
        .save_photo_edits(&user, &photo_id, body.into_inner())?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/photos/{id}/edits",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 200, description = "Photo edit parameters", body = PhotoEditResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "No edits found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos/{id}/edits")]
pub async fn get_photo_edits(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    match state.photos_service.get_photo_edits(&user, &photo_id)? {
        Some(edits) => Ok(HttpResponse::Ok().json(edits)),
        None => Err(ApiError::not_found("No edits found for this photo")),
    }
}

#[utoipa::path(
    delete,
    path = "/api/v1/photos/{id}/edits",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 204, description = "Edits deleted"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[delete("/photos/{id}/edits")]
pub async fn delete_photo_edits(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    state.photos_service.delete_photo_edits(&user, &photo_id)?;
    Ok(HttpResponse::NoContent().finish())
}

// ---- 6.7.3 Memories ----

#[utoipa::path(
    get,
    path = "/api/v1/photos/memories",
    responses(
        (status = 200, description = "On-this-day memory groups", body = MemoriesResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos/memories")]
pub async fn get_memories(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let result = state.photos_service.get_memories(&user)?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/photos/year-in-review",
    params(
        ("year" = Option<i32>, Query, description = "Year to review (defaults to most recent year with photos)"),
    ),
    responses(
        (status = 200, description = "Year-in-review photo collection", body = YearInReviewResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos/year-in-review")]
pub async fn get_year_in_review(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let year: Option<i32> = query.get("year").and_then(|v| v.parse().ok());
    let result = state.photos_service.get_year_in_review(&user, year)?;
    Ok(HttpResponse::Ok().json(result))
}

// ---- 6.7.4 Locked Folder ----

#[utoipa::path(
    post,
    path = "/api/v1/photos/locked-folder/setup",
    request_body = SetupLockedFolderRequest,
    responses(
        (status = 204, description = "Locked folder PIN configured"),
        (status = 400, description = "Invalid PIN"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[post("/photos/locked-folder/setup")]
pub async fn setup_locked_folder(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    body: web::Json<SetupLockedFolderRequest>,
) -> Result<HttpResponse, ApiError> {
    state.photos_service.setup_locked_folder(&user, &body.pin)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/photos/locked-folder/unlock",
    request_body = UnlockFolderRequest,
    responses(
        (status = 200, description = "Unlock token issued", body = UnlockTokenResponse),
        (status = 401, description = "Incorrect PIN"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[post("/photos/locked-folder/unlock")]
pub async fn unlock_locked_folder(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    body: web::Json<UnlockFolderRequest>,
) -> Result<HttpResponse, ApiError> {
    let result = state
        .photos_service
        .unlock_locked_folder(&user, &body.pin)?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    put,
    path = "/api/v1/photos/{id}/lock",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 204, description = "Photo locked"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[put("/photos/{id}/lock")]
pub async fn lock_photo_endpoint(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    state.photos_service.lock_photo(&user, &photo_id, true)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    put,
    path = "/api/v1/photos/{id}/unlock-photo",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 204, description = "Photo unlocked"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[put("/photos/{id}/unlock-photo")]
pub async fn unlock_photo_endpoint(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    state.photos_service.lock_photo(&user, &photo_id, false)?;
    Ok(HttpResponse::NoContent().finish())
}

// ---- 6.7.5 Location Privacy ----

#[utoipa::path(
    put,
    path = "/api/v1/photos/{id}/share-settings",
    params(("id" = String, Path, description = "Photo ID")),
    request_body = ShareSettingsRequest,
    responses(
        (status = 204, description = "Share settings updated"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[put("/photos/{id}/share-settings")]
pub async fn update_share_settings(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<ShareSettingsRequest>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    state
        .photos_service
        .update_share_settings(&user, &photo_id, body.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

// ---- 6.7.6 Free Up Space ----

#[utoipa::path(
    get,
    path = "/api/v1/photos/backed-up",
    responses(
        (status = 200, description = "Backed-up photos available for local deletion", body = BackedUpPhotosResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[get("/photos/backed-up")]
pub async fn get_backed_up_photos(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let result = state.photos_service.get_backed_up_photos(&user).await?;
    Ok(HttpResponse::Ok().json(result))
}

pub fn configure_photos(cfg: &mut web::ServiceConfig) {
    cfg.service(list_trash)
        .service(empty_trash)
        .service(get_photo_map)
        .service(get_memories)
        .service(get_year_in_review)
        .service(get_backed_up_photos)
        .service(setup_locked_folder)
        .service(unlock_locked_folder)
        .service(list_photos)
        .service(register_photo)
        .service(get_photo)
        .service(update_photo)
        .service(trash_photo)
        .service(restore_photo)
        .service(put_metadata)
        .service(put_photo_edits)
        .service(get_photo_edits)
        .service(delete_photo_edits)
        .service(lock_photo_endpoint)
        .service(unlock_photo_endpoint)
        .service(update_share_settings);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_photos,
        register_photo,
        get_photo,
        update_photo,
        trash_photo,
        restore_photo,
        list_trash,
        empty_trash,
        put_metadata,
        get_photo_map,
        put_photo_edits,
        get_photo_edits,
        delete_photo_edits,
        get_memories,
        get_year_in_review,
        setup_locked_folder,
        unlock_locked_folder,
        lock_photo_endpoint,
        unlock_photo_endpoint,
        update_share_settings,
        get_backed_up_photos,
    ),
    components(schemas(
        RegisterPhotoRequest,
        UpdatePhotoRequest,
        PhotoResponse,
        ListPhotosResponse,
        crate::photos::photos::dto::MapPhotoItem,
        crate::photos::photos::dto::PhotoMapResponse,
        crate::photos::photos::dto::CropParams,
        PhotoEditParams,
        PhotoEditResponse,
        crate::photos::photos::dto::MemoryPhotoItem,
        crate::photos::photos::dto::MemoryYear,
        MemoriesResponse,
        YearInReviewResponse,
        SetupLockedFolderRequest,
        UnlockFolderRequest,
        UnlockTokenResponse,
        ShareSettingsRequest,
        crate::photos::photos::dto::BackedUpPhotoItem,
        BackedUpPhotosResponse,
    )),
    tags((name = "photos", description = "Media library")),
    security(("bearer_auth" = []))
)]
pub struct PhotosApiDoc;
