use crate::shared::{ApiError, AuthenticatedUser};
use crate::calendar::tasks::{
    dto::{
        BulkCreateTaskItem, BulkCreateTasksRequest, BulkCreateTasksResponse,
        CreateTaskListRequest, CreateTaskRequest, ListTaskListsResponse, ListTasksQuery,
        ReorderTasksRequest, TaskListResponse, TaskResponse,
        UpdateTaskListRequest, UpdateTaskRequest,
    },
    service::TasksService,
};
use actix_web::{delete, get, patch, post, web, HttpResponse};
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

#[utoipa::path(
    get,
    path = "/api/v1/tasks/lists/{id}",
    params(("id" = String, Path, description = "Task list ID")),
    responses(
        (status = 200, description = "Task list", body = TaskListResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[get("/tasks/lists/{id}")]
pub async fn get_task_list(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<TaskListResponse>, ApiError> {
    let list = state
        .tasks_service
        .get_task_list(&user, &path.into_inner())?;
    Ok(web::Json(list))
}

#[utoipa::path(
    patch,
    path = "/api/v1/tasks/lists/{id}",
    params(("id" = String, Path, description = "Task list ID")),
    request_body = UpdateTaskListRequest,
    responses(
        (status = 200, description = "Task list updated", body = TaskListResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[patch("/tasks/lists/{id}")]
pub async fn update_task_list(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateTaskListRequest>,
) -> Result<web::Json<TaskListResponse>, ApiError> {
    let list = state
        .tasks_service
        .update_task_list(&user, &path.into_inner(), body.into_inner())?;
    Ok(web::Json(list))
}

#[utoipa::path(
    delete,
    path = "/api/v1/tasks/lists/{id}",
    params(("id" = String, Path, description = "Task list ID")),
    responses(
        (status = 204, description = "Task list deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[delete("/tasks/lists/{id}")]
pub async fn delete_task_list(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .tasks_service
        .delete_task_list(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
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
    let task = state
        .tasks_service
        .create_task(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(task))
}

#[utoipa::path(
    get,
    path = "/api/v1/tasks/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses(
        (status = 200, description = "Task", body = TaskResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[get("/tasks/{id}")]
pub async fn get_task(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<TaskResponse>, ApiError> {
    let task = state.tasks_service.get_task(&user, &path.into_inner())?;
    Ok(web::Json(task))
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

#[utoipa::path(
    delete,
    path = "/api/v1/tasks/{id}",
    params(("id" = String, Path, description = "Task ID")),
    responses(
        (status = 204, description = "Task deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[delete("/tasks/{id}")]
pub async fn delete_task(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.tasks_service.delete_task(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Bulk Create ───────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/tasks/bulk",
    request_body = BulkCreateTasksRequest,
    responses(
        (status = 201, description = "Tasks created", body = BulkCreateTasksResponse),
        (status = 400, description = "Invalid request (empty or >200 tasks)"),
        (status = 404, description = "Task list not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[post("/tasks/bulk")]
pub async fn bulk_create_tasks(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    body: web::Json<BulkCreateTasksRequest>,
) -> Result<HttpResponse, ApiError> {
    let result = state
        .tasks_service
        .bulk_create_tasks(&user, body.into_inner())?;
    Ok(HttpResponse::Created().json(result))
}

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

#[utoipa::path(
    delete,
    path = "/api/v1/tasks/{id}/lists/{list_id}",
    params(
        ("id" = String, Path, description = "Task ID"),
        ("list_id" = String, Path, description = "Task list ID"),
    ),
    responses(
        (status = 204, description = "Task removed from list"),
        (status = 404, description = "Task, list, or membership not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
#[delete("/tasks/{id}/lists/{list_id}")]
pub async fn remove_task_from_list(
    state: web::Data<TasksApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (task_id, list_id) = path.into_inner();
    state
        .tasks_service
        .remove_task_from_list(&user, &task_id, &list_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_task_lists)
        .service(create_task_list)
        .service(get_task_list)
        .service(update_task_list)
        .service(delete_task_list)
        .service(list_tasks)
        // bulk_create_tasks must be registered before create_task and get_task
        // so that POST /tasks/bulk is not swallowed by the /tasks/{id} pattern.
        .service(bulk_create_tasks)
        .service(reorder_tasks)
        .service(create_task)
        .service(get_task)
        .service(update_task)
        .service(delete_task)
        .service(add_task_to_list)
        .service(remove_task_from_list);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_task_lists,
        create_task_list,
        get_task_list,
        update_task_list,
        delete_task_list,
        list_tasks,
        bulk_create_tasks,
        create_task,
        get_task,
        update_task,
        delete_task,
        reorder_tasks,
        add_task_to_list,
        remove_task_from_list,
    ),
    components(schemas(
        CreateTaskListRequest,
        UpdateTaskListRequest,
        TaskListResponse,
        ListTaskListsResponse,
        CreateTaskRequest,
        BulkCreateTaskItem,
        BulkCreateTasksRequest,
        BulkCreateTasksResponse,
        UpdateTaskRequest,
        ReorderTasksRequest,
        TaskResponse,
    )),
    tags((name = "tasks", description = "Task lists and tasks")),
    security(("bearer_auth" = []))
)]
pub struct TasksApiDoc;
