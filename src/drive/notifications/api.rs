use crate::drive::notifications::service::NotificationService;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, post, web, HttpResponse};
use std::sync::Arc;

pub struct NotificationsApiState {
    pub notification_service: Arc<NotificationService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/notifications",
    params(
        ("page" = Option<i64>, Query, description = "Page number"),
        ("pageSize" = Option<i64>, Query, description = "Items per page"),
    ),
    responses(
        (status = 200, description = "List of notifications"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-notifications"
)]
#[get("/notifications")]
pub async fn list_notifications(
    state: web::Data<NotificationsApiState>,
    user: AuthenticatedUser,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let page = query.get("page").and_then(|p| p.parse().ok());
    let page_size = query.get("pageSize").and_then(|p| p.parse().ok());
    let result = state
        .notification_service
        .get_notifications(&user, page, page_size)?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/notifications/{id}/read",
    params(("id" = String, Path, description = "Notification ID")),
    responses(
        (status = 204, description = "Notification marked as read"),
        (status = 404, description = "Notification not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-notifications"
)]
#[post("/notifications/{id}/read")]
pub async fn mark_notification_read(
    state: web::Data<NotificationsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let notification_id = path.into_inner();
    state
        .notification_service
        .mark_read(&user, &notification_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/notifications/read-all",
    responses(
        (status = 204, description = "All notifications marked as read"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-notifications"
)]
#[post("/notifications/read-all")]
pub async fn mark_all_read(
    state: web::Data<NotificationsApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    state.notification_service.mark_all_read(&user)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_notifications)
        .service(mark_notification_read)
        .service(mark_all_read);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(list_notifications, mark_notification_read, mark_all_read),
    tags((name = "drive-notifications", description = "Drive notifications endpoints")),
    security(("bearer_auth" = []))
)]
pub struct NotificationsApiDoc;
