use crate::drive::comments::{
    dto::{
        CommentListResponse, CommentReplyResponse, CommentResponse, CreateCommentRequest,
        CreateReplyRequest, UpdateCommentRequest,
    },
    service::CommentsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;

pub struct CommentsApiState {
    pub comments_service: Arc<CommentsService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/comments",
    params(
        ("id" = String, Path, description = "File ID"),
        ("status" = Option<String>, Query, description = "Filter by status (open, resolved)"),
    ),
    responses(
        (status = 200, description = "List of comments", body = CommentListResponse),
        (status = 403, description = "Access denied"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-comments"
)]
#[get("/files/{id}/comments")]
pub async fn list_comments(
    state: web::Data<CommentsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let status = query.get("status").map(|s| s.as_str());
    let result = state
        .comments_service
        .list_comments(&user, &file_id, status)?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/comments",
    params(("id" = String, Path, description = "File ID")),
    request_body = CreateCommentRequest,
    responses(
        (status = 201, description = "Comment created", body = CommentResponse),
        (status = 403, description = "Access denied"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-comments"
)]
#[post("/files/{id}/comments")]
pub async fn create_comment(
    state: web::Data<CommentsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateCommentRequest>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let result = state
        .comments_service
        .create_comment(&user, &file_id, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(result))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drive/files/{id}/comments/{cid}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("cid" = String, Path, description = "Comment ID"),
    ),
    request_body = UpdateCommentRequest,
    responses(
        (status = 200, description = "Comment updated", body = CommentResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Comment not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-comments"
)]
#[patch("/files/{id}/comments/{cid}")]
pub async fn update_comment(
    state: web::Data<CommentsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateCommentRequest>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, comment_id) = path.into_inner();
    let result =
        state
            .comments_service
            .update_comment(&user, &file_id, &comment_id, body.into_inner())?;
    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{id}/comments/{cid}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("cid" = String, Path, description = "Comment ID"),
    ),
    responses(
        (status = 204, description = "Comment deleted"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Comment not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-comments"
)]
#[delete("/files/{id}/comments/{cid}")]
pub async fn delete_comment(
    state: web::Data<CommentsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, comment_id) = path.into_inner();
    state
        .comments_service
        .delete_comment(&user, &file_id, &comment_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/comments/{cid}/replies",
    params(
        ("id" = String, Path, description = "File ID"),
        ("cid" = String, Path, description = "Comment ID"),
    ),
    request_body = CreateReplyRequest,
    responses(
        (status = 201, description = "Reply added", body = CommentReplyResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Comment not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-comments"
)]
#[post("/files/{id}/comments/{cid}/replies")]
pub async fn add_reply(
    state: web::Data<CommentsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<CreateReplyRequest>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, comment_id) = path.into_inner();
    let result = state
        .comments_service
        .add_reply(&user, &file_id, &comment_id, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{id}/comments/{cid}/replies/{rid}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("cid" = String, Path, description = "Comment ID"),
        ("rid" = String, Path, description = "Reply ID"),
    ),
    responses(
        (status = 204, description = "Reply deleted"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Reply not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-comments"
)]
#[delete("/files/{id}/comments/{cid}/replies/{rid}")]
pub async fn delete_reply(
    state: web::Data<CommentsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, comment_id, reply_id) = path.into_inner();
    state
        .comments_service
        .delete_reply(&user, &file_id, &comment_id, &reply_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_comments)
        .service(create_comment)
        .service(update_comment)
        .service(delete_comment)
        .service(add_reply)
        .service(delete_reply);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        list_comments,
        create_comment,
        update_comment,
        delete_comment,
        add_reply,
        delete_reply,
    ),
    components(schemas(
        CreateCommentRequest,
        UpdateCommentRequest,
        CreateReplyRequest,
        CommentResponse,
        CommentReplyResponse,
        CommentListResponse,
    )),
    tags((name = "drive-comments", description = "Drive file comments endpoints")),
    security(("bearer_auth" = []))
)]
pub struct CommentsApiDoc;
