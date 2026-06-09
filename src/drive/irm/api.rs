use crate::drive::irm::{
    dto::{IrmPolicyResponse, SetIrmPolicyRequest},
    service::IrmService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, put, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct IrmApiState {
    pub irm_service: Arc<IrmService>,
}

// ── File IRM endpoints ────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{file_id}/irm",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "IRM policy", body = IrmPolicyResponse),
        (status = 204, description = "No IRM policy set (defaults apply)"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "irm"
)]
#[get("/files/{file_id}/irm")]
pub async fn get_file_irm(
    state: web::Data<IrmApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    match state
        .irm_service
        .get_policy(&user.user_id, "file", &file_id)?
    {
        Some(policy) => Ok(HttpResponse::Ok().json(policy)),
        None => Ok(HttpResponse::NoContent().finish()),
    }
}

#[utoipa::path(
    put,
    path = "/api/v1/drive/files/{file_id}/irm",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = SetIrmPolicyRequest,
    responses(
        (status = 200, description = "IRM policy set", body = IrmPolicyResponse),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "irm"
)]
#[put("/files/{file_id}/irm")]
pub async fn set_file_irm(
    state: web::Data<IrmApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SetIrmPolicyRequest>,
) -> Result<web::Json<IrmPolicyResponse>, ApiError> {
    let file_id = path.into_inner();
    let policy =
        state
            .irm_service
            .set_policy(&user.user_id, "file", &file_id, body.into_inner())?;
    Ok(web::Json(policy))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{file_id}/irm",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 204, description = "IRM policy removed (defaults apply)"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "irm"
)]
#[delete("/files/{file_id}/irm")]
pub async fn delete_file_irm(
    state: web::Data<IrmApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    state
        .irm_service
        .delete_policy(&user.user_id, "file", &file_id)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Folder IRM endpoints ──────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/drive/folders/{folder_id}/irm",
    params(("folder_id" = String, Path, description = "Folder ID")),
    responses(
        (status = 200, description = "IRM policy", body = IrmPolicyResponse),
        (status = 204, description = "No IRM policy set (defaults apply)"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "irm"
)]
#[get("/folders/{folder_id}/irm")]
pub async fn get_folder_irm(
    state: web::Data<IrmApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let folder_id = path.into_inner();
    match state
        .irm_service
        .get_policy(&user.user_id, "folder", &folder_id)?
    {
        Some(policy) => Ok(HttpResponse::Ok().json(policy)),
        None => Ok(HttpResponse::NoContent().finish()),
    }
}

#[utoipa::path(
    put,
    path = "/api/v1/drive/folders/{folder_id}/irm",
    params(("folder_id" = String, Path, description = "Folder ID")),
    request_body = SetIrmPolicyRequest,
    responses(
        (status = 200, description = "IRM policy set", body = IrmPolicyResponse),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "irm"
)]
#[put("/folders/{folder_id}/irm")]
pub async fn set_folder_irm(
    state: web::Data<IrmApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SetIrmPolicyRequest>,
) -> Result<web::Json<IrmPolicyResponse>, ApiError> {
    let folder_id = path.into_inner();
    let policy =
        state
            .irm_service
            .set_policy(&user.user_id, "folder", &folder_id, body.into_inner())?;
    Ok(web::Json(policy))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/folders/{folder_id}/irm",
    params(("folder_id" = String, Path, description = "Folder ID")),
    responses(
        (status = 204, description = "IRM policy removed (defaults apply)"),
        (status = 403, description = "Forbidden"),
    ),
    security(("bearer_auth" = [])),
    tag = "irm"
)]
#[delete("/folders/{folder_id}/irm")]
pub async fn delete_folder_irm(
    state: web::Data<IrmApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let folder_id = path.into_inner();
    state
        .irm_service
        .delete_policy(&user.user_id, "folder", &folder_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(get_file_irm)
        .service(set_file_irm)
        .service(delete_file_irm)
        .service(get_folder_irm)
        .service(set_folder_irm)
        .service(delete_folder_irm);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        get_file_irm, set_file_irm, delete_file_irm,
        get_folder_irm, set_folder_irm, delete_folder_irm,
    ),
    components(schemas(IrmPolicyResponse, SetIrmPolicyRequest)),
    tags((name = "irm", description = "Information Rights Management endpoints")),
    modifiers(&SecurityAddon)
)]
pub struct IrmApiDoc;

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
