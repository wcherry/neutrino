use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventRequest {
    pub title: String,
    pub description: Option<String>,
    pub start_time: String, // ISO 8601 UTC
    pub end_time: String,   // ISO 8601 UTC
    #[serde(default)]
    pub all_day: bool,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    #[serde(default)]
    pub attendees: Vec<String>,
    pub timezone: Option<String>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEventRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub all_day: Option<bool>,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    pub attendees: Option<Vec<String>>,
    pub timezone: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsQuery {
    /// Start of range (ISO 8601 UTC). Defaults to start of current month.
    pub from: Option<String>,
    /// End of range (ISO 8601 UTC). Defaults to end of current month.
    pub to: Option<String>,
}

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventResponse {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub all_day: bool,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    pub attendees: Vec<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
    pub timezone: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsResponse {
    pub events: Vec<EventResponse>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventChangesQuery {
    /// The `cursor` of the previous response. Omitted, the response is only a cursor to start
    /// from: take one before loading anything, so nothing changed during the load is missed.
    pub since: Option<String>,
}

/// What changed since a cursor. Changes are reported at or after the cursor, so one may arrive
/// twice; apply them idempotently.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventChangesResponse {
    /// Events created or changed since the cursor, as `GET /events` returns them.
    pub events: Vec<EventResponse>,
    /// Events deleted since the cursor.
    pub deleted_ids: Vec<String>,
    /// Pass as `since` next time.
    pub cursor: String,
    /// The cursor is older than deletions are kept for, so deletions may be missing: drop
    /// everything held and load afresh. `events` and `deletedIds` are empty when this is set.
    pub full_resync_required: bool,
}
