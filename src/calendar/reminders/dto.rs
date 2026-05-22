use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ListRemindersQuery {
    /// Filter to reminders linked to a specific event ID
    pub event_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderRequest {
    pub title: String,
    pub due_time: String, // ISO 8601 UTC
    pub recurrence_rule: Option<String>,
    pub linked_event_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReminderRequest {
    pub title: Option<String>,
    pub due_time: Option<String>,
    pub completed: Option<bool>,
    pub recurrence_rule: Option<String>,
}

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReminderResponse {
    pub id: String,
    pub title: String,
    pub due_time: String,
    pub completed: bool,
    pub recurrence_rule: Option<String>,
    pub linked_event_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListRemindersResponse {
    pub reminders: Vec<ReminderResponse>,
}
