use crate::drive::tags::{
    dto::{
        CreateTagRequest, ListTaggedFilesResponse, ListTagsResponse, SetFileTagsRequest,
        TagResponse, UpdateTagRequest,
    },
    service::TagsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, put, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct TagsApiState {
    pub tags_service: Arc<TagsService>,
}

#[derive(Debug, serde::Deserialize)]
pub struct TagsListQuery {
    /// Optional partial name filter.
    pub q: Option<String>,
}

// ── Tag CRUD ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/drive/tags",
    request_body = CreateTagRequest,
    responses(
        (status = 201, description = "Tag created", body = TagResponse),
        (status = 400, description = "Invalid request"),
        (status = 409, description = "Tag name already exists"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[post("/tags")]
pub async fn create_tag(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateTagRequest>,
) -> Result<HttpResponse, ApiError> {
    let tag = state.tags_service.create_tag(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(tag))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/tags",
    params(
        ("q" = Option<String>, Query, description = "Partial tag name filter"),
    ),
    responses(
        (status = 200, description = "List of tags", body = ListTagsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[get("/tags")]
pub async fn list_tags(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    query: web::Query<TagsListQuery>,
) -> Result<web::Json<ListTagsResponse>, ApiError> {
    let response = state.tags_service.list_tags(&user, query.q.as_deref())?;
    Ok(web::Json(response))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/tags/{id}",
    params(("id" = String, Path, description = "Tag ID")),
    responses(
        (status = 200, description = "Tag details", body = TagResponse),
        (status = 404, description = "Tag not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[get("/tags/{id}")]
pub async fn get_tag(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<TagResponse>, ApiError> {
    let tag_id = path.into_inner();
    let tag = state.tags_service.get_tag(&user, &tag_id)?;
    Ok(web::Json(tag))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drive/tags/{id}",
    params(("id" = String, Path, description = "Tag ID")),
    request_body = UpdateTagRequest,
    responses(
        (status = 200, description = "Tag renamed", body = TagResponse),
        (status = 404, description = "Tag not found"),
        (status = 409, description = "Tag name already exists"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[patch("/tags/{id}")]
pub async fn rename_tag(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateTagRequest>,
) -> Result<web::Json<TagResponse>, ApiError> {
    let tag_id = path.into_inner();
    let tag = state
        .tags_service
        .rename_tag(&user, &tag_id, body.into_inner())?;
    Ok(web::Json(tag))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/tags/{id}",
    params(("id" = String, Path, description = "Tag ID")),
    responses(
        (status = 204, description = "Tag deleted"),
        (status = 404, description = "Tag not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[delete("/tags/{id}")]
pub async fn delete_tag(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let tag_id = path.into_inner();
    state.tags_service.delete_tag(&user, &tag_id)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Files by tag ──────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/drive/tags/{id}/files",
    params(("id" = String, Path, description = "Tag ID")),
    responses(
        (status = 200, description = "Files with this tag", body = ListTaggedFilesResponse),
        (status = 404, description = "Tag not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[get("/tags/{id}/files")]
pub async fn get_files_for_tag(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListTaggedFilesResponse>, ApiError> {
    let tag_id = path.into_inner();
    let response = state.tags_service.get_files_for_tag(&user, &tag_id)?;
    Ok(web::Json(response))
}

// ── File-Tag operations ───────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/tags",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "Tags for this file", body = Vec<TagResponse>),
        (status = 403, description = "Access denied"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[get("/files/{id}/tags")]
pub async fn get_file_tags(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<Vec<TagResponse>>, ApiError> {
    let file_id = path.into_inner();
    let tags = state.tags_service.get_file_tags(&user, &file_id)?;
    Ok(web::Json(tags))
}

#[utoipa::path(
    put,
    path = "/api/v1/drive/files/{id}/tags",
    params(("id" = String, Path, description = "File ID")),
    request_body = SetFileTagsRequest,
    responses(
        (status = 200, description = "Tags replaced on file", body = Vec<TagResponse>),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "File or tag not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[put("/files/{id}/tags")]
pub async fn set_file_tags(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SetFileTagsRequest>,
) -> Result<web::Json<Vec<TagResponse>>, ApiError> {
    let file_id = path.into_inner();
    let tags = state
        .tags_service
        .set_file_tags(&user, &file_id, body.into_inner().tag_ids)?;
    Ok(web::Json(tags))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/tags/{tag_id}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("tag_id" = String, Path, description = "Tag ID"),
    ),
    responses(
        (status = 204, description = "Tag added to file"),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "File or tag not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[post("/files/{id}/tags/{tag_id}")]
pub async fn add_file_tag(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, tag_id) = path.into_inner();
    state.tags_service.add_file_tag(&user, &file_id, &tag_id)?;
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{id}/tags/{tag_id}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("tag_id" = String, Path, description = "Tag ID"),
    ),
    responses(
        (status = 204, description = "Tag removed from file"),
        (status = 403, description = "Edit access required"),
    ),
    security(("bearer_auth" = [])),
    tag = "tags"
)]
#[delete("/files/{id}/tags/{tag_id}")]
pub async fn remove_file_tag(
    state: web::Data<TagsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, tag_id) = path.into_inner();
    state
        .tags_service
        .remove_file_tag(&user, &file_id, &tag_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(create_tag)
        .service(list_tags)
        .service(get_tag)
        .service(rename_tag)
        .service(delete_tag)
        .service(get_files_for_tag)
        .service(get_file_tags)
        .service(set_file_tags)
        .service(add_file_tag)
        .service(remove_file_tag);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        create_tag, list_tags, get_tag, rename_tag, delete_tag,
        get_files_for_tag,
        get_file_tags, set_file_tags, add_file_tag, remove_file_tag,
    ),
    components(schemas(
        TagResponse,
        ListTagsResponse,
        CreateTagRequest,
        UpdateTagRequest,
        SetFileTagsRequest,
        ListTaggedFilesResponse,
        crate::drive::tags::dto::TaggedFileResponse,
    )),
    tags(
        (name = "tags", description = "Tag management and file tagging endpoints"),
    ),
)]
pub struct TagsApiDoc;
