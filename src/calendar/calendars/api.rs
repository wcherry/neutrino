use crate::calendar::calendars::{
    dto::{CalendarResponse, CreateCalendarRequest, ListCalendarsResponse, UpdateCalendarRequest},
    service::CalendarsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct CalendarsApiState {
    pub calendars_service: Arc<CalendarsService>,
}

/// List the caller's calendars.
///
/// Always includes the default calendar, made on first use. Hidden calendars are listed too:
/// hiding is something the clients apply when they draw events.
#[utoipa::path(
    get,
    path = "/api/v1/calendar/calendars",
    responses((status = 200, description = "The caller's calendars", body = ListCalendarsResponse)),
    security(("bearer_auth" = [])),
    tag = "calendars"
)]
#[get("/calendars")]
pub async fn list_calendars(
    state: web::Data<CalendarsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListCalendarsResponse>, ApiError> {
    Ok(web::Json(state.calendars_service.list(&user)?))
}

/// Create a calendar.
///
/// `kind` is `local` (the default) or `holidays`. A holiday calendar names a `country` and is
/// read-only; the clients compute its days. One per country.
#[utoipa::path(
    post,
    path = "/api/v1/calendar/calendars",
    request_body = CreateCalendarRequest,
    responses(
        (status = 201, description = "Calendar created", body = CalendarResponse),
        (status = 400, description = "Invalid request"),
        (status = 409, description = "That country's holidays are already added"),
    ),
    security(("bearer_auth" = [])),
    tag = "calendars"
)]
#[post("/calendars")]
pub async fn create_calendar(
    state: web::Data<CalendarsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateCalendarRequest>,
) -> Result<HttpResponse, ApiError> {
    let calendar = state.calendars_service.create(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(calendar))
}

/// Update a calendar's settings.
///
/// Name, colour and visibility; for a holiday calendar, also its region and whether observances
/// are shown. Allowed on a read-only calendar: it is the events that are read-only.
#[utoipa::path(
    patch,
    path = "/api/v1/calendar/calendars/{id}",
    params(("id" = String, Path, description = "Calendar ID")),
    request_body = UpdateCalendarRequest,
    responses(
        (status = 200, description = "Calendar updated", body = CalendarResponse),
        (status = 400, description = "Invalid request"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "calendars"
)]
#[patch("/calendars/{id}")]
pub async fn update_calendar(
    state: web::Data<CalendarsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateCalendarRequest>,
) -> Result<web::Json<CalendarResponse>, ApiError> {
    let calendar = state
        .calendars_service
        .update(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(calendar))
}

/// Delete a calendar and every event in it.
///
/// The default calendar can't be deleted, nor a provider's while its account is connected.
#[utoipa::path(
    delete,
    path = "/api/v1/calendar/calendars/{id}",
    params(("id" = String, Path, description = "Calendar ID")),
    responses(
        (status = 204, description = "Calendar deleted"),
        (status = 400, description = "The default calendar"),
        (status = 404, description = "Not found"),
        (status = 409, description = "The provider's account is still connected"),
    ),
    security(("bearer_auth" = [])),
    tag = "calendars"
)]
#[delete("/calendars/{id}")]
pub async fn delete_calendar(
    state: web::Data<CalendarsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.calendars_service.delete(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_calendars)
        .service(create_calendar)
        .service(update_calendar)
        .service(delete_calendar);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_calendars, create_calendar, update_calendar, delete_calendar),
    components(schemas(
        CalendarResponse,
        ListCalendarsResponse,
        CreateCalendarRequest,
        UpdateCalendarRequest,
    )),
    tags((
        name = "calendars",
        description = "The named, coloured groups a user's events belong to. Every user has a default local calendar; each connected provider has one its synced events land in; a holiday calendar names a country whose holidays the clients compute. Events in a read-only calendar can't be created, edited or deleted."
    )),
    security(("bearer_auth" = []))
)]
pub struct CalendarsApiDoc;
