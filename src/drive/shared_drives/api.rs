use crate::drive::shared_drives::{dto::*, service::SharedDrivesService};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, web};
use std::sync::Arc;

pub struct SharedDrivesApiState {
    pub service: Arc<SharedDrivesService>,
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

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(web::scope("/shared-drives").service(list_drives));
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(list_drives),
    components(schemas(SharedDriveResponse, SharedDriveListResponse)),
    tags((name = "drive-shared-drives", description = "Shared drives endpoints")),
    security(("bearer_auth" = []))
)]
pub struct SharedDrivesApiDoc;
