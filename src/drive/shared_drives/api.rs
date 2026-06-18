use crate::drive::shared_drives::{dto::*, service::SharedDrivesService};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;

pub struct SharedDrivesApiState {
    pub service: Arc<SharedDrivesService>,
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/shared-drives",
    request_body = CreateSharedDriveRequest,
    responses(
        (status = 200, description = "Shared drive created", body = SharedDriveResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[post("")]
pub async fn create_drive(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateSharedDriveRequest>,
) -> Result<web::Json<SharedDriveResponse>, ApiError> {
    let result = state.service.create(&user, body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/shared-drives",
    responses(
        (status = 200, description = "List of shared drives", body = SharedDriveListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[get("")]
pub async fn list_drives(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<SharedDriveListResponse>, ApiError> {
    let result = state.service.list_for_user(&user)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/shared-drives/{drive_id}",
    params(("drive_id" = String, Path, description = "Shared drive ID")),
    responses(
        (status = 200, description = "Shared drive details", body = SharedDriveResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[get("/{drive_id}")]
pub async fn get_drive(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<SharedDriveResponse>, ApiError> {
    let drive_id = path.into_inner();
    let result = state.service.get_by_id(&user, &drive_id)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drive/shared-drives/{drive_id}",
    params(("drive_id" = String, Path, description = "Shared drive ID")),
    request_body = UpdateSharedDriveRequest,
    responses(
        (status = 200, description = "Shared drive updated", body = SharedDriveResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[patch("/{drive_id}")]
pub async fn update_drive(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateSharedDriveRequest>,
) -> Result<web::Json<SharedDriveResponse>, ApiError> {
    let drive_id = path.into_inner();
    let result = state.service.update(&user, &drive_id, body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/shared-drives/{drive_id}",
    params(("drive_id" = String, Path, description = "Shared drive ID")),
    responses(
        (status = 204, description = "Shared drive deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[delete("/{drive_id}")]
pub async fn delete_drive(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let drive_id = path.into_inner();
    state.service.delete(&user, &drive_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/shared-drives/{drive_id}/members",
    params(("drive_id" = String, Path, description = "Shared drive ID")),
    responses(
        (status = 200, description = "List of drive members", body = MemberListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[get("/{drive_id}/members")]
pub async fn list_members(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<MemberListResponse>, ApiError> {
    let drive_id = path.into_inner();
    let result = state.service.list_members(&user, &drive_id)?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/shared-drives/{drive_id}/members",
    params(("drive_id" = String, Path, description = "Shared drive ID")),
    request_body = AddMemberRequest,
    responses(
        (status = 200, description = "Member added", body = SharedDriveMemberResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[post("/{drive_id}/members")]
pub async fn add_member(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<AddMemberRequest>,
) -> Result<web::Json<SharedDriveMemberResponse>, ApiError> {
    let drive_id = path.into_inner();
    let result = state
        .service
        .add_member(&user, &drive_id, body.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drive/shared-drives/{drive_id}/members/{user_id}",
    params(
        ("drive_id" = String, Path, description = "Shared drive ID"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    request_body = UpdateMemberRoleRequest,
    responses(
        (status = 204, description = "Member role updated"),
        (status = 404, description = "Member not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[patch("/{drive_id}/members/{user_id}")]
pub async fn update_member_role(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateMemberRoleRequest>,
) -> Result<HttpResponse, ApiError> {
    let (drive_id, target_user_id) = path.into_inner();
    state
        .service
        .update_member_role(&user, &drive_id, &target_user_id, body.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/shared-drives/{drive_id}/members/{user_id}",
    params(
        ("drive_id" = String, Path, description = "Shared drive ID"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    responses(
        (status = 204, description = "Member removed"),
        (status = 404, description = "Member not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[delete("/{drive_id}/members/{user_id}")]
pub async fn remove_member(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (drive_id, target_user_id) = path.into_inner();
    state
        .service
        .remove_member(&user, &drive_id, &target_user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/shared-drives/{drive_id}/analytics",
    params(("drive_id" = String, Path, description = "Shared drive ID")),
    responses(
        (status = 200, description = "Drive analytics", body = SharedDriveAnalyticsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-shared-drives"
)]
#[get("/{drive_id}/analytics")]
pub async fn get_analytics(
    state: web::Data<SharedDrivesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<SharedDriveAnalyticsResponse>, ApiError> {
    let drive_id = path.into_inner();
    let result = state.service.get_analytics(&user, &drive_id)?;
    Ok(web::Json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/shared-drives")
            .service(create_drive)
            .service(list_drives)
            .service(get_drive)
            .service(update_drive)
            .service(delete_drive)
            .service(list_members)
            .service(add_member)
            .service(update_member_role)
            .service(remove_member)
            .service(get_analytics),
    );
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        create_drive,
        list_drives,
        get_drive,
        update_drive,
        delete_drive,
        list_members,
        add_member,
        update_member_role,
        remove_member,
        get_analytics,
    ),
    components(schemas(
        CreateSharedDriveRequest,
        UpdateSharedDriveRequest,
        SharedDriveResponse,
        SharedDriveListResponse,
        AddMemberRequest,
        UpdateMemberRoleRequest,
        SharedDriveMemberResponse,
        MemberListResponse,
        ContributorStats,
        SharedDriveAnalyticsResponse,
    )),
    tags((name = "drive-shared-drives", description = "Shared drives endpoints")),
    security(("bearer_auth" = []))
)]
pub struct SharedDrivesApiDoc;
