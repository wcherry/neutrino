use crate::photos::albums::{
    dto::{
        AddPhotoToAlbumRequest, AlbumResponse, CreateAlbumRequest, ListAlbumsResponse,
        UpdateAlbumRequest,
    },
    service::AlbumsService,
};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct AlbumsApiState {
    pub albums_service: Arc<AlbumsService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/albums",
    responses(
        (status = 200, description = "List of albums", body = ListAlbumsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "albums"
)]
#[get("/albums")]
pub async fn list_albums(
    state: web::Data<AlbumsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListAlbumsResponse>, ApiError> {
    let result = state.albums_service.list_albums(&user)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/albums",
    request_body = CreateAlbumRequest,
    responses(
        (status = 201, description = "Album created", body = AlbumResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "albums"
)]
#[post("/albums")]
pub async fn create_album(
    state: web::Data<AlbumsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateAlbumRequest>,
) -> Result<HttpResponse, ApiError> {
    let album = state
        .albums_service
        .create_album(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(album))
}

#[utoipa::path(
    get,
    path = "/api/v1/albums/{id}",
    params(("id" = String, Path, description = "Album ID")),
    responses(
        (status = 200, description = "Album details", body = AlbumResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "albums"
)]
#[get("/albums/{id}")]
pub async fn get_album(
    state: web::Data<AlbumsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<AlbumResponse>, ApiError> {
    let album_id = path.into_inner();
    let album = state.albums_service.get_album(&user, &album_id)?;
    Ok(web::Json(album))
}

#[utoipa::path(
    patch,
    path = "/api/v1/albums/{id}",
    params(("id" = String, Path, description = "Album ID")),
    request_body = UpdateAlbumRequest,
    responses(
        (status = 200, description = "Album updated", body = AlbumResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "albums"
)]
#[patch("/albums/{id}")]
pub async fn update_album(
    state: web::Data<AlbumsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateAlbumRequest>,
) -> Result<web::Json<AlbumResponse>, ApiError> {
    let album_id = path.into_inner();
    let album = state
        .albums_service
        .update_album(&user, &album_id, body.into_inner())?;
    Ok(web::Json(album))
}

#[utoipa::path(
    delete,
    path = "/api/v1/albums/{id}",
    params(("id" = String, Path, description = "Album ID")),
    responses(
        (status = 204, description = "Album deleted"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "albums"
)]
#[delete("/albums/{id}")]
pub async fn delete_album(
    state: web::Data<AlbumsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let album_id = path.into_inner();
    state.albums_service.delete_album(&user, &album_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/albums/{id}/items",
    params(("id" = String, Path, description = "Album ID")),
    request_body = AddPhotoToAlbumRequest,
    responses(
        (status = 204, description = "Photo added to album"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "albums"
)]
#[post("/albums/{id}/items")]
pub async fn add_photo_to_album(
    state: web::Data<AlbumsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<AddPhotoToAlbumRequest>,
) -> Result<HttpResponse, ApiError> {
    let album_id = path.into_inner();
    state
        .albums_service
        .add_photo_to_album(&user, &album_id, body.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    delete,
    path = "/api/v1/albums/{id}/items/{photoId}",
    params(
        ("id" = String, Path, description = "Album ID"),
        ("photoId" = String, Path, description = "Photo ID"),
    ),
    responses(
        (status = 204, description = "Photo removed from album"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "albums"
)]
#[delete("/albums/{id}/items/{photoId}")]
pub async fn remove_photo_from_album(
    state: web::Data<AlbumsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (album_id, photo_id) = path.into_inner();
    state
        .albums_service
        .remove_photo_from_album(&user, &album_id, &photo_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure_albums(cfg: &mut web::ServiceConfig) {
    cfg.service(list_albums)
        .service(create_album)
        .service(get_album)
        .service(update_album)
        .service(delete_album)
        .service(add_photo_to_album)
        .service(remove_photo_from_album);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_albums,
        create_album,
        get_album,
        update_album,
        delete_album,
        add_photo_to_album,
        remove_photo_from_album
    ),
    components(schemas(
        CreateAlbumRequest,
        UpdateAlbumRequest,
        AddPhotoToAlbumRequest,
        AlbumResponse,
        ListAlbumsResponse,
    )),
    tags((name = "albums", description = "Photo albums")),
    security(("bearer_auth" = []))
)]
pub struct AlbumsApiDoc;
