use crate::photos::suggestions::{
    dto::{ListSuggestionsResponse, SuggestionResponse},
    service::SuggestionsService,
};
use actix_web::{get, post, web, HttpResponse};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct SuggestionsApiState {
    pub suggestions_service: Arc<SuggestionsService>,
}

/// List all pending face suggestions for the authenticated user.
#[utoipa::path(
    get,
    path = "/api/v1/photos/suggestions",
    responses(
        (status = 200, description = "Pending face-identification suggestions", body = ListSuggestionsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "suggestions"
)]
#[get("/photos/suggestions")]
pub async fn list_suggestions(
    state: web::Data<SuggestionsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListSuggestionsResponse>, ApiError> {
    let result = state.suggestions_service.list_suggestions(&user)?;
    Ok(web::Json(result))
}

/// Accept a suggestion: assign the face to the suggested person.
#[utoipa::path(
    post,
    path = "/api/v1/photos/suggestions/{id}/accept",
    params(("id" = String, Path, description = "Suggestion ID")),
    responses(
        (status = 204, description = "Suggestion accepted"),
        (status = 404, description = "Suggestion not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "suggestions"
)]
#[post("/photos/suggestions/{id}/accept")]
pub async fn accept_suggestion(
    state: web::Data<SuggestionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    state.suggestions_service.accept_suggestion(&user, &id)?;
    Ok(HttpResponse::NoContent().finish())
}

/// Reject a suggestion: prevents this face from being re-suggested for this person.
#[utoipa::path(
    post,
    path = "/api/v1/photos/suggestions/{id}/reject",
    params(("id" = String, Path, description = "Suggestion ID")),
    responses(
        (status = 204, description = "Suggestion rejected"),
        (status = 404, description = "Suggestion not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "suggestions"
)]
#[post("/photos/suggestions/{id}/reject")]
pub async fn reject_suggestion(
    state: web::Data<SuggestionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    state.suggestions_service.reject_suggestion(&user, &id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure_suggestions(cfg: &mut web::ServiceConfig) {
    cfg.service(list_suggestions)
        .service(accept_suggestion)
        .service(reject_suggestion);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_suggestions, accept_suggestion, reject_suggestion),
    components(schemas(SuggestionResponse, ListSuggestionsResponse)),
    tags((name = "suggestions", description = "Face identification suggestions")),
    security(("bearer_auth" = []))
)]
pub struct SuggestionsApiDoc;
