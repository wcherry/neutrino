use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::events)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct EventRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_time: NaiveDateTime,
    pub end_time: NaiveDateTime,
    pub all_day: bool,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    pub external_id: Option<String>,
    pub source: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub timezone: Option<String>,
    /// Set when the event is deleted; the row stays so the changes feed can report it. Every
    /// read of live events filters on this being NULL.
    pub deleted_at: Option<NaiveDateTime>,
    /// The series this row is an exception of; see `agent_docs/recurrence-exceptions.md`.
    pub recurring_event_id: Option<String>,
    /// The start the occurrence had in its series: an exception's key.
    pub original_start_time: Option<NaiveDateTime>,
    /// An exception that deletes its occurrence.
    pub cancelled: bool,
    /// The calendar the event belongs to; an exception's is its series'. NULL only on a row
    /// deleted with its calendar.
    pub calendar_id: Option<String>,
}

impl EventRecord {
    pub fn is_exception(&self) -> bool {
        self.recurring_event_id.is_some()
    }

    pub fn is_recurring(&self) -> bool {
        self.recurrence_rule
            .as_deref()
            .is_some_and(|r| !r.is_empty())
    }
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::events)]
pub struct NewEventRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_time: NaiveDateTime,
    pub end_time: NaiveDateTime,
    pub all_day: bool,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    pub external_id: Option<String>,
    pub source: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub timezone: Option<String>,
    pub recurring_event_id: Option<String>,
    pub original_start_time: Option<NaiveDateTime>,
    pub cancelled: bool,
    pub calendar_id: Option<String>,
}

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = crate::schema::events)]
pub struct UpdateEventRecord {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub start_time: Option<NaiveDateTime>,
    pub end_time: Option<NaiveDateTime>,
    pub all_day: Option<bool>,
    pub location: Option<Option<String>>,
    pub recurrence_rule: Option<Option<String>>,
    pub updated_at: NaiveDateTime,
    pub timezone: Option<Option<String>>,
    /// `Some(None)` revives a deleted event; see `upsert_from_sync`.
    pub deleted_at: Option<Option<NaiveDateTime>>,
    pub original_start_time: Option<Option<NaiveDateTime>>,
    pub recurring_event_id: Option<Option<String>>,
    pub cancelled: Option<bool>,
    pub calendar_id: Option<Option<String>>,
}
