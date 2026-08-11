//! Diagram comment endpoints.
//!
//! Diagram CRUD is served by the generic drive file endpoints now — a diagram
//! is a Drive file with `application/x-neutrino-diagram` as its mime type.
//! Comments hang off the file and have no Drive equivalent, so they stay here.

use crate::diagrams::diagrams::{
    dto::{
        CreateCommentRequest, DiagramCommentResponse, ListCommentsResponse, UpdateCommentRequest,
    },
    service::DiagramsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct DiagramsApiState {
    pub diagrams_service: Arc<DiagramsService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/diagrams/{id}/comments",
    params(("id" = String, Path, description = "Diagram ID")),
    responses(
        (status = 200, description = "List of comments", body = ListCommentsResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[get("/diagrams/{id}/comments")]
pub async fn list_comments(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListCommentsResponse>, ApiError> {
    let file_id = path.into_inner();
    let result = state
        .diagrams_service
        .list_comments(&user, &file_id)
        .await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/diagrams/{id}/comments",
    params(("id" = String, Path, description = "Diagram ID")),
    request_body = CreateCommentRequest,
    responses(
        (status = 201, description = "Comment created", body = DiagramCommentResponse),
        (status = 400, description = "Invalid request"),
        (status = 404, description = "Diagram not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[post("/diagrams/{id}/comments")]
pub async fn create_comment(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateCommentRequest>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let comment = state
        .diagrams_service
        .create_comment(&user, &file_id, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(comment))
}

#[utoipa::path(
    patch,
    path = "/api/v1/diagrams/{id}/comments/{comment_id}",
    params(
        ("id" = String, Path, description = "Diagram ID"),
        ("comment_id" = String, Path, description = "Comment ID"),
    ),
    request_body = UpdateCommentRequest,
    responses(
        (status = 200, description = "Comment updated", body = DiagramCommentResponse),
        (status = 403, description = "Permission denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[patch("/diagrams/{id}/comments/{comment_id}")]
pub async fn update_comment(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateCommentRequest>,
) -> Result<web::Json<DiagramCommentResponse>, ApiError> {
    let (_file_id, comment_id) = path.into_inner();
    let comment = state
        .diagrams_service
        .update_comment(&user, &comment_id, body.into_inner())
        .await?;
    Ok(web::Json(comment))
}

#[utoipa::path(
    delete,
    path = "/api/v1/diagrams/{id}/comments/{comment_id}",
    params(
        ("id" = String, Path, description = "Diagram ID"),
        ("comment_id" = String, Path, description = "Comment ID"),
    ),
    responses(
        (status = 204, description = "Comment deleted"),
        (status = 403, description = "Permission denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[delete("/diagrams/{id}/comments/{comment_id}")]
pub async fn delete_comment(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (_file_id, comment_id) = path.into_inner();
    state
        .diagrams_service
        .delete_comment(&user, &comment_id)
        .await?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_comments)
        .service(create_comment)
        .service(update_comment)
        .service(delete_comment);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_comments, create_comment, update_comment, delete_comment),
    components(schemas(
        CreateCommentRequest,
        UpdateCommentRequest,
        DiagramCommentResponse,
        ListCommentsResponse,
    )),
    tags((name = "diagrams", description = "Diagram comments")),
    security(("bearer_auth" = []))
)]
pub struct DiagramsApiDoc;
