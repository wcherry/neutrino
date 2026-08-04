use super::service::DriveAIService;
use crate::shared::ApiError;
use crate::shared::AuthenticatedUser;
use actix_web::{get, web, HttpResponse};
use std::sync::Arc;

pub struct DriveAIApiState {
    pub ai_service: Arc<DriveAIService>,
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(catch_me_up);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(catch_me_up),
    tags((name = "drive-ai", description = "Drive AI endpoints")),
    security(("bearer_auth" = []))
)]
pub struct DriveAIApiDoc;

#[utoipa::path(
    get,
    path = "/api/v1/drive/catch-me-up",
    responses(
        (status = 200, description = "AI catch-me-up summary of recent drive activity"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-ai"
)]
#[get("/catch-me-up")]
async fn catch_me_up(
    state: web::Data<DriveAIApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let result = state.ai_service.catch_me_up(&user.user_id).await?;
    Ok(HttpResponse::Ok().json(result))
}
