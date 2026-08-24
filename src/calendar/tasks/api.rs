use crate::calendar::tasks::{
    dto::{
        CreateTaskListRequest, CreateTaskRequest, ListTaskListsResponse, ListTasksQuery,
        ReorderTasksRequest, TaskListResponse, TaskResponse, UpdateTaskRequest,
    },
    service::TasksService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct TasksApiState {
    pub tasks_service: Arc<TasksService>,
}

// ── Task Lists ────────────────────────────────────────────────────────────────

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

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_task_lists)
        .service(create_task_list)
        .service(list_tasks)
        .service(reorder_tasks)
        .service(create_task)
        .service(update_task)
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
        add_task_to_list,
    ),
    components(schemas(
        CreateTaskListRequest,
        TaskListResponse,
        ListTaskListsResponse,
        CreateTaskRequest,
        UpdateTaskRequest,
        ReorderTasksRequest,
        TaskResponse,
    )),
    tags((name = "tasks", description = "Task lists and tasks")),
    security(("bearer_auth" = []))
)]
pub struct TasksApiDoc;
