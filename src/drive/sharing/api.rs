#![allow(dead_code)]

use crate::drive::sharing::{
    dto::{
        GuestSessionResponse, LinkRole, LinkVisibility, ResolvedShareLinkResponse,
        ShareLinkResponse, UpdateShareLinkRequest, UpsertShareLinkRequest,
    },
    service::SharingService,
};
use crate::drive::storage::api::StorageApiState;
use crate::shared::{ApiError, AuthenticatedUser, TokenService};
use actix_files::NamedFile;
use actix_web::{delete, get, patch, post, put, web, HttpRequest, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct SharingApiState {
    pub sharing_service: Arc<SharingService>,
    pub token_service: Arc<TokenService>,
}

// ── File share link endpoints ─────────────────────────────────────────────────

/// Fetch the share link for a file, creating a default one if it has none.
///
/// So the share dialog always has a token to show: a file with no link yet gets one minted at
/// anyone-with-the-link / viewer rather than a 404.
#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{file_id}/share-link",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "Share link", body = ShareLinkResponse),
        (status = 404, description = "No share link exists"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[get("/files/{file_id}/share-link")]
pub async fn get_file_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    Ok(HttpResponse::Ok().json(
        match state
            .sharing_service
            .get_share_link(&user.user_id, "file", &file_id)?
        {
            Some(link) => link,
            // None => Ok(HttpResponse::NotFound().json(serde_json::json!({
            //     "error": { "code": "NOT_FOUND", "message": "No share link exists for this file" }
            // }))),
            None => state.sharing_service.upsert_share_link(
                &user.user_id,
                "file",
                &file_id,
                UpsertShareLinkRequest {
                    visibility: LinkVisibility::AnyoneWithLink,
                    role: LinkRole::Viewer,
                    expires_at: None,
                },
            )?,
        },
    ))
}

/// Create or replace a file's share link settings.
///
/// Sets visibility, the role a visitor gets, and an optional expiry in one call; defaults are
/// anyone-with-the-link and viewer. Owners only.
#[utoipa::path(
    put,
    path = "/api/v1/drive/files/{file_id}/share-link",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = UpsertShareLinkRequest,
    responses(
        (status = 200, description = "Share link created or replaced", body = ShareLinkResponse),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[put("/files/{file_id}/share-link")]
pub async fn upsert_file_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpsertShareLinkRequest>,
) -> Result<web::Json<ShareLinkResponse>, ApiError> {
    let file_id = path.into_inner();
    let link = state.sharing_service.upsert_share_link(
        &user.user_id,
        "file",
        &file_id,
        body.into_inner(),
    )?;
    Ok(web::Json(link))
}

/// Patch a file's existing share link.
///
/// Changes only the supplied fields — visibility, role, expiry or the active flag. Passing
/// `expiresAt: null` removes the expiry, and setting `isActive: false` kills the link without
/// deleting it.
#[utoipa::path(
    patch,
    path = "/api/v1/drive/files/{file_id}/share-link",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = UpdateShareLinkRequest,
    responses(
        (status = 200, description = "Share link updated", body = ShareLinkResponse),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Share link not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[patch("/files/{file_id}/share-link")]
pub async fn update_file_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateShareLinkRequest>,
) -> Result<web::Json<ShareLinkResponse>, ApiError> {
    let file_id = path.into_inner();
    let link = state.sharing_service.update_share_link(
        &user.user_id,
        "file",
        &file_id,
        body.into_inner(),
    )?;
    Ok(web::Json(link))
}

/// Delete a file's share link.
///
/// The token stops resolving immediately. Direct per-user permissions on the file are
/// unaffected.
#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{file_id}/share-link",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 204, description = "Share link removed"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Share link not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[delete("/files/{file_id}/share-link")]
pub async fn delete_file_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    state
        .sharing_service
        .delete_share_link(&user.user_id, "file", &file_id)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Folder share link endpoints ───────────────────────────────────────────────

/// Fetch the share link for a folder, creating a default one if it has none.
///
/// The folder counterpart of the file endpoint, with the same mint-on-first-read behaviour.
#[utoipa::path(
    get,
    path = "/api/v1/drive/folders/{folder_id}/share-link",
    params(("folder_id" = String, Path, description = "Folder ID")),
    responses(
        (status = 200, description = "Share link", body = ShareLinkResponse),
        (status = 404, description = "No share link exists"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[get("/folders/{folder_id}/share-link")]
pub async fn get_folder_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let folder_id = path.into_inner();
    match state
        .sharing_service
        .get_share_link(&user.user_id, "folder", &folder_id)?
    {
        Some(link) => Ok(HttpResponse::Ok().json(link)),
        None => Ok(HttpResponse::NotFound().json(serde_json::json!({
            "error": { "code": "NOT_FOUND", "message": "No share link exists for this folder" }
        }))),
    }
}

/// Create or replace a folder's share link settings.
///
/// A visitor following the link gets the configured role on the folder and, by inheritance,
/// on everything inside it. Owners only.
#[utoipa::path(
    put,
    path = "/api/v1/drive/folders/{folder_id}/share-link",
    params(("folder_id" = String, Path, description = "Folder ID")),
    request_body = UpsertShareLinkRequest,
    responses(
        (status = 200, description = "Share link created or replaced", body = ShareLinkResponse),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[put("/folders/{folder_id}/share-link")]
pub async fn upsert_folder_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpsertShareLinkRequest>,
) -> Result<web::Json<ShareLinkResponse>, ApiError> {
    let folder_id = path.into_inner();
    let link = state.sharing_service.upsert_share_link(
        &user.user_id,
        "folder",
        &folder_id,
        body.into_inner(),
    )?;
    Ok(web::Json(link))
}

/// Patch a folder's existing share link.
///
/// Same partial-update semantics as the file endpoint: null `expiresAt` clears the expiry and
/// `isActive: false` disables the link without deleting it.
#[utoipa::path(
    patch,
    path = "/api/v1/drive/folders/{folder_id}/share-link",
    params(("folder_id" = String, Path, description = "Folder ID")),
    request_body = UpdateShareLinkRequest,
    responses(
        (status = 200, description = "Share link updated", body = ShareLinkResponse),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Share link not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[patch("/folders/{folder_id}/share-link")]
pub async fn update_folder_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateShareLinkRequest>,
) -> Result<web::Json<ShareLinkResponse>, ApiError> {
    let folder_id = path.into_inner();
    let link = state.sharing_service.update_share_link(
        &user.user_id,
        "folder",
        &folder_id,
        body.into_inner(),
    )?;
    Ok(web::Json(link))
}

/// Delete a folder's share link.
///
/// Revokes link access to the folder and its contents; per-user grants stay in place.
#[utoipa::path(
    delete,
    path = "/api/v1/drive/folders/{folder_id}/share-link",
    params(("folder_id" = String, Path, description = "Folder ID")),
    responses(
        (status = 204, description = "Share link removed"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Share link not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "sharing"
)]
#[delete("/folders/{folder_id}/share-link")]
pub async fn delete_folder_share_link(
    state: web::Data<SharingApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let folder_id = path.into_inner();
    state
        .sharing_service
        .delete_share_link(&user.user_id, "folder", &folder_id)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Public resolution endpoint ────────────────────────────────────────────────

/// Resolve a share token into what it points at. Public.
///
/// Unauthenticated, so a visitor can see the resource name, type and the role the link grants
/// before signing in. Returns 404 if the link is unknown or disabled and 410 once it has
/// expired, and flags links a workspace restricts to a single email domain.
#[utoipa::path(
    get,
    path = "/api/v1/share/{token}",
    params(("token" = String, Path, description = "Share link token")),
    responses(
        (status = 200, description = "Resolved share link", body = ResolvedShareLinkResponse),
        (status = 404, description = "Share link not found or disabled"),
        (status = 410, description = "Share link has expired"),
    ),
    tag = "sharing"
)]
#[get("/share/{token}")]
pub async fn resolve_share_link(
    state: web::Data<SharingApiState>,
    path: web::Path<String>,
) -> Result<web::Json<ResolvedShareLinkResponse>, ApiError> {
    let token = path.into_inner();
    let resolved = state.sharing_service.resolve_token(&token)?;
    Ok(web::Json(resolved))
}

/// Download the file behind a share token. Public.
///
/// Needs no account — the token is the credential. Returns 400 if the link points at a folder
/// rather than a file.
#[utoipa::path(
    get,
    path = "/api/v1/share/{token}/download",
    params(("token" = String, Path, description = "Share link token")),
    responses(
        (status = 200, description = "File download"),
        (status = 400, description = "Share link does not point to a file"),
        (status = 404, description = "Share link not found or disabled"),
        (status = 410, description = "Share link has expired"),
    ),
    tag = "sharing"
)]
#[get("/share/{token}/download")]
pub async fn download_shared_file(
    state: web::Data<SharingApiState>,
    storage_state: web::Data<StorageApiState>,
    path: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let token = path.into_inner();
    let resolved = state.sharing_service.resolve_token(&token)?;

    if resolved.resource_type != "file" {
        return Err(ApiError::bad_request(
            "Share link does not reference a file",
        ));
    }

    let (file_path, mime_type, file_name) = storage_state
        .storage_service
        .resolve_file_path_by_id(&resolved.resource_id)?;

    let content_type: mime::Mime = mime_type.parse().unwrap_or(mime::APPLICATION_OCTET_STREAM);

    let disposition = actix_web::http::header::ContentDisposition {
        disposition: actix_web::http::header::DispositionType::Attachment,
        parameters: vec![actix_web::http::header::DispositionParam::Filename(
            file_name,
        )],
    };

    let named_file = NamedFile::open(&file_path)
        .map_err(|e| {
            tracing::error!("Failed to open file {:?}: {:?}", file_path, e);
            ApiError::internal("Failed to serve file")
        })?
        .set_content_type(content_type)
        .set_content_disposition(disposition);

    Ok(named_file.into_response(&req))
}

