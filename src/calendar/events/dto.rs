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

#[derive(Debug, Default, Clone, Deserialize, ToSchema)]
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

/// "This and following": ends the series before the occurrence starting at `original_start_time`
/// and starts a new one there, with the changes given. See `agent_docs/recurrence-exceptions.md`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SplitEventRequest {
    /// The occurrence's start in the series (ISO 8601 UTC), before any edit.
    pub original_start_time: String,
    /// The new series' changes from the occurrence. Its `recurrenceRule` is the new series'
    /// rule; the client sends it, since only it can count how far a COUNT has run. Absent, the
    /// new series keeps the old one's rule; empty, it doesn't repeat.
    #[serde(flatten)]
    pub changes: UpdateEventRequest,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsQuery {
    /// Start of range (ISO 8601 UTC). Defaults to start of current month.
    pub from: Option<String>,
    /// End of range (ISO 8601 UTC). Defaults to end of current month.
    pub to: Option<String>,
    /// Also return every exception of every recurring event returned. Off, exceptions are left
    /// out, and a client that can't apply them sees each series as it was before they existed.
    #[serde(default)]
    pub exceptions: bool,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEventQuery {
    /// Delete this occurrence (its start in the series, ISO 8601 UTC) and every one after it,
    /// ending the series before it. At or before the first occurrence, deletes the whole series.
    pub from_occurrence: Option<String>,
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
    /// Set on an exception: the series whose occurrence it stands in for.
    pub recurring_event_id: Option<String>,
    /// Set on an exception: the occurrence's start in the series, before any edit.
    pub original_start_time: Option<String>,
    /// An exception that deletes its occurrence.
    pub cancelled: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsResponse {
    pub events: Vec<EventResponse>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventChangesQuery {
    /// The `cursor` of the previous response. Omitted, the response is only a cursor to start
    /// from: take one before loading anything, so nothing changed during the load is missed.
    pub since: Option<String>,
    /// Report changed exceptions too; see `ListEventsQuery::exceptions`.
    #[serde(default)]
    pub exceptions: bool,
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
