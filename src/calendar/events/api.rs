use crate::calendar::events::{
    dto::{
        CreateEventRequest, EventResponse, ListEventsQuery, ListEventsResponse, UpdateEventRequest,
    },
    service::EventsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, post, put, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct EventsApiState {
    pub events_service: Arc<EventsService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/events",
    params(
        ("from" = Option<String>, Query, description = "Range start (ISO 8601 UTC)"),
        ("to" = Option<String>, Query, description = "Range end (ISO 8601 UTC)"),
    ),
    responses(
        (status = 200, description = "List of events", body = ListEventsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[get("/events")]
pub async fn list_events(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    query: web::Query<ListEventsQuery>,
) -> Result<web::Json<ListEventsResponse>, ApiError> {
    let result = state
        .events_service
        .list_events(&user, query.into_inner())?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/events",
    request_body = CreateEventRequest,
    responses(
        (status = 201, description = "Event created", body = EventResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[post("/events")]
pub async fn create_event(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateEventRequest>,
) -> Result<HttpResponse, ApiError> {
    let event = state
        .events_service
        .create_event(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(event))
}

#[utoipa::path(
    get,
    path = "/api/v1/events/{id}",
    params(("id" = String, Path, description = "Event ID")),
    responses(
        (status = 200, description = "Event", body = EventResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[get("/events/{id}")]
pub async fn get_event(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<EventResponse>, ApiError> {
    let event = state.events_service.get_event(&user, &path.into_inner())?;
    Ok(web::Json(event))
}

#[utoipa::path(
    put,
    path = "/api/v1/events/{id}",
    params(("id" = String, Path, description = "Event ID")),
    request_body = UpdateEventRequest,
    responses(
        (status = 200, description = "Event updated", body = EventResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[put("/events/{id}")]
pub async fn update_event(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateEventRequest>,
) -> Result<web::Json<EventResponse>, ApiError> {
    let event = state
        .events_service
        .update_event(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(event))
}

#[utoipa::path(
    delete,
    path = "/api/v1/events/{id}",
    params(("id" = String, Path, description = "Event ID")),
    responses(
        (status = 204, description = "Event deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[delete("/events/{id}")]
pub async fn delete_event(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .events_service
        .delete_event(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_events)
        .service(create_event)
        .service(get_event)
        .service(update_event)
        .service(delete_event);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_events, create_event, get_event, update_event, delete_event),
    components(schemas(
        CreateEventRequest,
        UpdateEventRequest,
        ListEventsQuery,
        EventResponse,
        ListEventsResponse,
    )),
    tags((name = "events", description = "Calendar events")),
    security(("bearer_auth" = []))
)]
pub struct EventsApiDoc;