/// Serve the file behind a share token inline for preview. Public.
///
/// The same bytes as the shared download, with a disposition the browser renders instead of
/// saving.
#[utoipa::path(
    get,
    path = "/api/v1/share/{token}/preview",
    params(("token" = String, Path, description = "Share link token")),
    responses(
        (status = 200, description = "File preview served inline"),
        (status = 400, description = "Share link does not point to a file"),
        (status = 404, description = "Share link not found or disabled"),
        (status = 410, description = "Share link has expired"),
    ),
    tag = "sharing"
)]
#[get("/share/{token}/preview")]
pub async fn preview_shared_file(
    state: web::Data<SharingApiState>,
    storage_state: web::Data<StorageApiState>,
    path: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let token = path.into_inner();
    let resolved = state.sharing_service.resolve_token(&token)?;

    if resolved.resource_type != "file" {
        return Err(ApiError::bad_request(
            "Share link does not reference a file",
        ));
    }

    let (file_path, mime_type, _) = storage_state
        .storage_service
        .resolve_file_path_by_id(&resolved.resource_id)?;

    let content_type: mime::Mime = mime_type.parse().unwrap_or(mime::APPLICATION_OCTET_STREAM);

    let disposition = actix_web::http::header::ContentDisposition {
        disposition: actix_web::http::header::DispositionType::Inline,
        parameters: vec![],
    };

    let named_file = NamedFile::open(&file_path)
        .map_err(|e| {
            tracing::error!("Failed to open file {:?}: {:?}", file_path, e);
            ApiError::internal("Failed to serve file")
        })?
        .set_content_type(content_type)
        .set_content_disposition(disposition);

    Ok(named_file.into_response(&req))
}

