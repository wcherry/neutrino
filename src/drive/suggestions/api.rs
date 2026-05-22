use crate::drive::suggestions::{
    dto::{CreateSuggestionRequest, SuggestionListResponse, SuggestionResponse},
    service::SuggestionsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, post, web, HttpResponse};
use std::sync::Arc;

pub struct SuggestionsApiState {
    pub suggestions_service: Arc<SuggestionsService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/suggestions",
    params(
        ("id" = String, Path, description = "File ID"),
        ("status" = Option<String>, Query, description = "Filter by status (pending, accepted, rejected)"),
    ),
    responses(
        (status = 200, description = "List of suggestions", body = SuggestionListResponse),
        (status = 403, description = "Access denied"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-suggestions"
)]
#[get("/files/{id}/suggestions")]
pub async fn list_suggestions(
    state: web::Data<SuggestionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let status = query.get("status").map(|s| s.as_str());
    let result = state.suggestions_service.list_suggestions(&user, &file_id, status)?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/suggestions",
    params(("id" = String, Path, description = "File ID")),
    request_body = CreateSuggestionRequest,
    responses(
        (status = 201, description = "Suggestion created", body = SuggestionResponse),
        (status = 403, description = "Access denied"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-suggestions"
)]
#[post("/files/{id}/suggestions")]
pub async fn create_suggestion(
    state: web::Data<SuggestionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateSuggestionRequest>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let result = state.suggestions_service.create_suggestion(&user, &file_id, body.into_inner())?;
    Ok(HttpResponse::Created().json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/suggestions/{sid}/accept",
    params(
        ("id" = String, Path, description = "File ID"),
        ("sid" = String, Path, description = "Suggestion ID"),
    ),
    responses(
        (status = 200, description = "Suggestion accepted", body = SuggestionResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Suggestion not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-suggestions"
)]
#[post("/files/{id}/suggestions/{sid}/accept")]
pub async fn accept_suggestion(
    state: web::Data<SuggestionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, suggestion_id) = path.into_inner();
    let result = state.suggestions_service.accept_suggestion(&user, &file_id, &suggestion_id).await?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/suggestions/{sid}/reject",
    params(
        ("id" = String, Path, description = "File ID"),
        ("sid" = String, Path, description = "Suggestion ID"),
    ),
    responses(
        (status = 200, description = "Suggestion rejected", body = SuggestionResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Suggestion not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-suggestions"
)]
#[post("/files/{id}/suggestions/{sid}/reject")]
pub async fn reject_suggestion(
    state: web::Data<SuggestionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, suggestion_id) = path.into_inner();
    let result = state.suggestions_service.reject_suggestion(&user, &file_id, &suggestion_id).await?;
    Ok(HttpResponse::Ok().json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_suggestions)
        .service(create_suggestion)
        .service(accept_suggestion)
        .service(reject_suggestion);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        list_suggestions,
        create_suggestion,
        accept_suggestion,
        reject_suggestion,
    ),
    components(schemas(
        CreateSuggestionRequest,
        SuggestionResponse,
        SuggestionListResponse,
    )),
    tags((name = "drive-suggestions", description = "Drive file suggestions endpoints")),
    security(("bearer_auth" = []))
)]
pub struct DriveSuggestionsApiDoc;
