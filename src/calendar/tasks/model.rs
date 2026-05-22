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
