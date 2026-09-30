use crate::calendar::events::{
    dto::{
        CreateEventRequest, DeleteEventQuery, EventChangesQuery, EventChangesResponse,
        EventResponse, ListEventsQuery, ListEventsResponse, SplitEventRequest, UpdateEventRequest,
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

/// List the caller's calendar events.
///
/// Returns every event the user owns, optionally narrowed to an ISO 8601 UTC window with
/// `from`/`to`. Recurring events are returned once carrying their recurrence rule; the
/// client expands the occurrences. With `exceptions=true`, every exception of every recurring
/// event returned comes too; without it, exceptions are left out.
#[utoipa::path(
    get,
    path = "/api/v1/events",
    params(
        ("from" = Option<String>, Query, description = "Range start (ISO 8601 UTC)"),
        ("to" = Option<String>, Query, description = "Range end (ISO 8601 UTC)"),
        ("exceptions" = Option<bool>, Query, description = "Also return the recurring events' exceptions"),
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

/// Create a calendar event.
///
/// Accepts a title, start/end instants, and optional recurrence, location and attendee
/// details, and returns the stored event with its generated ID.
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

/// Fetch a single calendar event by ID.
///
/// Returns 404 when the event does not exist or does not belong to the caller.
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

/// Update a calendar event.
///
/// Replaces the mutable fields of an existing event — timing, recurrence, description and
/// attendees — and returns the updated record.
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

/// Delete a calendar event.
///
/// Removes the event, and a recurring event's exceptions with it. With `fromOccurrence`, a
/// recurring event instead ends before that occurrence ("delete this and following"). An
/// exception is cancelled rather than removed. Returns 404 when the event does not belong to
/// the caller.
#[utoipa::path(
    delete,
    path = "/api/v1/events/{id}",
    params(
        ("id" = String, Path, description = "Event ID"),
        ("fromOccurrence" = Option<String>, Query, description = "Start, in the series, of the first occurrence to delete (ISO 8601 UTC)"),
    ),
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
    query: web::Query<DeleteEventQuery>,
) -> Result<HttpResponse, ApiError> {
    state.events_service.delete_event_from(
        &user,
        &path.into_inner(),
        query.from_occurrence.as_deref(),
    )?;
    Ok(HttpResponse::NoContent().finish())
}

/// Edit one occurrence of a recurring event ("this event").
///
/// Creates the occurrence's exception, or updates the one it has, and returns it. The
/// occurrence is named by its start in the series, before any edit. An exception can't have a
/// recurrence rule. A cancelled occurrence edited this way comes back.
#[utoipa::path(
    put,
    path = "/api/v1/events/{id}/occurrences/{originalStart}",
    params(
        ("id" = String, Path, description = "The recurring event's ID"),
        ("originalStart" = String, Path, description = "The occurrence's start in the series (ISO 8601 UTC)"),
    ),
    request_body = UpdateEventRequest,
    responses(
        (status = 200, description = "The occurrence's exception", body = EventResponse),
        (status = 400, description = "Not a recurring event, or a rule was given"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[put("/events/{id}/occurrences/{original_start}")]
pub async fn edit_occurrence(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateEventRequest>,
) -> Result<web::Json<EventResponse>, ApiError> {
    let (id, original_start) = path.into_inner();
    let event =
        state
            .events_service
            .edit_occurrence(&user, &id, &original_start, body.into_inner())?;
    Ok(web::Json(event))
}

/// Delete one occurrence of a recurring event ("this event").
#[utoipa::path(
    delete,
    path = "/api/v1/events/{id}/occurrences/{originalStart}",
    params(
        ("id" = String, Path, description = "The recurring event's ID"),
        ("originalStart" = String, Path, description = "The occurrence's start in the series (ISO 8601 UTC)"),
    ),
    responses(
        (status = 204, description = "Occurrence cancelled"),
        (status = 400, description = "Not a recurring event"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[delete("/events/{id}/occurrences/{original_start}")]
pub async fn cancel_occurrence(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (id, original_start) = path.into_inner();
    state
        .events_service
        .cancel_occurrence(&user, &id, &original_start)?;
    Ok(HttpResponse::NoContent().finish())
}

/// Edit an occurrence of a recurring event and every one after it ("this and following").
///
/// In one transaction: ends the series before the occurrence, starts a new series there with
/// the changes, and moves the exceptions from there on to it. Returns the new series. At or
/// before the first occurrence, edits the whole series and returns it.
#[utoipa::path(
    post,
    path = "/api/v1/events/{id}/split",
    params(("id" = String, Path, description = "The recurring event's ID")),
    request_body = SplitEventRequest,
    responses(
        (status = 200, description = "The new series", body = EventResponse),
        (status = 400, description = "Not a recurring event"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[post("/events/{id}/split")]
pub async fn split_event(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SplitEventRequest>,
) -> Result<web::Json<EventResponse>, ApiError> {
    let event = state
        .events_service
        .split_event(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(event))
}

/// What changed since a cursor: events created or edited, and the ids of events deleted.
///
/// Call without `since` for a cursor to start from, before the first load. A cursor older than
/// deleted events are kept for (90 days) answers `fullResyncRequired` and nothing else.
#[utoipa::path(
    get,
    path = "/api/v1/calendar/events/changes",
    params(("since" = Option<String>, Query, description = "The previous response's cursor")),
    responses((status = 200, description = "Changes since the cursor", body = EventChangesResponse)),
    security(("bearer_auth" = [])),
    tag = "events"
)]
#[get("/events/changes")]
pub async fn event_changes(
    state: web::Data<EventsApiState>,
    user: AuthenticatedUser,
    query: web::Query<EventChangesQuery>,
) -> Result<web::Json<EventChangesResponse>, ApiError> {
    Ok(web::Json(
        state.events_service.changes(&user, query.into_inner())?,
    ))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    // Before `/events/{id}`: routes match in registration order, and "changes" would otherwise
    // be read as an event id.
    cfg.service(event_changes)
        .service(list_events)
        .service(create_event)
        .service(get_event)
        .service(update_event)
        .service(delete_event)
        .service(edit_occurrence)
        .service(cancel_occurrence)
        .service(split_event);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_events,
        create_event,
        get_event,
        update_event,
        delete_event,
        edit_occurrence,
        cancel_occurrence,
        split_event,
        event_changes
    ),
    components(schemas(
        EventChangesResponse,
        SplitEventRequest,
        CreateEventRequest,
        UpdateEventRequest,
        ListEventsQuery,
        EventResponse,
        ListEventsResponse,
    )),
    tags((
        name = "events",
        description = "The entries on a user's calendar. Events are stored per user with a start and end instant, an optional IANA timezone, and an optional RFC 5545 recurrence rule that clients expand for display. One occurrence of a recurring event can be edited or cancelled through an exception, a row carrying `recurringEventId` and `originalStartTime`. Attendees are stored alongside each event and are cascade-deleted with it."
    )),
    security(("bearer_auth" = []))
)]
pub struct EventsApiDoc;
