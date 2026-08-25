//! Endpoints for the parts of a document Drive cannot serve.
//!
//! Listing, creating, reading, renaming, autosaving and converting documents
//! all go through the generic drive file endpoints now — a document is a Drive
//! file with `application/x-neutrino-doc` as its mime type. What is left here
//! is page setup (per-document layout state Drive has no notion of) and
//! plain-text export (which has to understand Tiptap JSON).

use crate::docs::docs::{
    dto::{ExportTextResponse, PageSetup},
    service::DocsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, put, web};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct DocsApiState {
    pub docs_service: Arc<DocsService>,
}

/// Fetch a document's page setup.
///
/// Margins, orientation and page size — what the editor lays the page out from and what a PDF
/// export prints to. A document that has never been customised gets the defaults rather than a
/// 404.
#[utoipa::path(
    get,
    path = "/api/v1/docs/{id}/page-setup",
    params(("id" = String, Path, description = "Document ID")),
    responses(
        (status = 200, description = "Page setup (defaults if never customised)", body = PageSetup),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "docs"
)]
#[get("/{id}/page-setup")]
pub async fn get_page_setup(
    state: web::Data<DocsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<PageSetup>, ApiError> {
    let doc_id = path.into_inner();
    let setup = state.docs_service.get_page_setup(&user, &doc_id).await?;
    Ok(web::Json(setup))
}

/// Save a document's page setup.
///
/// Replaces the whole setup — margins, orientation and page size are all sent together.
/// Requires edit access.
#[utoipa::path(
    put,
    path = "/api/v1/docs/{id}/page-setup",
    params(("id" = String, Path, description = "Document ID")),
    request_body = PageSetup,
    responses(
        (status = 200, description = "Page setup saved", body = PageSetup),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "docs"
)]
#[put("/{id}/page-setup")]
pub async fn update_page_setup(
    state: web::Data<DocsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<PageSetup>,
) -> Result<web::Json<PageSetup>, ApiError> {
    let doc_id = path.into_inner();
    let setup = state
        .docs_service
        .update_page_setup(&user, &doc_id, &body.into_inner())
        .await?;
    Ok(web::Json(setup))
}

/// Export a document as plain text.
///
/// Flattens the stored rich-text tree to text and returns it with word and character counts,
/// which is what the word-count readout and plain-text export both use.
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
    cfg.service(get_page_setup)
        .service(update_page_setup)
        .service(export_text);
}

#[derive(OpenApi)]
#[openapi(
    paths(get_page_setup, update_page_setup, export_text),
    components(schemas(PageSetup, ExportTextResponse)),
    tags((
        name = "docs",
        description = "The document-level settings and exports that sit beside a Doc's content. The content itself is a Drive file edited over the collaboration socket, so what lives here is page setup and the plain-text projection used for word counts and text export."
    )),
    security(("bearer_auth" = []))
)]
pub struct DocsApiDoc;
