use actix_web::{get, web, HttpResponse};
use crate::shared::{ApiError, AuthenticatedUser};
use super::service::PriorityService;
use std::sync::Arc;

pub struct PriorityApiState {
    pub priority_service: Arc<PriorityService>,
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(quick_access)
        .service(suggested_collaborators)
        .service(suggested_actions);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(quick_access, suggested_collaborators, suggested_actions),
    tags((name = "drive-priority", description = "Drive priority and suggestions endpoints")),
    security(("bearer_auth" = []))
)]
pub struct PriorityApiDoc;

#[utoipa::path(
    get,
    path = "/api/v1/drive/quick-access",
    responses(
        (status = 200, description = "Quick access file list"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-priority"
)]
#[get("/quick-access")]
async fn quick_access(
    state: web::Data<PriorityApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let items = state.priority_service.get_quick_access(&user.user_id, 8)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({"items": items})))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/suggested-collaborators",
    responses(
        (status = 200, description = "Suggested collaborators for new files"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-priority"
)]
#[get("/suggested-collaborators")]
async fn suggested_collaborators(
    state: web::Data<PriorityApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let collabs = state
        .priority_service
        .get_suggested_collaborators(&user.user_id)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({"collaborators": collabs})))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{file_id}/suggested-actions",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "Suggested actions for the file"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-priority"
)]
#[get("/files/{file_id}/suggested-actions")]
async fn suggested_actions(
    state: web::Data<PriorityApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let actions = state
        .priority_service
        .get_suggested_actions(&user.user_id, &file_id)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({"actions": actions})))
}
