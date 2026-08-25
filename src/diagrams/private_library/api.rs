use crate::diagrams::private_library::{
    dto::{AddLibraryRequest, LibraryContent, LibraryMeta, ListLibrariesResponse},
    service::PrivateLibraryService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct PrivateLibraryApiState {
    pub service: Arc<PrivateLibraryService>,
}

/// List the caller's cached third-party shape libraries.
///
/// Metadata only — name and source URL — for populating the shape palette. Fetch a library's ID
/// to get its XML.
#[utoipa::path(
    get,
    path = "/api/v1/diagrams/private-libraries",
    responses(
        (status = 200, description = "List of third-party shape libraries", body = ListLibrariesResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[get("/diagrams/private-libraries")]
pub async fn list_libraries(
    state: web::Data<PrivateLibraryApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListLibrariesResponse>, ApiError> {
    let result = state.service.list(&user).await?;
    Ok(web::Json(result))
}

/// Add a third-party shape library by URL.
///
/// Fetches the drawio library once and caches it in the caller's private store, so the editor
/// never has to reach out to the third-party host again. Re-adding the same URL returns 409.
#[utoipa::path(
    post,
    path = "/api/v1/diagrams/private-libraries",
    request_body = AddLibraryRequest,
    responses(
        (status = 201, description = "Library added and cached", body = LibraryMeta),
        (status = 400, description = "Invalid URL or not a drawio library"),
        (status = 409, description = "Library with this URL already exists"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[post("/diagrams/private-libraries")]
pub async fn add_library(
    state: web::Data<PrivateLibraryApiState>,
    user: AuthenticatedUser,
    body: web::Json<AddLibraryRequest>,
) -> Result<HttpResponse, ApiError> {
    let lib = state.service.add(&user, body.into_inner()).await?;
    Ok(HttpResponse::Created().json(lib))
}

/// Fetch a cached library's metadata and XML content.
///
/// The shapes themselves, served from the local cache rather than the original host.
#[utoipa::path(
    get,
    path = "/api/v1/diagrams/private-libraries/{id}",
    params(("id" = String, Path, description = "Library ID")),
    responses(
        (status = 200, description = "Library metadata + XML content", body = LibraryContent),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[get("/diagrams/private-libraries/{id}")]
pub async fn get_library_content(
    state: web::Data<PrivateLibraryApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<LibraryContent>, ApiError> {
    let id = path.into_inner();
    let result = state.service.get_content(&user, &id).await?;
    Ok(web::Json(result))
}

/// Remove a cached shape library.
///
/// Drops the cached copy; diagrams that already used its shapes keep them, since shapes are
/// copied into the diagram.
#[utoipa::path(
    delete,
    path = "/api/v1/diagrams/private-libraries/{id}",
    params(("id" = String, Path, description = "Library ID")),
    responses(
        (status = 204, description = "Library removed"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams"
)]
#[delete("/diagrams/private-libraries/{id}")]
pub async fn remove_library(
    state: web::Data<PrivateLibraryApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    state.service.remove(&user, &id).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_libraries)
        .service(add_library)
        .service(get_library_content)
        .service(remove_library);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_libraries, add_library, get_library_content, remove_library),
    components(schemas(AddLibraryRequest, LibraryMeta, LibraryContent, ListLibrariesResponse)),
    security(("bearer_auth" = []))
)]
pub struct PrivateLibraryApiDoc;
