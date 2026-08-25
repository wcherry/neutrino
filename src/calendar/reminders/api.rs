use crate::calendar::reminders::{
    dto::{
        CreateReminderRequest, ListRemindersQuery, ListRemindersResponse, ReminderResponse,
        UpdateReminderRequest,
    },
    service::RemindersService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct RemindersApiState {
    pub reminders_service: Arc<RemindersService>,
}

/// List the caller's reminders.
///
/// Pass `eventId` to return only the reminders attached to one event; without it every
/// reminder the user owns is returned.
#[utoipa::path(
    get,
    path = "/api/v1/reminders",
    params(
        ("eventId" = Option<String>, Query, description = "Filter by linked event ID"),
    ),
    responses(
        (status = 200, description = "List of reminders", body = ListRemindersResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "reminders"
)]
#[get("/reminders")]
pub async fn list_reminders(
    state: web::Data<RemindersApiState>,
    user: AuthenticatedUser,
    query: web::Query<ListRemindersQuery>,
) -> Result<web::Json<ListRemindersResponse>, ApiError> {
    let result = state
        .reminders_service
        .list_reminders(&user, query.into_inner())?;
    Ok(web::Json(result))
}

/// Create a reminder.
///
/// Takes a title and a due time, plus an optional recurrence rule and linked event. The
/// reminder engine picks it up in the background and notifies the user when it comes due.
#[utoipa::path(
    post,
    path = "/api/v1/reminders",
    request_body = CreateReminderRequest,
    responses(
        (status = 201, description = "Reminder created", body = ReminderResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "reminders"
)]
#[post("/reminders")]
pub async fn create_reminder(
    state: web::Data<RemindersApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateReminderRequest>,
) -> Result<HttpResponse, ApiError> {
    let reminder = state
        .reminders_service
        .create_reminder(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(reminder))
}

/// Fetch a single reminder by ID.
///
/// Returns 404 when the reminder does not exist or belongs to another user.
#[utoipa::path(
    get,
    path = "/api/v1/reminders/{id}",
    params(("id" = String, Path, description = "Reminder ID")),
    responses(
        (status = 200, description = "Reminder", body = ReminderResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "reminders"
)]
#[get("/reminders/{id}")]
pub async fn get_reminder(
    state: web::Data<RemindersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ReminderResponse>, ApiError> {
    let reminder = state
        .reminders_service
        .get_reminder(&user, &path.into_inner())?;
    Ok(web::Json(reminder))
}

/// Update a reminder.
///
/// Patches only the supplied fields, so this is also how a reminder is marked completed or
/// reopened. Clearing `notified_at` lets the reminder engine fire it again.
#[utoipa::path(
    patch,
    path = "/api/v1/reminders/{id}",
    params(("id" = String, Path, description = "Reminder ID")),
    request_body = UpdateReminderRequest,
    responses(
        (status = 200, description = "Reminder updated", body = ReminderResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "reminders"
)]
#[patch("/reminders/{id}")]
pub async fn update_reminder(
    state: web::Data<RemindersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateReminderRequest>,
) -> Result<web::Json<ReminderResponse>, ApiError> {
    let reminder =
        state
            .reminders_service
            .update_reminder(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(reminder))
}

/// Delete a reminder.
///
/// Removes the record so the reminder engine will not fire it. Returns 404 when the
/// reminder belongs to another user.
#[utoipa::path(
    delete,
    path = "/api/v1/reminders/{id}",
    params(("id" = String, Path, description = "Reminder ID")),
    responses(
        (status = 204, description = "Reminder deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "reminders"
)]
#[delete("/reminders/{id}")]
pub async fn delete_reminder(
    state: web::Data<RemindersApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .reminders_service
        .delete_reminder(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_reminders)
        .service(create_reminder)
        .service(get_reminder)
        .service(update_reminder)
        .service(delete_reminder);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_reminders, create_reminder, get_reminder, update_reminder, delete_reminder),
    components(schemas(
        CreateReminderRequest,
        UpdateReminderRequest,
        ReminderResponse,
        ListRemindersResponse,
    )),
    tags((
        name = "reminders",
        description = "Standalone, optionally recurring reminders that can be linked to a calendar event. The background reminder engine polls for reminders that have come due and notifies the owner, recording when it did so."
    )),
    security(("bearer_auth" = []))
)]
pub struct RemindersApiDoc;
