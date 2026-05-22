use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::reminders)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ReminderRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub due_time: NaiveDateTime,
    pub completed: bool,
    pub recurrence_rule: Option<String>,
    pub linked_event_id: Option<String>,
    pub notified_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::reminders)]
pub struct NewReminderRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub due_time: NaiveDateTime,
    pub completed: bool,
    pub recurrence_rule: Option<String>,
    pub linked_event_id: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::reminders)]
pub struct UpdateReminderRecord {
    pub title: Option<String>,
    pub due_time: Option<NaiveDateTime>,
    pub completed: Option<bool>,
    pub recurrence_rule: Option<Option<String>>,
    pub notified_at: Option<Option<NaiveDateTime>>,
    pub updated_at: NaiveDateTime,
}
