#![allow(dead_code)]

use crate::drive::irm::service::IrmService;
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
    pub irm_service: Arc<IrmService>,
    pub token_service: Arc<TokenService>,
}

// ── File share link endpoints ─────────────────────────────────────────────────

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

    // Enforce IRM download restriction based on the share link's role
    let restrictions =
        state
            .irm_service
            .get_restrictions("file", &resolved.resource_id, &resolved.role)?;
    if restrictions.restrict_download {
        return Err(ApiError::new(
            403,
            "DOWNLOAD_RESTRICTED",
            "Download is restricted by the file owner's IRM policy",
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

    // Check IRM print/copy restrictions based on the share link's role
    let restrictions =
        state
            .irm_service
            .get_restrictions("file", &resolved.resource_id, &resolved.role)?;

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

    let mut response = named_file.into_response(&req);
    if restrictions.restrict_print_copy {
        let headers = response.headers_mut();
        headers.insert(
            actix_web::http::header::HeaderName::from_static("x-irm-restrict-print"),
            actix_web::http::header::HeaderValue::from_static("true"),
        );
        headers.insert(
            actix_web::http::header::HeaderName::from_static("x-irm-restrict-copy"),
            actix_web::http::header::HeaderValue::from_static("true"),
        );
    }
    Ok(response)
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
    tags((name = "sharing", description = "Link sharing endpoints")),
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
