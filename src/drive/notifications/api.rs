use crate::drive::notifications::hub::NotificationHub;
use crate::drive::notifications::service::NotificationService;
use crate::shared::{ApiError, AuthenticatedUser, TokenService};
use actix_web::{get, post, web, HttpRequest, HttpResponse};
use actix_ws::AggregatedMessage;
use futures_util::StreamExt;
use std::sync::Arc;

pub struct NotificationsApiState {
    pub notification_service: Arc<NotificationService>,
    pub hub: Arc<NotificationHub>,
    pub token_service: Arc<TokenService>,
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

/// WebSocket endpoint for real-time notification push.
/// Authenticates via `?token=<jwt>` query parameter (standard for WebSocket).
#[get("/notifications/ws")]
pub async fn notifications_ws(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<NotificationsApiState>,
) -> Result<HttpResponse, actix_web::Error> {
    let token = req.uri().query().and_then(|q| {
        q.split('&')
            .find(|kv| kv.starts_with("token="))
            .map(|kv| kv["token=".len()..].to_string())
    });

    let claims = match token {
        Some(ref t) => match state.token_service.validate_access_token(t) {
            Ok(c) => c,
            Err(_) => {
                return Ok(HttpResponse::Unauthorized().json(serde_json::json!({
                    "error": {"code": "UNAUTHORIZED", "message": "Invalid token"}
                })));
            }
        },
        None => {
            return Ok(HttpResponse::Unauthorized().json(serde_json::json!({
                "error": {"code": "UNAUTHORIZED", "message": "Token required"}
            })));
        }
    };

    let user_id = claims.sub;
    let (mut rx, slot_id) = state.hub.subscribe(&user_id);
    let (response, mut session, msg_stream) = actix_ws::handle(&req, stream)?;

    let hub = state.hub.clone();
    let uid = user_id.clone();

    actix_web::rt::spawn(async move {
        let mut stream = msg_stream
            .max_frame_size(64 * 1024)
            .aggregate_continuations()
            .max_continuation_size(128 * 1024);

        loop {
            tokio::select! {
                notification = rx.recv() => {
                    match notification {
                        Some(json) => {
                            if session.text(json).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                msg = stream.next() => {
                    match msg {
                        None => break,
                        Some(Err(_)) => break,
                        Some(Ok(AggregatedMessage::Ping(bytes))) => {
                            if session.pong(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(AggregatedMessage::Close(_))) => break,
                        _ => {}
                    }
                }
            }
        }

        hub.unsubscribe(&uid, slot_id);
    });

    Ok(response)
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_notifications)
        .service(mark_notification_read)
        .service(mark_all_read)
        .service(notifications_ws);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(list_notifications, mark_notification_read, mark_all_read),
    tags((name = "drive-notifications", description = "Drive notifications endpoints")),
    security(("bearer_auth" = []))
)]
pub struct NotificationsApiDoc;
