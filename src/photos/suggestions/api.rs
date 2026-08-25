use crate::photos::suggestions::{
    dto::{ListSuggestionsResponse, SuggestionResponse},
    service::SuggestionsService,
};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use actix_web::{get, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct SuggestionsApiState {
    pub suggestions_service: Arc<SuggestionsService>,
}

/// List the caller's pending face-identification suggestions.
///
/// Each one proposes that an unassigned face belongs to an existing person, waiting for the user
/// to confirm or reject it.
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

/// Accept a face suggestion.
///
/// Assigns the face to the suggested person and clears the suggestion, which is what folds the
/// photo into that person's album.
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

/// Reject a face suggestion.
///
/// Records the rejection so the same face is not proposed for that person again, rather than
/// simply dropping the suggestion for clustering to re-raise.
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
    tags((
        name = "suggestions",
        description = "Proposals that an unassigned face belongs to a person the library already knows, waiting on the user to decide. Accepting one assigns the face; rejecting it is recorded so the same pairing is not proposed again on the next clustering run."
    )),
    security(("bearer_auth" = []))
)]
pub struct SuggestionsApiDoc;
