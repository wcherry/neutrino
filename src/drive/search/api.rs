use super::dto::*;
use super::service::SearchService;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, put, web, HttpResponse};
use std::sync::Arc;

pub struct SearchApiState {
    pub search_service: Arc<SearchService>,
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(search_files).service(index_file_content);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(search_files, index_file_content),
    components(schemas(SearchQuery, SearchResultItem, SearchResponse, ContentIndexRequest)),
    tags((name = "drive-search", description = "Drive search endpoints")),
    security(("bearer_auth" = []))
)]
pub struct SearchApiDoc;

#[utoipa::path(
    get,
    path = "/api/v1/drive/search",
    params(
        ("q" = String, Query, description = "Search query"),
        ("fileType" = Option<String>, Query, description = "Filter by file type"),
        ("ownerId" = Option<String>, Query, description = "Filter by owner ID"),
        ("after" = Option<String>, Query, description = "Filter files modified after date"),
        ("before" = Option<String>, Query, description = "Filter files modified before date"),
        ("sharedOnly" = bool, Query, description = "Only show shared files"),
        ("limit" = i64, Query, description = "Result limit"),
        ("offset" = i64, Query, description = "Result offset"),
    ),
    responses(
        (status = 200, description = "Search results", body = SearchResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-search"
)]
#[get("/search")]
async fn search_files(
    state: web::Data<SearchApiState>,
    query: web::Query<SearchQuery>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let results = state.search_service.search(&user.user_id, &query)?;
    Ok(HttpResponse::Ok().json(results))
}

#[utoipa::path(
    put,
    path = "/api/v1/jobs/files/{file_id}/content-index",
    params(("file_id" = String, Path, description = "File ID")),
    request_body = ContentIndexRequest,
    responses(
        (status = 200, description = "Content indexed"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-search"
)]
#[put("/jobs/files/{file_id}/content-index")]
async fn index_file_content(
    state: web::Data<SearchApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
    body: web::Json<ContentIndexRequest>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    state
        .search_service
        .upsert_content_index(&file_id, &user.user_id, &body.text_content)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({"indexed": true})))
}
