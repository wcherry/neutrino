use crate::shared::{ApiError, AuthenticatedUser};
use crate::docs::docs::{
    dto::{CreateDocRequest, DocMetaResponse, DocResponse, ExportTextResponse, ListDocsResponse, SaveDocRequest},
    service::DocsService,
};
use actix_web::{get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct DocsApiState {
    pub docs_service: Arc<DocsService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/docs",
    responses(
        (status = 200, description = "List of documents", body = ListDocsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "docs"
)]
#[get("")]
pub async fn list_docs(
    state: web::Data<DocsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListDocsResponse>, ApiError> {
    let result = state.docs_service.list_docs(&user).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/docs",
    request_body = CreateDocRequest,
    responses(
        (status = 201, description = "Document created", body = DocResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "docs"
)]
#[post("")]
pub async fn create_doc(
    state: web::Data<DocsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateDocRequest>,
) -> Result<HttpResponse, ApiError> {
    let doc = state.docs_service.create_doc(&user, body.into_inner()).await?;
    Ok(HttpResponse::Created().json(doc))
}

#[utoipa::path(
    get,
    path = "/api/v1/docs/{id}",
    params(
        ("id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, description = "Document content", body = DocResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "docs"
)]
#[get("/{id}")]
pub async fn get_doc(
    state: web::Data<DocsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<DocResponse>, ApiError> {
    let doc_id = path.into_inner();
    let doc = state.docs_service.get_doc(&user, &doc_id).await?;
    Ok(web::Json(doc))
}

#[utoipa::path(
    patch,
    path = "/api/v1/docs/{id}",
    params(
        ("id" = String, Path, description = "Document ID")
    ),
    request_body = SaveDocRequest,
    responses(
        (status = 200, description = "Document saved", body = DocMetaResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "docs"
)]
#[patch("/{id}")]
pub async fn save_doc(
    state: web::Data<DocsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SaveDocRequest>,
) -> Result<web::Json<DocMetaResponse>, ApiError> {
    let doc_id = path.into_inner();
    let meta = state
        .docs_service
        .save_doc(&user, &doc_id, body.into_inner())
        .await?;
    Ok(web::Json(meta))
}

#[utoipa::path(
    get,
    path = "/api/v1/docs/{id}/export/text",
    params(
        ("id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, description = "Plain text export", body = ExportTextResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "docs"
)]
#[get("/{id}/export/text")]
pub async fn export_text(
    state: web::Data<DocsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ExportTextResponse>, ApiError> {
    let doc_id = path.into_inner();
    let result = state.docs_service.export_text(&user, &doc_id).await?;
    Ok(web::Json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_docs)
        .service(create_doc)
        .service(get_doc)
        .service(save_doc)
        .service(export_text);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_docs, create_doc, get_doc, save_doc, export_text),
    components(schemas(
        CreateDocRequest,
        SaveDocRequest,
        DocResponse,
        DocMetaResponse,
        ListDocsResponse,
        ExportTextResponse,
        crate::docs::docs::dto::PageSetup,
    )),
    tags((name = "docs", description = "Native document editor")),
    security(("bearer_auth" = []))
)]
pub struct DocsApiDoc;
