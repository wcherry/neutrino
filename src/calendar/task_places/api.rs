use crate::calendar::task_places::{
    dto::{ListTaskPlacesResponse, SaveTaskPlaceRequest, TaskPlaceResponse},
    service::TaskPlacesService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct TaskPlacesApiState {
    pub task_places_service: Arc<TaskPlacesService>,
}

/// List the caller's saved places.
///
/// Each is a v1 PlaceEnvelope the server can't read; clients decrypt them with the account key.
#[utoipa::path(
    get,
    path = "/api/v1/calendar/task-places",
    responses((status = 200, description = "The caller's saved places", body = ListTaskPlacesResponse)),
    security(("bearer_auth" = [])),
    tag = "task-places"
)]
#[get("/task-places")]
pub async fn list_task_places(
    state: web::Data<TaskPlacesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListTaskPlacesResponse>, ApiError> {
    Ok(web::Json(state.task_places_service.list(&user)?))
}

/// Save a place.
#[utoipa::path(
    post,
    path = "/api/v1/calendar/task-places",
    request_body = SaveTaskPlaceRequest,
    responses(
        (status = 201, description = "Place saved", body = TaskPlaceResponse),
        (status = 400, description = "Missing or oversize payload"),
    ),
    security(("bearer_auth" = [])),
    tag = "task-places"
)]
#[post("/task-places")]
pub async fn create_task_place(
    state: web::Data<TaskPlacesApiState>,
    user: AuthenticatedUser,
    body: web::Json<SaveTaskPlaceRequest>,
) -> Result<HttpResponse, ApiError> {
    let place = state.task_places_service.create(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(place))
}

/// Replace a saved place's envelope (a rename or a move).
#[utoipa::path(
    patch,
    path = "/api/v1/calendar/task-places/{id}",
    params(("id" = String, Path, description = "Place ID")),
    request_body = SaveTaskPlaceRequest,
    responses(
        (status = 200, description = "Place updated", body = TaskPlaceResponse),
        (status = 400, description = "Missing or oversize payload"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "task-places"
)]
#[patch("/task-places/{id}")]
pub async fn update_task_place(
    state: web::Data<TaskPlacesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SaveTaskPlaceRequest>,
) -> Result<web::Json<TaskPlaceResponse>, ApiError> {
    let place = state
        .task_places_service
        .update(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(place))
}

/// Delete a saved place. Every task that used it loses its geofence.
#[utoipa::path(
    delete,
    path = "/api/v1/calendar/task-places/{id}",
    params(("id" = String, Path, description = "Place ID")),
    responses(
        (status = 204, description = "Place deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "task-places"
)]
#[delete("/task-places/{id}")]
pub async fn delete_task_place(
    state: web::Data<TaskPlacesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .task_places_service
        .delete(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_task_places)
        .service(create_task_place)
        .service(update_task_place)
        .service(delete_task_place);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_task_places, create_task_place, update_task_place, delete_task_place),
    components(schemas(TaskPlaceResponse, ListTaskPlacesResponse, SaveTaskPlaceRequest)),
    tags((
        name = "task-places",
        description = "Saved places for task arrival geofences. Each is end-to-end encrypted: `encryptedPayload` is a v1 PlaceEnvelope holding the name, coordinates and radius, sealed to the account key. The server stores and returns it without reading it. Deleting a place clears it from every task that used it."
    )),
    security(("bearer_auth" = []))
)]
pub struct TaskPlacesApiDoc;
