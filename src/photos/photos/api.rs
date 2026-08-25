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

/// List the caller's photo library.
///
/// Newest first, excluding trashed photos and — unless `archivedOnly` is set — archived ones.
/// `starredOnly` narrows to favourites, and `personIds`/`excludePersonIds` filter by who appears
/// in the photo, with the included IDs ANDed together.
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

/// Register an already-uploaded Drive file as a photo.
///
/// Photos live in Drive like any other file; this adds the library record that carries starring,
/// archiving, capture date and the extracted metadata. Thumbnailing then happens in the
/// background.
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

/// Fetch one photo's library record.
///
/// Includes its content URL, thumbnail, capture date and — once the worker has run — the
/// extracted image metadata.
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

/// Star or archive a photo.
///
/// Patches only the flags supplied. Archiving hides a photo from the main grid without deleting
/// it.
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

/// Move a photo to the trash.
///
/// A soft delete: the record keeps a `deletedAt` stamp that the clients count down from, and the
/// Drive file is left alone until the photo is purged.
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

/// Restore a trashed photo.
///
/// Clears the deletion stamp and returns the photo to the library.
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

/// List the caller's trashed photos.
///
/// Each one carries the `deletedAt` stamp the client's retention countdown reads.
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

/// Permanently delete every trashed photo.
///
/// Deletes the underlying Drive files as well as the library records, so the bytes and the quota
/// they consumed are actually released. Not recoverable.
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

/// Permanently delete one trashed photo.
///
/// Deletes the Drive file along with the record. The photo must already be in the trash — a live
/// photo returns 400 rather than being destroyed in one step.
#[utoipa::path(
    delete,
    path = "/api/v1/photos/{id}/permanent",
    params(("id" = String, Path, description = "Photo ID")),
    responses(
        (status = 204, description = "Photo permanently deleted"),
        (status = 400, description = "Photo is not in the trash"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "photos"
)]
#[delete("/photos/{id}/permanent")]
pub async fn delete_photo_permanently(
    state: web::Data<PhotosApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let photo_id = path.into_inner();
    state
        .photos_service
        .delete_photo_permanently(&user, &photo_id)?;
    Ok(HttpResponse::NoContent().finish())
}

/// Store extracted image metadata for a photo. Worker endpoint.
///
/// Called service-to-service once the worker has read dimensions and EXIF out of the image, with
/// the metadata as a raw JSON body. Carries no user auth.
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

/// List photos that have GPS coordinates, for the map view.
///
/// Pass `bbox` as `minLat,minLon,maxLat,maxLon` to fetch only what is in view; results are capped
/// at `limit` (500 by default).
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

/// Save non-destructive edits for a photo.
///
/// Stores the adjustment parameters — brightness, contrast, crop, rotation, filter and the rest —
/// rather than a rendered image, so the original is never touched and the edits stay reversible.
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

/// Fetch the saved edits for a photo.
///
/// Returns the adjustment parameters the client re-applies when it opens the editor. A photo
/// that has never been edited returns 404.
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

/// Discard a photo's saved edits.
///
/// Reverts it to the original, since the edits were only ever stored as parameters.
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

/// Fetch "on this day" memories.
///
/// Groups the caller's photos taken on today's month and day in previous years, one group per
/// year.
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

/// Fetch a year-in-review collection.
///
/// Returns a sample of the caller's photos from the requested year, defaulting to the current
/// year.
#[utoipa::path(
    get,
    path = "/api/v1/photos/year-in-review",
    params(
        ("year" = Option<i32>, Query, description = "Year to review (defaults to the current year)"),
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

/// Set the PIN for the locked folder.
///
/// Enables the locked folder and stores a hash of the PIN. Call it again to change the PIN.
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

/// Exchange the locked-folder PIN for a short-lived unlock token.
///
/// The token, not the PIN, is what subsequent access to locked photos presents, so the PIN
/// travels once per session. A wrong PIN is rejected without unlocking anything.
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

/// Move a photo into the locked folder.
///
/// It then stays out of the main grid, searches and albums until the folder is unlocked.
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

/// Move a photo back out of the locked folder.
///
/// The photo returns to the ordinary library views.
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

/// Set whether a photo's GPS data is stripped when it is shared.
///
/// A per-photo location-privacy switch: with `stripGps` on, the coordinates are removed from
/// copies handed out through sharing.
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

/// List photos confirmed to be backed up on the server.
///
/// What the mobile apps read before offering to free up space, so they only delete a local copy
/// the server actually holds.
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
        .service(delete_photo_permanently)
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
        delete_photo_permanently,
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
    tags((
        name = "photos",
        description = "The photo library layered over Drive: the bytes are ordinary Drive files, and a photo record adds capture date, starring, archiving, extracted EXIF and a thumbnail. Deletes are soft and counted down against a retention window before the Drive file goes with them, edits are stored as reversible adjustment parameters rather than rendered images, and a PIN-gated locked folder keeps chosen photos out of every other view."
    )),
    security(("bearer_auth" = []))
)]
pub struct PhotosApiDoc;
