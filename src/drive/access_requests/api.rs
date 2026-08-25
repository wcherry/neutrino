use crate::drive::access_requests::{
    dto::{
        AccessRequestResponse, ApproveAccessRequestRequest, CreateAccessRequestRequest,
        ListAccessRequestsResponse,
    },
    service::AccessRequestsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct AccessRequestsApiState {
    pub service: Arc<AccessRequestsService>,
}

/// Ask the owner of a file for access to it.
///
/// What someone who lands on a file they cannot open sends; the request shows up in the
/// owner's pending list until it is approved or denied.
#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{file_id}/request-access",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = CreateAccessRequestRequest,
    responses(
        (status = 201, description = "Access request created", body = AccessRequestResponse),
        (status = 400, description = "Bad request"),
    ),
    security(("bearer_auth" = [])),
    tag = "access-requests"
)]
#[post("/files/{file_id}/request-access")]
pub async fn request_file_access(
    state: web::Data<AccessRequestsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateAccessRequestRequest>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let result = state.service.create_request(
        &user.user_id,
        &user.email,
        "file",
        &file_id,
        body.into_inner(),
    )?;
    Ok(HttpResponse::Created().json(result))
}

/// Ask the owner of a folder for access to it.
///
/// The folder counterpart of the file request; approving it grants a role that the folder's
/// contents inherit.
#[utoipa::path(
    post,
    path = "/api/v1/drive/folders/{folder_id}/request-access",
    params(("folder_id" = String, Path, description = "Folder ID")),
    request_body = CreateAccessRequestRequest,
    responses(
        (status = 201, description = "Access request created", body = AccessRequestResponse),
        (status = 400, description = "Bad request"),
    ),
    security(("bearer_auth" = [])),
    tag = "access-requests"
)]
#[post("/folders/{folder_id}/request-access")]
pub async fn request_folder_access(
    state: web::Data<AccessRequestsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateAccessRequestRequest>,
) -> Result<HttpResponse, ApiError> {
    let folder_id = path.into_inner();
    let result = state.service.create_request(
        &user.user_id,
        &user.email,
        "folder",
        &folder_id,
        body.into_inner(),
    )?;
    Ok(HttpResponse::Created().json(result))
}

/// List the pending access requests on things the caller owns.
///
/// Only requests still awaiting a decision are returned — approving or denying takes a request
/// off this list.
#[utoipa::path(
    get,
    path = "/api/v1/drive/access-requests",
    responses(
        (status = 200, description = "Pending access requests for owned resources", body = ListAccessRequestsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "access-requests"
)]
#[get("/access-requests")]
pub async fn list_access_requests(
    state: web::Data<AccessRequestsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListAccessRequestsResponse>, ApiError> {
    let result = state.service.list_pending_for_owner(&user.user_id)?;
    Ok(web::Json(result))
}

/// Approve an access request and grant the role it asked for.
///
/// Owners only. Grants the permission and marks the request resolved; a request that has
/// already been decided returns 400.
#[utoipa::path(
    post,
    path = "/api/v1/drive/access-requests/{request_id}/approve",
    params(("request_id" = String, Path, description = "Access request ID")),
    request_body = ApproveAccessRequestRequest,
    responses(
        (status = 200, description = "Access request approved", body = AccessRequestResponse),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Request not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "access-requests"
)]
#[post("/access-requests/{request_id}/approve")]
pub async fn approve_access_request(
    state: web::Data<AccessRequestsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<ApproveAccessRequestRequest>,
) -> Result<web::Json<AccessRequestResponse>, ApiError> {
    let request_id = path.into_inner();
    let result = state
        .service
        .approve_request(&user.user_id, &request_id, body.into_inner())?;
    Ok(web::Json(result))
}

/// Decline an access request.
///
/// Owners only. Marks the request resolved without granting anything, so it stops appearing in
/// the pending list.
#[utoipa::path(
    post,
    path = "/api/v1/drive/access-requests/{request_id}/deny",
    params(("request_id" = String, Path, description = "Access request ID")),
    responses(
        (status = 200, description = "Access request denied", body = AccessRequestResponse),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Request not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "access-requests"
)]
#[post("/access-requests/{request_id}/deny")]
pub async fn deny_access_request(
    state: web::Data<AccessRequestsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<AccessRequestResponse>, ApiError> {
    let request_id = path.into_inner();
    let result = state.service.deny_request(&user.user_id, &request_id)?;
    Ok(web::Json(result))
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(request_file_access)
        .service(request_folder_access)
        .service(list_access_requests)
        .service(approve_access_request)
        .service(deny_access_request);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        request_file_access,
        request_folder_access,
        list_access_requests,
        approve_access_request,
        deny_access_request,
    ),
    components(schemas(
        AccessRequestResponse,
        ListAccessRequestsResponse,
        CreateAccessRequestRequest,
        ApproveAccessRequestRequest,
    )),
    tags((
        name = "access-requests",
        description = "The \"request access\" path for someone who opens a file or folder they cannot see. A request sits pending in the owner's queue until the owner approves it — which grants the role and resolves the request in one step — or denies it."
    )),
    modifiers(&SecurityAddon)
)]
pub struct AccessRequestsApiDoc;

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
