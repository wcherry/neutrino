use crate::photos::learning::{
    dto::{ReprocessingResponse, ThresholdsResponse},
    service::LearningService,
};
use actix_web::{get, post, web};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct LearningApiState {
    pub learning_service: Arc<LearningService>,
}

pub fn configure_learning(cfg: &mut web::ServiceConfig) {
    cfg.service(get_thresholds).service(trigger_reprocess);
}

#[utoipa::path(
    get,
    path = "/api/v1/photos/learning/thresholds",
    responses(
        (status = 200, description = "Current ML confidence thresholds and feedback counts", body = ThresholdsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "learning"
)]
#[get("/photos/learning/thresholds")]
async fn get_thresholds(
    state: web::Data<LearningApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ThresholdsResponse>, ApiError> {
    let resp = state.learning_service.get_thresholds(&user.user_id)?;
    Ok(web::Json(resp))
}

#[utoipa::path(
    post,
    path = "/api/v1/photos/learning/reprocess",
    responses(
        (status = 200, description = "Reprocessing results", body = ReprocessingResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "learning"
)]
#[post("/photos/learning/reprocess")]
async fn trigger_reprocess(
    state: web::Data<LearningApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ReprocessingResponse>, ApiError> {
    let resp = state.learning_service.process_pending_for_user(&user.user_id)?;
    Ok(web::Json(resp))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_thresholds, trigger_reprocess),
    components(schemas(ThresholdsResponse, ReprocessingResponse)),
    tags((name = "learning", description = "ML feedback and face reprocessing")),
    security(("bearer_auth" = []))
)]
pub struct LearningApiDoc;
