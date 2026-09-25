use chrono::NaiveDateTime;
use diesel::prelude::*;

// ── Task Lists ────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::task_lists)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TaskListRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::task_lists)]
pub struct NewTaskListRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::task_lists)]
pub struct UpdateTaskListRecord {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
    pub updated_at: NaiveDateTime,
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::tasks)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TaskRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub done: bool,
    pub due_date: Option<NaiveDateTime>,
    pub position: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    /// The calendar event this task is scheduled as, or `None` when it is not on
    /// the calendar. Written only by the schedule/unschedule endpoints.
    pub event_id: Option<String>,
    /// `due_date` is an instant rather than a `<day>T00:00:00Z` date.
    pub due_has_time: bool,
    pub start_date: Option<NaiveDateTime>,
    /// `start_date` is an instant rather than a `<day>T00:00:00Z` date.
    pub start_has_time: bool,
    /// 1 (high) to 3 (low), or `None` for no priority.
    pub priority: Option<i32>,
    pub estimate_minutes: Option<i32>,
    pub location: Option<String>,
    /// An RRULE body, stepped by `calendar::recurrence` when the task is completed.
    pub recurrence_rule: Option<String>,
    /// Step from the completion date ("*after 1 week") instead of the due date.
    pub repeat_after_completion: bool,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::tasks)]
pub struct NewTaskRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub done: bool,
    pub due_date: Option<NaiveDateTime>,
    pub position: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub due_has_time: bool,
    pub start_date: Option<NaiveDateTime>,
    pub start_has_time: bool,
    pub priority: Option<i32>,
    pub estimate_minutes: Option<i32>,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    pub repeat_after_completion: bool,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::tasks)]
pub struct UpdateTaskRecord {
    pub title: Option<String>,
    pub notes: Option<Option<String>>,
    pub done: Option<bool>,
    pub due_date: Option<Option<NaiveDateTime>>,
    pub position: Option<i32>,
    pub updated_at: NaiveDateTime,
    pub due_has_time: Option<bool>,
    pub start_date: Option<Option<NaiveDateTime>>,
    pub start_has_time: Option<bool>,
    pub priority: Option<Option<i32>>,
    pub estimate_minutes: Option<Option<i32>>,
    pub location: Option<Option<String>>,
    pub recurrence_rule: Option<Option<String>>,
    pub repeat_after_completion: Option<bool>,
}

impl UpdateTaskRecord {
    /// A changeset that only bumps `updated_at`, to spread a single field over.
    pub fn empty(updated_at: NaiveDateTime) -> Self {
        UpdateTaskRecord {
            title: None,
            notes: None,
            done: None,
            due_date: None,
            position: None,
            updated_at,
            due_has_time: None,
            start_date: None,
            start_has_time: None,
            priority: None,
            estimate_minutes: None,
            location: None,
            recurrence_rule: None,
            repeat_after_completion: None,
        }
    }
}

// ── Task Attachments ──────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::task_attachments)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TaskAttachmentRecord {
    pub id: String,
    pub task_id: String,
    pub file_id: Option<String>,
    pub name: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::task_attachments)]
pub struct NewTaskAttachmentRecord {
    pub id: String,
    pub task_id: String,
    pub file_id: Option<String>,
    pub name: Option<String>,
    pub note: Option<String>,
}

// ── Task List Memberships ─────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::task_list_memberships)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TaskListMembershipRecord {
    pub task_id: String,
    pub list_id: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::task_list_memberships)]
pub struct NewTaskListMembershipRecord {
    pub task_id: String,
    pub list_id: String,
}

// ── Task Tags ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = crate::schema::task_tags)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TaskTagRecord {
    pub task_id: String,
    pub tag: String,
}