pub fn configure_drive(conf: &mut web::ServiceConfig) {
    conf.service(get_file_share_link)
        .service(upsert_file_share_link)
        .service(update_file_share_link)
        .service(delete_file_share_link)
        .service(get_folder_share_link)
        .service(upsert_folder_share_link)
        .service(update_folder_share_link)
        .service(delete_folder_share_link);
}

/// Trade a share token for a short-lived guest access token. Public.
///
/// Gives an unauthenticated visitor a bearer token scoped to the link's role, so the normal
/// APIs work for them without an account. Guest subjects are synthetic, which is why
/// `/auth/me` answers them with a placeholder profile.
#[utoipa::path(
    post,
    path = "/api/v1/share/{token}/session",
    params(("token" = String, Path, description = "Share link token")),
    responses(
        (status = 200, description = "Guest session token", body = GuestSessionResponse),
        (status = 404, description = "Share link not found or disabled"),
        (status = 410, description = "Share link has expired"),
    ),
    tag = "sharing"
)]
#[post("/share/{token}/session")]
pub async fn create_guest_session(
    state: web::Data<SharingApiState>,
    path: web::Path<String>,
) -> Result<web::Json<GuestSessionResponse>, ApiError> {
    let token = path.into_inner();
    let session = state.sharing_service.create_guest_session(&token)?;
    Ok(web::Json(session))
}

pub fn configure_public(conf: &mut web::ServiceConfig) {
    conf.service(resolve_share_link)
        .service(download_shared_file)
        .service(preview_shared_file)
        .service(create_guest_session);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        get_file_share_link,
        upsert_file_share_link,
        update_file_share_link,
        delete_file_share_link,
        get_folder_share_link,
        upsert_folder_share_link,
        update_folder_share_link,
        delete_folder_share_link,
        resolve_share_link,
        download_shared_file,
        preview_shared_file,
        create_guest_session,
    ),
    components(schemas(
        ShareLinkResponse,
        UpsertShareLinkRequest,
        UpdateShareLinkRequest,
        ResolvedShareLinkResponse,
        GuestSessionResponse,
        crate::drive::sharing::dto::LinkVisibility,
        crate::drive::sharing::dto::LinkRole,
    )),
    tags((
        name = "sharing",
        description = "Sharing a file or folder by link rather than by naming a user. A link carries a token, a visibility, the role it grants and an optional expiry, and can be disabled without being deleted. The public endpoints under /api/v1/share/{token} let someone with the token resolve, preview or download the resource, or exchange it for a short-lived guest session that works against the normal APIs."
    )),
    modifiers(&SecurityAddon)
)]
pub struct SharingApiDoc;

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
