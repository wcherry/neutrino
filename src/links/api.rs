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
    tags((name = "links", description = "Generic cross-file backlinks graph")),
    security(("bearer_auth" = []))
)]
pub struct LinksApiDoc;
