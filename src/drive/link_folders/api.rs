//! `/api/v1/share/folder/...` — the guest side of a folder link (#321).
//!
//! Authenticated by a guest session from `POST /share/{token}/session`, never by an account.
//! Gated by `folderLinkEditing`: off, every route here is a 404.
//!
//! Reading a file's bytes and key needs nothing new: `GET /drive/files/{id}` and
//! `GET /drive/files/{id}/key` already answer a guest through `get_effective_role`. What a guest
//! could not do was list a folder or write into one, because those run as the caller's account.

use crate::drive::filesystem::dto::{
    FileResponse, FolderContentsQuery, FolderContentsResponse, FolderResponse,
};
use crate::drive::link_folders::service::LinkFoldersService;
use crate::drive::storage::api::{receive_upload, StorageApiState};
use crate::drive::storage::dto::FileMetadataResponse;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_multipart::Multipart;
use actix_web::{delete, get, patch, post, web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{OpenApi, ToSchema};

pub struct LinkFoldersApiState {
    pub service: Arc<LinkFoldersService>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkFolderContentsResponse {
    /// The shared folder: the top of what the guest can reach, for breadcrumbs.
    pub root_folder_id: String,
    /// "viewer", "commenter" or "editor".
    pub role: String,
    #[serde(flatten)]
    #[schema(inline)]
    pub contents: FolderContentsResponse,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkCreateFolderRequest {
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkUpdateFileRequest {
    pub name: Option<String>,
    /// Move into this folder; must be inside the link.
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkUpdateFolderRequest {
    pub name: Option<String>,
    /// Move under this folder; must be inside the link and not inside the folder itself.
    pub parent_id: Option<String>,
}

/// List a folder inside the link.
#[utoipa::path(
    get,
    path = "/api/v1/share/folder/{folder_id}",
    params(("folder_id" = String, Path, description = "The shared folder or one below it")),
    responses(
        (status = 200, description = "Folder contents", body = LinkFolderContentsResponse),
        (status = 401, description = "No live guest session"),
        (status = 404, description = "Not inside the link, or the feature is off"),
    ),
    security(("bearer_auth" = [])),
    tag = "link-folders"
)]
#[get("/share/folder/{folder_id}")]
pub async fn get_link_folder(
    state: web::Data<LinkFoldersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    query: web::Query<FolderContentsQuery>,
) -> Result<web::Json<LinkFolderContentsResponse>, ApiError> {
    let (scope, contents) = state
        .service
        .contents(&user.user_id, &path.into_inner(), &query)?;
    Ok(web::Json(LinkFolderContentsResponse {
        root_folder_id: scope.root_folder_id,
        role: scope.role,
        contents,
    }))
}

/// Create a folder inside the link. Editor links only.
#[utoipa::path(
    post,
    path = "/api/v1/share/folder/{folder_id}/folders",
    params(("folder_id" = String, Path, description = "Parent folder, inside the link")),
    request_body = LinkCreateFolderRequest,
    responses(
        (status = 200, description = "Created", body = FolderResponse),
        (status = 403, description = "View-only link"),
        (status = 404, description = "Not inside the link, or the feature is off"),
    ),
    security(("bearer_auth" = [])),
    tag = "link-folders"
)]
#[post("/share/folder/{folder_id}/folders")]
pub async fn create_link_folder(
    state: web::Data<LinkFoldersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<LinkCreateFolderRequest>,
) -> Result<web::Json<FolderResponse>, ApiError> {
    let folder = state
        .service
        .create_folder(&user.user_id, &path.into_inner(), body.into_inner().name)
        .await?;
    Ok(web::Json(folder))
}

/// Upload a file into the link, as multipart form data. Editor links only.
///
/// The same form as `POST /drive/files/upload`, and `folder_id` is required and must be inside the
/// link. The file is stored in, and charged to, the folder owner's Drive.
/// `encrypted_file_key`/`key_version` must be the DEK sealed to the **owner's** public key (from
/// `GET /drive/folders/{id}/key-recipients`); seal it to the link afterwards with
/// `POST /drive/files/{id}/key/share`.
#[utoipa::path(
    post,
    path = "/api/v1/share/folder/upload",
    responses(
        (status = 200, description = "Uploaded", body = FileMetadataResponse),
        (status = 403, description = "View-only link"),
        (status = 404, description = "Folder not inside the link, or the feature is off"),
        (status = 413, description = "Too large, or the owner's quota is full"),
    ),
    security(("bearer_auth" = [])),
    tag = "link-folders"
)]
#[post("/share/folder/upload")]
pub async fn upload_to_link_folder(
    state: web::Data<LinkFoldersApiState>,
    storage: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    payload: Multipart,
) -> Result<web::Json<FileMetadataResponse>, ApiError> {
    let scope = state.service.upload_scope(&user.user_id)?;
    let service = state.service.clone();
    let check_scope = scope.clone();
    let file = receive_upload(
        &storage,
        &scope.owner(),
        payload,
        move |folder| match folder {
            Some(f) => service.require_folder(&check_scope, f),
            None => Err(ApiError::bad_request("folder_id is required")),
        },
    )
    .await?;
    Ok(web::Json(file))
}

