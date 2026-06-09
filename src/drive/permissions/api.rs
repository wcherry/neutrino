use crate::drive::permissions::{
    dto::{
        GrantPermissionRequest, ListPermissionsResponse, PermissionResponse,
        TransferOwnershipRequest, UpdatePermissionRequest,
    },
    service::PermissionsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct PermissionsApiState {
    pub permissions_service: Arc<PermissionsService>,
}

// ── Path extractors ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FilePermissionPath {
    file_id: String,
    user_id: String,
}

#[derive(Deserialize)]
struct FolderPermissionPath {
    folder_id: String,
    user_id: String,
}

// ── File permission endpoints ─────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{file_id}/permissions",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "List of permissions", body = ListPermissionsResponse),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[get("/files/{file_id}/permissions")]
pub async fn list_file_permissions(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListPermissionsResponse>, ApiError> {
    let file_id = path.into_inner();
    let result = state
        .permissions_service
        .list_permissions(&user.user_id, "file", &file_id)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{file_id}/permissions",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = GrantPermissionRequest,
    responses(
        (status = 201, description = "Permission granted", body = PermissionResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[post("/files/{file_id}/permissions")]
pub async fn grant_file_permission(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<GrantPermissionRequest>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let perm = state.permissions_service.grant_permission(
        &user.user_id,
        "file",
        &file_id,
        body.into_inner(),
    )?;
    Ok(HttpResponse::Created().json(perm))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drive/files/{file_id}/permissions/{user_id}",
    params(
        ("file_id" = String, Path, description = "File ID"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    request_body = UpdatePermissionRequest,
    responses(
        (status = 200, description = "Permission updated", body = PermissionResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Permission not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[patch("/files/{file_id}/permissions/{user_id}")]
pub async fn update_file_permission(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<FilePermissionPath>,
    body: web::Json<UpdatePermissionRequest>,
) -> Result<web::Json<PermissionResponse>, ApiError> {
    let p = path.into_inner();
    let perm = state.permissions_service.update_permission(
        &user.user_id,
        "file",
        &p.file_id,
        &p.user_id,
        body.into_inner(),
    )?;
    Ok(web::Json(perm))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{file_id}/permissions/{user_id}",
    params(
        ("file_id" = String, Path, description = "File ID"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    responses(
        (status = 204, description = "Permission revoked"),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Permission not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[delete("/files/{file_id}/permissions/{user_id}")]
pub async fn revoke_file_permission(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<FilePermissionPath>,
) -> Result<HttpResponse, ApiError> {
    let p = path.into_inner();
    state
        .permissions_service
        .revoke_permission(&user.user_id, "file", &p.file_id, &p.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{file_id}/transfer-ownership",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = TransferOwnershipRequest,
    responses(
        (status = 204, description = "Ownership transferred"),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[post("/files/{file_id}/transfer-ownership")]
pub async fn transfer_file_ownership(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<TransferOwnershipRequest>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    state.permissions_service.transfer_ownership(
        &user.user_id,
        "file",
        &file_id,
        body.into_inner(),
    )?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Folder permission endpoints ───────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/drive/folders/{folder_id}/permissions",
    params(("folder_id" = String, Path, description = "Folder ID")),
    responses(
        (status = 200, description = "List of permissions", body = ListPermissionsResponse),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Folder not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[get("/folders/{folder_id}/permissions")]
pub async fn list_folder_permissions(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListPermissionsResponse>, ApiError> {
    let folder_id = path.into_inner();
    let result = state
        .permissions_service
        .list_permissions(&user.user_id, "folder", &folder_id)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/folders/{folder_id}/permissions",
    params(("folder_id" = String, Path, description = "Folder ID")),
    request_body = GrantPermissionRequest,
    responses(
        (status = 201, description = "Permission granted", body = PermissionResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[post("/folders/{folder_id}/permissions")]
pub async fn grant_folder_permission(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<GrantPermissionRequest>,
) -> Result<HttpResponse, ApiError> {
    let folder_id = path.into_inner();
    let perm = state.permissions_service.grant_permission(
        &user.user_id,
        "folder",
        &folder_id,
        body.into_inner(),
    )?;
    Ok(HttpResponse::Created().json(perm))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drive/folders/{folder_id}/permissions/{user_id}",
    params(
        ("folder_id" = String, Path, description = "Folder ID"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    request_body = UpdatePermissionRequest,
    responses(
        (status = 200, description = "Permission updated", body = PermissionResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Permission not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[patch("/folders/{folder_id}/permissions/{user_id}")]
pub async fn update_folder_permission(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<FolderPermissionPath>,
    body: web::Json<UpdatePermissionRequest>,
) -> Result<web::Json<PermissionResponse>, ApiError> {
    let p = path.into_inner();
    let perm = state.permissions_service.update_permission(
        &user.user_id,
        "folder",
        &p.folder_id,
        &p.user_id,
        body.into_inner(),
    )?;
    Ok(web::Json(perm))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/folders/{folder_id}/permissions/{user_id}",
    params(
        ("folder_id" = String, Path, description = "Folder ID"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    responses(
        (status = 204, description = "Permission revoked"),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Permission not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[delete("/folders/{folder_id}/permissions/{user_id}")]
pub async fn revoke_folder_permission(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<FolderPermissionPath>,
) -> Result<HttpResponse, ApiError> {
    let p = path.into_inner();
    state.permissions_service.revoke_permission(
        &user.user_id,
        "folder",
        &p.folder_id,
        &p.user_id,
    )?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/folders/{folder_id}/transfer-ownership",
    params(("folder_id" = String, Path, description = "Folder ID")),
    request_body = TransferOwnershipRequest,
    responses(
        (status = 204, description = "Ownership transferred"),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "permissions"
)]
#[post("/folders/{folder_id}/transfer-ownership")]
pub async fn transfer_folder_ownership(
    state: web::Data<PermissionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<TransferOwnershipRequest>,
) -> Result<HttpResponse, ApiError> {
    let folder_id = path.into_inner();
    state.permissions_service.transfer_ownership(
        &user.user_id,
        "folder",
        &folder_id,
        body.into_inner(),
    )?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(list_file_permissions)
        .service(grant_file_permission)
        .service(update_file_permission)
        .service(revoke_file_permission)
        .service(transfer_file_ownership)
        .service(list_folder_permissions)
        .service(grant_folder_permission)
        .service(update_folder_permission)
        .service(revoke_folder_permission)
        .service(transfer_folder_ownership);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_file_permissions,
        grant_file_permission,
        update_file_permission,
        revoke_file_permission,
        transfer_file_ownership,
        list_folder_permissions,
        grant_folder_permission,
        update_folder_permission,
        revoke_folder_permission,
        transfer_folder_ownership,
    ),
    components(schemas(
        ListPermissionsResponse,
        PermissionResponse,
        GrantPermissionRequest,
        UpdatePermissionRequest,
        TransferOwnershipRequest,
        crate::drive::permissions::dto::Role,
    )),
    tags((name = "permissions", description = "Permission management endpoints")),
    modifiers(&SecurityAddon)
)]
pub struct PermissionsApiDoc;

struct SecurityAddon;
impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::HttpBuilder::new()
                        .scheme(utoipa::openapi::security::HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }
}
