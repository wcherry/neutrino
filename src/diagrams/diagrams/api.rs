use crate::diagrams::diagrams::{
    dto::{
        CreateCommentRequest, CreateDiagramRequest, DiagramCommentResponse, DiagramMetaResponse,
        DiagramResponse, ListCommentsResponse, ListDiagramsResponse, SaveDiagramRequest,
        UpdateCommentRequest,
    },
    service::DiagramsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_multipart::Multipart;
use actix_web::{delete, get, patch, post, put, web, HttpResponse};
use futures_util::StreamExt;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct DiagramsApiState {
    pub diagrams_service: Arc<DiagramsService>,
}

// ── Diagram CRUD ──────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/diagrams",
    responses(
        (status = 200, description = "List of diagrams", body = ListDiagramsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[get("/diagrams")]
pub async fn list_diagrams(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListDiagramsResponse>, ApiError> {
    let result = state.diagrams_service.list_diagrams(&user).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/diagrams",
    request_body = CreateDiagramRequest,
    responses(
        (status = 201, description = "Diagram created", body = DiagramResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[post("/diagrams")]
pub async fn create_diagram(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateDiagramRequest>,
) -> Result<HttpResponse, ApiError> {
    let diagram = state
        .diagrams_service
        .create_diagram(&user, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(diagram))
}

#[utoipa::path(
    get,
    path = "/api/v1/diagrams/{id}",
    params(
        ("id" = String, Path, description = "Diagram ID")
    ),
    responses(
        (status = 200, description = "Diagram content URLs", body = DiagramResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[get("/diagrams/{id}")]
pub async fn get_diagram(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<DiagramResponse>, ApiError> {
    let diagram_id = path.into_inner();
    let diagram = state
        .diagrams_service
        .get_diagram(&user, &diagram_id)
        .await?;
    Ok(web::Json(diagram))
}

#[utoipa::path(
    patch,
    path = "/api/v1/diagrams/{id}",
    params(
        ("id" = String, Path, description = "Diagram ID")
    ),
    request_body = SaveDiagramRequest,
    responses(
        (status = 200, description = "Diagram saved", body = DiagramMetaResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[patch("/diagrams/{id}")]
pub async fn save_diagram(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SaveDiagramRequest>,
) -> Result<web::Json<DiagramMetaResponse>, ApiError> {
    let diagram_id = path.into_inner();
    let meta = state
        .diagrams_service
        .save_diagram(&user, &diagram_id, body.into_inner())
        .await?;
    Ok(web::Json(meta))
}

#[utoipa::path(
    delete,
    path = "/api/v1/diagrams/{id}",
    params(
        ("id" = String, Path, description = "Diagram ID")
    ),
    responses(
        (status = 204, description = "Diagram deleted"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[delete("/diagrams/{id}")]
pub async fn delete_diagram(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let diagram_id = path.into_inner();
    state
        .diagrams_service
        .delete_diagram(&user, &diagram_id)
        .await?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    put,
    path = "/api/v1/diagrams/{id}/autosave",
    params(("id" = String, Path, description = "Diagram ID")),
    responses(
        (status = 200, description = "Diagram autosaved", body = DiagramMetaResponse),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[put("/diagrams/{id}/autosave")]
pub async fn autosave_diagram(
    state: web::Data<DiagramsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    mut payload: Multipart,
) -> Result<web::Json<DiagramMetaResponse>, ApiError> {
    let diagram_id = path.into_inner();
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut title: Option<String> = None;

    while let Some(field) = payload.next().await {
        let mut field = field.map_err(|_| ApiError::bad_request("Invalid multipart data"))?;
        let content_disposition = field.content_disposition().cloned();
        let field_name = content_disposition
            .as_ref()
            .and_then(|cd| cd.get_name())
            .unwrap_or("")
            .to_string();
        let has_filename = content_disposition
            .as_ref()
            .and_then(|cd| cd.get_filename())
            .is_some();

        let mut bytes = Vec::new();
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|_| ApiError::bad_request("Upload interrupted"))?;
            bytes.extend_from_slice(&data);
        }

        if has_filename || field_name == "file" {
            file_bytes = Some(bytes);
        } else if field_name == "metadata" {
            if let Ok(s) = String::from_utf8(bytes) {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&s) {
                    title = meta.get("title").and_then(|v| v.as_str()).map(String::from);
                }
            }
        }
    }

    let bytes = file_bytes.ok_or_else(|| ApiError::bad_request("No file provided"))?;
    let meta = state
        .diagrams_service
        .autosave(&user, &diagram_id, &bytes, title.as_deref())
        .await?;
    Ok(web::Json(meta))
}

// ── Comments ──────────────────────────────────────────────────────────────────

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
    // Literal-segment routes must come before /{id} routes.
    cfg.service(list_diagrams)
        .service(create_diagram)
        .service(get_diagram)
        .service(save_diagram)
        .service(delete_diagram)
        .service(autosave_diagram)
        .service(list_comments)
        .service(create_comment)
        .service(update_comment)
        .service(delete_comment);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_diagrams, create_diagram, get_diagram, save_diagram, delete_diagram, autosave_diagram,
        list_comments, create_comment, update_comment, delete_comment,
    ),
    components(schemas(
        CreateDiagramRequest,
        SaveDiagramRequest,
        DiagramResponse,
        DiagramMetaResponse,
        ListDiagramsResponse,
        CreateCommentRequest,
        UpdateCommentRequest,
        DiagramCommentResponse,
        ListCommentsResponse,
    )),
    tags((name = "diagrams", description = "Neutrino diagramming editor")),
    security(("bearer_auth" = []))
)]
pub struct DiagramsApiDoc;
