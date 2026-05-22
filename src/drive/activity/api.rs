use crate::drive::activity::service::ActivityService;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, web, HttpResponse};
use std::sync::Arc;

pub struct ActivityApiState {
    pub activity_service: Arc<ActivityService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/activity",
    params(
        ("id" = String, Path, description = "File ID"),
        ("page" = Option<i64>, Query, description = "Page number"),
        ("pageSize" = Option<i64>, Query, description = "Items per page"),
    ),
    responses(
        (status = 200, description = "File activity log"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-activity"
)]
#[get("/files/{id}/activity")]
pub async fn list_file_activity(
    state: web::Data<ActivityApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let page = query.get("page").and_then(|p| p.parse().ok());
    let page_size = query.get("pageSize").and_then(|p| p.parse().ok());
    let result = state.activity_service.list_file_activity(&user, &file_id, page, page_size)?;
    Ok(HttpResponse::Ok().json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_file_activity);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(list_file_activity),
    tags((name = "drive-activity", description = "Drive file activity endpoints")),
    security(("bearer_auth" = []))
)]
pub struct ActivityApiDoc;
