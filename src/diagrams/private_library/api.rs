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

/// List all cached third-party shape libraries.
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

/// Fetch a drawio library from the given URL and store it in the private store.
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

/// Get the XML content of a cached third-party library by ID.
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

/// Remove a cached third-party library by ID.
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
    tags((name = "diagrams", description = "Neutrino diagramming editor")),
    security(("bearer_auth" = []))
)]
pub struct PrivateLibraryApiDoc;
