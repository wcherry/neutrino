use crate::links::{
    dto::{BacklinksResponse, FileLinkItem, UpdateLinksRequest},
    service::LinksService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, patch, web};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct LinksApiState {
    pub links_service: Arc<LinksService>,
}

/// List the files that link to this one.
///
/// The inbound half of the wiki-link graph — what a document's "linked mentions" panel shows.
/// Requires read access to the target file.
#[utoipa::path(
    get,
    path = "/api/v1/links/{file_id}/backlinks",
    params(
        ("file_id" = String, Path, description = "File ID")
    ),
    responses(
        (status = 200, description = "Files that link to this file", body = BacklinksResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "links"
)]
#[get("/links/{file_id}/backlinks")]
pub async fn get_backlinks(
    state: web::Data<LinksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<BacklinksResponse>, ApiError> {
    let file_id = path.into_inner();
    let result = state.links_service.get_backlinks(&user, &file_id).await?;
    Ok(web::Json(result))
}

/// Replace the set of outbound links a file declares.
///
/// The client extracts wiki-link titles from the file's plaintext and sends them here; titles
/// are resolved case-insensitively against the caller's own files, and ones that do not resolve
/// are dropped silently rather than erroring. `linkedIds` and `linkedRanges` are reserved and
/// return 400 for now.
#[utoipa::path(
    patch,
    path = "/api/v1/links/{file_id}",
    params(
        ("file_id" = String, Path, description = "File ID")
    ),
    request_body = UpdateLinksRequest,
    responses(
        (status = 200, description = "Links updated; response is the file's current backlinks", body = BacklinksResponse),
        (status = 400, description = "linkedIds/linkedRanges are not supported yet"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "links"
)]
#[patch("/links/{file_id}")]
pub async fn update_links(
    state: web::Data<LinksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateLinksRequest>,
) -> Result<web::Json<BacklinksResponse>, ApiError> {
    let file_id = path.into_inner();
    let result = state
        .links_service
        .update_links(&user, &file_id, body.into_inner())
        .await?;
    Ok(web::Json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(get_backlinks).service(update_links);
}

#[derive(OpenApi)]
#[openapi(
    paths(get_backlinks, update_links),
    components(schemas(UpdateLinksRequest, BacklinksResponse, FileLinkItem,)),
    tags((
        name = "links",
        description = "A wiki-link graph across Drive files, independent of file type. Clients extract link titles from a file's content and declare them here; the server resolves each title case-insensitively against the caller's own readable files and keeps the resulting edges, which the backlinks endpoint reads in reverse. Unresolvable titles are dropped rather than rejected."
    )),
    security(("bearer_auth" = []))
)]
pub struct LinksApiDoc;
