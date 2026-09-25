use crate::calendar::events::dto::EventResponse;
use crate::calendar::tasks::{
    dto::{
        CreateTaskAttachmentRequest, CreateTaskListRequest, CreateTaskRequest,
        ListTaskAttachmentsResponse, ListTaskListsResponse, ListTasksQuery, ReorderTasksRequest,
        ScheduleTaskRequest, TaskAttachmentResponse, TaskListResponse, TaskResponse,
        UpdateTaskRequest,
    },
    service::TasksService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct TasksApiState {
    pub tasks_service: Arc<TasksService>,
}

// ── Task Lists ────────────────────────────────────────────────────────────────

/// List the caller's task lists.
///
/// Task lists group tasks the way calendars group events; every user starts with a default
/// list.
#[utoipa::path(
    get,
    path = "/api/v1/tasks/lists",
    responses(
        (status = 200, description = "List of task lists", body = ListTaskListsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[get("/tasks/lists")]
pub async fn list_task_lists(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListTaskListsResponse>, ApiError> {
    let result = state.tasks_service.list_task_lists(&user)?;
    Ok(web::Json(result))
}

/// Create a task list.
///
/// Returns the new list with its generated ID, ready for tasks to be added to it.
#[utoipa::path(
    post,
    path = "/api/v1/tasks/lists",
    request_body = CreateTaskListRequest,
    responses(
        (status = 201, description = "Task list created", body = TaskListResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[post("/tasks/lists")]
pub async fn create_task_list(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateTaskListRequest>,
) -> Result<HttpResponse, ApiError> {
    let list = state
        .tasks_service
        .create_task_list(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(list))
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

/// List tasks.
///
/// Returns the caller's tasks in display order. Pass `list_id` to restrict the result to a
/// single task list; without it every task the user owns is returned.
#[utoipa::path(
    get,
    path = "/api/v1/tasks",
    params(ListTasksQuery),
    responses(
        (status = 200, description = "List of tasks", body = Vec<TaskResponse>),
        (status = 404, description = "List not found (when list_id provided)"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[get("/tasks")]
pub async fn list_tasks(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    query: web::Query<ListTasksQuery>,
) -> Result<web::Json<Vec<TaskResponse>>, ApiError> {
    let tasks = state
        .tasks_service
        .list_tasks(&user, query.list_id.as_deref())?;
    Ok(web::Json(tasks))
}

/// Create a task.
///
/// Accepts a title with optional notes, due date and parent list, and returns the stored
/// task.
#[utoipa::path(
    post,
    path = "/api/v1/tasks",
    request_body = CreateTaskRequest,
    responses(
        (status = 201, description = "Task created", body = TaskResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[post("/tasks")]
pub async fn create_task(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateTaskRequest>,
) -> Result<HttpResponse, ApiError> {
    let task = state.tasks_service.create_task(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(task))
}

/// Update a task.
///
/// Patches only the supplied fields, so this is also how a task is marked complete or
/// reopened.
#[utoipa::path(
    patch,
    path = "/api/v1/tasks/{id}",
    params(("id" = String, Path, description = "Task ID")),
    request_body = UpdateTaskRequest,
    responses(
        (status = 200, description = "Task updated", body = TaskResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[patch("/tasks/{id}")]
pub async fn update_task(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateTaskRequest>,
) -> Result<web::Json<TaskResponse>, ApiError> {
    let task = state
        .tasks_service
        .update_task(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(task))
}

// ── Bulk Create ───────────────────────────────────────────────────────────────

// ── Reorder ───────────────────────────────────────────────────────────────────

/// Reorder tasks.
///
/// Takes the full ordered list of task IDs and rewrites their sort positions in one
/// transaction. With `listId` every ID must already belong to that list; without it the IDs
/// are reordered as one flat sequence and need only belong to the caller.
#[utoipa::path(
    post,
    path = "/api/v1/tasks/reorder",
    request_body = ReorderTasksRequest,
    responses(
        (status = 200, description = "Tasks reordered successfully"),
        (status = 400, description = "Invalid request or task not in list"),
        (status = 404, description = "List not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[post("/tasks/reorder")]
pub async fn reorder_tasks(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    body: web::Json<ReorderTasksRequest>,
) -> Result<HttpResponse, ApiError> {
    state
        .tasks_service
        .reorder_tasks(&user, body.into_inner())?;
    Ok(HttpResponse::Ok().finish())
}

// ── List Membership ───────────────────────────────────────────────────────────

/// Add an existing task to a task list.
///
/// A task can belong to more than one list, so this records a membership rather than moving
/// the task. Adding a membership that already exists succeeds silently.
#[utoipa::path(
    post,
    path = "/api/v1/tasks/{id}/lists/{list_id}",
    params(
        ("id" = String, Path, description = "Task ID"),
        ("list_id" = String, Path, description = "Task list ID"),
    ),
    responses(
        (status = 204, description = "Task added to list"),
        (status = 404, description = "Task or list not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[post("/tasks/{id}/lists/{list_id}")]
pub async fn add_task_to_list(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (task_id, list_id) = path.into_inner();
    state
        .tasks_service
        .add_task_to_list(&user, &task_id, &list_id)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Calendar scheduling ───────────────────────────────────────────────────────

/// Put a task on the calendar.
///
/// Creates an ordinary calendar event carrying the task's title and notes and links the
/// task to it, so the task appears in every calendar view. Calling this on a task that is
/// already scheduled moves its existing event rather than creating a second one.
#[utoipa::path(
    post,
    path = "/api/v1/tasks/{id}/event",
    params(("id" = String, Path, description = "Task ID")),
    request_body = ScheduleTaskRequest,
    responses(
        (status = 200, description = "The event the task is scheduled as", body = EventResponse),
        (status = 400, description = "Invalid times"),
        (status = 404, description = "Task not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[post("/tasks/{id}/event")]
pub async fn schedule_task(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<ScheduleTaskRequest>,
) -> Result<web::Json<EventResponse>, ApiError> {
    let event = state
        .tasks_service
        .schedule_task(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(event))
}

/// Take a task off the calendar.
///
/// Deletes the event the task was scheduled as and clears the link. A task that is not on
/// the calendar is returned unchanged rather than reported as an error.
#[utoipa::path(
    delete,
    path = "/api/v1/tasks/{id}/event",
    params(("id" = String, Path, description = "Task ID")),
    responses(
        (status = 200, description = "The task, no longer scheduled", body = TaskResponse),
        (status = 404, description = "Task not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[delete("/tasks/{id}/event")]
pub async fn unschedule_task(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<TaskResponse>, ApiError> {
    let task = state
        .tasks_service
        .unschedule_task(&user, &path.into_inner())?;
    Ok(web::Json(task))
}

// ── Attachments ───────────────────────────────────────────────────────────────

/// List a task's attachments.
#[utoipa::path(
    get,
    path = "/api/v1/tasks/{id}/attachments",
    params(("id" = String, Path, description = "Task ID")),
    responses(
        (status = 200, description = "List of attachments", body = ListTaskAttachmentsResponse),
        (status = 404, description = "Task not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[get("/tasks/{id}/attachments")]
pub async fn list_task_attachments(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListTaskAttachmentsResponse>, ApiError> {
    let result = state
        .tasks_service
        .list_attachments(&user, &path.into_inner())?;
    Ok(web::Json(result))
}

/// Attach a Drive file or an inline note to a task.
///
/// Exactly one of `fileId` and `note` is expected; a file attachment is a reference to the
/// Drive file and never a copy of it.
#[utoipa::path(
    post,
    path = "/api/v1/tasks/{id}/attachments",
    params(("id" = String, Path, description = "Task ID")),
    request_body = CreateTaskAttachmentRequest,
    responses(
        (status = 201, description = "Attachment created", body = TaskAttachmentResponse),
        (status = 400, description = "Neither fileId nor note supplied"),
        (status = 404, description = "Task not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[post("/tasks/{id}/attachments")]
pub async fn create_task_attachment(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateTaskAttachmentRequest>,
) -> Result<HttpResponse, ApiError> {
    let attachment =
        state
            .tasks_service
            .create_attachment(&user, &path.into_inner(), body.into_inner())?;
    Ok(HttpResponse::Created().json(attachment))
}

/// Remove an attachment from a task. The Drive file it referenced is untouched.
#[utoipa::path(
    delete,
    path = "/api/v1/tasks/{id}/attachments/{attachment_id}",
    params(
        ("id" = String, Path, description = "Task ID"),
        ("attachment_id" = String, Path, description = "Attachment ID"),
    ),
    responses(
        (status = 204, description = "Attachment removed"),
        (status = 404, description = "Task or attachment not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[delete("/tasks/{id}/attachments/{attachment_id}")]
pub async fn delete_task_attachment(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (task_id, attachment_id) = path.into_inner();
    state
        .tasks_service
        .delete_attachment(&user, &task_id, &attachment_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_task_lists)
        .service(create_task_list)
        .service(list_tasks)
        .service(reorder_tasks)
        .service(create_task)
        .service(update_task)
        .service(schedule_task)
        .service(unschedule_task)
        .service(list_task_attachments)
        .service(create_task_attachment)
        .service(delete_task_attachment)
        .service(add_task_to_list);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_task_lists,
        create_task_list,
        list_tasks,
        create_task,
        update_task,
        reorder_tasks,
        schedule_task,
        unschedule_task,
        list_task_attachments,
        create_task_attachment,
        delete_task_attachment,
        add_task_to_list,
    ),
    components(schemas(
        CreateTaskListRequest,
        TaskListResponse,
        ListTaskListsResponse,
        CreateTaskRequest,
        UpdateTaskRequest,
        ReorderTasksRequest,
        ScheduleTaskRequest,
        CreateTaskAttachmentRequest,
        TaskAttachmentResponse,
        ListTaskAttachmentsResponse,
        TaskResponse,
    )),
    tags((
        name = "tasks",
        description = "To-do items and the lists that group them. A task carries a title, notes, a due date and a done flag, and can belong to several lists at once through membership rows; positions are rewritten in bulk by the reorder endpoint. A task can also be put on the calendar — which creates an ordinary event and links the task to it — and can carry Drive-file or note attachments and its own reminders (`GET /reminders?taskId=`). The RTM-style Smart Add fields — priority, tags, start date, time estimate, location and a repeat rule — are parsed from typed text by the clients and stored as plain fields; completing a repeating task marks it done and returns the task created for its next occurrence as `nextTask`."
    )),
    security(("bearer_auth" = []))
)]
pub struct TasksApiDoc;
