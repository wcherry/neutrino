use serde::{Deserialize, Deserializer, Serialize};
use utoipa::{IntoParams, ToSchema};

/// Tell an absent field from one explicitly sent as `null`.
///
/// A plain `Option<T>` collapses the two, which is fine for a create but not for a patch:
/// the task editor needs "clear the notes" and "leave the notes alone" to be different
/// requests, and with a plain `Option` clearing a field was simply unreachable.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

// ── Task List Request types ───────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskListRequest {
    pub name: String,
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
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    /// Omit to leave the notes alone; send `null` to clear them.
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub notes: Option<Option<String>>,
    pub done: Option<bool>,
    /// Omit to leave the due date alone; send `null` to clear it.
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub due_date: Option<Option<String>>,
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
    /// The list whose tasks are being reordered. Optional: `position` lives on the task row
    /// rather than on a membership, so omitting it reorders the caller's tasks as one flat
    /// sequence — which is what the web sidebar does now that it no longer groups by list.
    pub list_id: Option<String>,
    /// Task IDs in the desired new order (position 0 = first element).
    pub task_ids: Vec<String>,
}

// ── Scheduling Request ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTaskRequest {
    /// ISO 8601 UTC start of the event the task is scheduled as.
    pub start_time: String,
    /// ISO 8601 UTC end. Must be at or after `startTime`.
    pub end_time: String,
    #[serde(default)]
    pub all_day: bool,
    /// IANA timezone the times were entered in; omitted for an all-day event.
    pub timezone: Option<String>,
}

// ── Task Attachment types ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskAttachmentRequest {
    /// Drive file ID (omit for a text note)
    pub file_id: Option<String>,
    /// Display name for the file attachment
    pub name: Option<String>,
    /// Inline text note (omit for a file attachment)
    pub note: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttachmentResponse {
    pub id: String,
    pub task_id: String,
    pub file_id: Option<String>,
    pub name: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskAttachmentsResponse {
    pub attachments: Vec<TaskAttachmentResponse>,
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
    /// The calendar event this task is scheduled as, or `null` when it is not on the
    /// calendar.
    pub event_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
