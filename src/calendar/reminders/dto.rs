use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ListRemindersQuery {
    /// Filter to reminders linked to a specific event ID
    pub event_id: Option<String>,
    /// Filter to reminders linked to a specific task ID
    pub task_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderRequest {
    pub title: String,
    pub due_time: String, // ISO 8601 UTC
    pub recurrence_rule: Option<String>,
    pub linked_event_id: Option<String>,
    /// The task this reminder belongs to. A reminder has at most one owner; passing both
    /// this and `linkedEventId` is rejected.
    pub linked_task_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReminderRequest {
    pub title: Option<String>,
    pub due_time: Option<String>,
    /// Completing a reminder with a recurrence rule moves it to its next occurrence and leaves it
    /// open, rather than marking it done; it is marked done once the rule runs out.
    pub completed: Option<bool>,
    /// An RRULE body such as `FREQ=WEEKLY;BYDAY=MO`. An empty string removes the rule.
    pub recurrence_rule: Option<String>,
    /// The IANA zone to step a recurrence in, e.g. `America/Los_Angeles`, so a 09:00 reminder
    /// stays at 09:00 across DST. Only read when completing a recurring reminder; UTC if absent.
    pub timezone: Option<String>,
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
    pub linked_task_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListRemindersResponse {
    pub reminders: Vec<ReminderResponse>,
}