/// Rename a file and/or move it within the link. Editor links only.
#[utoipa::path(
    patch,
    path = "/api/v1/share/files/{file_id}",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = LinkUpdateFileRequest,
    responses(
        (status = 200, description = "Updated", body = FileResponse),
        (status = 403, description = "View-only link"),
        (status = 404, description = "Not inside the link, or the feature is off"),
    ),
    security(("bearer_auth" = [])),
    tag = "link-folders"
)]
#[patch("/share/files/{file_id}")]
pub async fn update_link_file(
    state: web::Data<LinkFoldersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<LinkUpdateFileRequest>,
) -> Result<web::Json<FileResponse>, ApiError> {
    let body = body.into_inner();
    Ok(web::Json(state.service.update_file(
        &user.user_id,
        &path.into_inner(),
        body.name,
        body.folder_id,
    )?))
}

/// Move a file inside the link to the owner's trash. Editor links only.
#[utoipa::path(
    delete,
    path = "/api/v1/share/files/{file_id}",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 204, description = "Trashed"),
        (status = 403, description = "View-only link"),
        (status = 404, description = "Not inside the link, or the feature is off"),
    ),
    security(("bearer_auth" = [])),
    tag = "link-folders"
)]
#[delete("/share/files/{file_id}")]
pub async fn trash_link_file(
    state: web::Data<LinkFoldersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .service
        .trash_file(&user.user_id, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Rename a folder and/or move it within the link. Not the shared folder itself.
#[utoipa::path(
    patch,
    path = "/api/v1/share/folders/{folder_id}",
    params(("folder_id" = String, Path, description = "Folder ID")),
    request_body = LinkUpdateFolderRequest,
    responses(
        (status = 200, description = "Updated", body = FolderResponse),
        (status = 400, description = "Moving a folder into itself"),
        (status = 403, description = "View-only link, or the shared folder itself"),
        (status = 404, description = "Not inside the link, or the feature is off"),
    ),
    security(("bearer_auth" = [])),
    tag = "link-folders"
)]
#[patch("/share/folders/{folder_id}")]
pub async fn update_link_folder(
    state: web::Data<LinkFoldersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<LinkUpdateFolderRequest>,
) -> Result<web::Json<FolderResponse>, ApiError> {
    let body = body.into_inner();
    Ok(web::Json(state.service.update_folder(
        &user.user_id,
        &path.into_inner(),
        body.name,
        body.parent_id,
    )?))
}

/// Move a folder inside the link to the owner's trash. Not the shared folder itself.
#[utoipa::path(
    delete,
    path = "/api/v1/share/folders/{folder_id}",
    params(("folder_id" = String, Path, description = "Folder ID")),
    responses(
        (status = 204, description = "Trashed"),
        (status = 403, description = "View-only link, or the shared folder itself"),
        (status = 404, description = "Not inside the link, or the feature is off"),
    ),
    security(("bearer_auth" = [])),
    tag = "link-folders"
)]
#[delete("/share/folders/{folder_id}")]
pub async fn trash_link_folder(
    state: web::Data<LinkFoldersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .service
        .trash_folder(&user.user_id, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Registered ahead of the public `/share/{token}/...` routes. `GET /share/{token}/preview` would
/// otherwise also match `GET /share/folder/preview`; registered first, the literal `folder`
/// segment wins, and no token is ever the word `folder` (tokens are 32 hex characters).
pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(upload_to_link_folder)
        .service(get_link_folder)
        .service(create_link_folder)
        .service(update_link_file)
        .service(trash_link_file)
        .service(update_link_folder)
        .service(trash_link_folder);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        get_link_folder,
        create_link_folder,
        upload_to_link_folder,
        update_link_file,
        trash_link_file,
        update_link_folder,
        trash_link_folder,
    ),
    components(schemas(
        LinkFolderContentsResponse,
        LinkCreateFolderRequest,
        LinkUpdateFileRequest,
        LinkUpdateFolderRequest,
    )),
    tags((
        name = "link-folders",
        description = "What someone holding a folder link can do inside it, with a guest session from POST /share/{token}/session. Everything runs as the folder's owner and is confined to the shared folder. Gated by the folderLinkEditing flag."
    ))
)]
pub struct LinkFoldersApiDoc;
