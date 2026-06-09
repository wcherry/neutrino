use super::service::DriveAIService;
use crate::drive::search::service::SearchService;
use crate::shared::ApiError;
use crate::shared::AuthenticatedUser;
use actix_web::{get, post, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;

pub struct DriveAIApiState {
    pub ai_service: Arc<DriveAIService>,
    pub search_service: Arc<SearchService>,
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(get_file_summary)
        .service(catch_me_up)
        .service(ask_drive);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(get_file_summary, catch_me_up, ask_drive),
    components(schemas(AskRequest)),
    tags((name = "drive-ai", description = "Drive AI endpoints")),
    security(("bearer_auth" = []))
)]
pub struct DriveAIApiDoc;

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{file_id}/summary",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "AI-generated file summary"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-ai"
)]
#[get("/files/{file_id}/summary")]
async fn get_file_summary(
    state: web::Data<DriveAIApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let summary = state
        .ai_service
        .get_file_summary(&file_id, &user.user_id)
        .await?;
    Ok(HttpResponse::Ok().json(summary))
}

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

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct AskRequest {
    question: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/ask",
    request_body = AskRequest,
    responses(
        (status = 200, description = "AI answer to the question about drive files"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-ai"
)]
#[post("/ask")]
async fn ask_drive(
    state: web::Data<DriveAIApiState>,
    user: AuthenticatedUser,
    body: web::Json<AskRequest>,
) -> Result<HttpResponse, ApiError> {
    let result = state
        .ai_service
        .answer_question(&user.user_id, &body.question, &state.search_service)
        .await?;
    Ok(HttpResponse::Ok().json(result))
}
