use crate::drive::filesystem::dto::DriveFileType;
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

#[derive(Debug, serde::Deserialize)]
pub struct TaggedFilesQuery {
    /// Page size, default 50, capped at 200.
    pub limit: Option<i64>,
    /// Number of files to skip, default 0.
    pub offset: Option<i64>,
    /// List only tagged files of this type.
    #[serde(rename = "type")]
    pub file_type: Option<DriveFileType>,
}

// ── Tag CRUD ──────────────────────────────────────────────────────────────────

/// Create a tag.
///
/// Tags are per user and their names are unique within an account, so re-creating an existing
/// name returns 409 rather than a duplicate.
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

/// List the caller's tags.
///
/// Pass `q` to filter by partial name — what the tag picker's type-ahead calls.
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

/// Fetch one tag by ID.
///
/// Returns 404 for a tag belonging to another user, since tags are not shared.
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

/// Rename a tag.
///
/// Every file carrying the tag follows the new name automatically. Colliding with an existing
/// tag name returns 409.
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

/// Delete a tag.
///
/// Removes it from every file it was applied to. The files themselves are untouched.
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

/// List the files carrying a tag, paginated.
///
/// The tag-as-a-view endpoint: page size defaults to 50 and is capped at 200, and `type`
/// narrows the results to one kind of Drive file.
#[utoipa::path(
    get,
    path = "/api/v1/drive/tags/{id}/files",
    params(
        ("id" = String, Path, description = "Tag ID"),
        ("limit" = Option<i64>, Query, description = "Page size (default 50, max 200)"),
        ("offset" = Option<i64>, Query, description = "Files to skip (default 0)"),
        ("type" = Option<DriveFileType>, Query, description = "List only tagged files of this type"),
    ),
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
    query: web::Query<TaggedFilesQuery>,
) -> Result<web::Json<ListTaggedFilesResponse>, ApiError> {
    let tag_id = path.into_inner();
    let response = state.tags_service.get_files_for_tag(
        &user,
        &tag_id,
        query.limit,
        query.offset,
        query.file_type,
    )?;
    Ok(web::Json(response))
}

// ── File-Tag operations ───────────────────────────────────────────────────────

/// List the tags applied to one file.
///
/// Requires read access to the file; the tags returned are the caller's own.
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

/// Replace the full set of tags on a file.
///
/// The list sent becomes the file's tags exactly — anything omitted is removed. Requires edit
/// access, and every tag ID must belong to the caller.
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

/// Apply one tag to a file.
///
/// The incremental counterpart of the replace-all endpoint. Requires edit access on the file
/// and ownership of the tag.
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

/// Remove one tag from a file.
///
/// Unlinks the pair only — the tag itself and the file both survive.
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
        (
            name = "tags",
            description = "Per-user labels applied to Drive files. A tag belongs to one account and its name is unique within that account, so tags are private even when the files they mark are shared. Applying or removing a tag needs edit access on the file; listing a tag's files turns the tag into a saved view."
        ),
    ),
)]
pub struct TagsApiDoc;
