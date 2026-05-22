use crate::shared::{ApiError, AuthenticatedUser};
use crate::calendar::reminders::{
    dto::{
        CreateReminderRequest, ListRemindersQuery, ListRemindersResponse, ReminderResponse,
        UpdateReminderRequest,
    },
    service::RemindersService,
};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct RemindersApiState {
    pub reminders_service: Arc<RemindersService>,
}

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
    let result = state.reminders_service.list_reminders(&user, query.into_inner())?;
    Ok(web::Json(result))
}

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
    let reminder = state
        .reminders_service
        .update_reminder(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(reminder))
}

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
    tags((name = "reminders", description = "Reminders and tasks")),
    security(("bearer_auth" = []))
)]
pub struct RemindersApiDoc;
