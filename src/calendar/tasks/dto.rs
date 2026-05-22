use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

// ── Task List Request types ───────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskListRequest {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskListRequest {
    pub name: Option<String>,
    pub color: Option<String>,
}

// ── Task List Response types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResponse {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskListsResponse {
    pub task_lists: Vec<TaskListResponse>,
}

// ── Task Request types ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub title: String,
    pub notes: Option<String>,
    pub due_date: Option<String>, // ISO 8601 UTC
    pub position: Option<i32>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkCreateTaskItem {
    pub title: String,
    pub notes: Option<String>,
    pub due_date: Option<String>, // ISO 8601 UTC
}

/// Up to 200 tasks to create atomically, all added to the given list.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkCreateTasksRequest {
    pub list_id: String,
    pub tasks: Vec<BulkCreateTaskItem>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub done: Option<bool>,
    pub due_date: Option<String>,
    pub position: Option<i32>,
}

// ── Task Query types ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksQuery {
    #[param(required = false)]
    pub list_id: Option<String>,
}

// ── Reorder Request ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTasksRequest {
    /// The list whose tasks are being reordered.
    pub list_id: String,
    /// Task IDs in the desired new order (position 0 = first element).
    pub task_ids: Vec<String>,
}

// ── Task Response types ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskResponse {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub done: bool,
    pub due_date: Option<String>,
    pub position: i32,
    pub list_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkCreateTasksResponse {
    pub tasks: Vec<TaskResponse>,
}
