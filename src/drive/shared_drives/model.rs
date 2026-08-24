use crate::schema::{shared_drive_members, shared_drives};
use chrono::NaiveDateTime;
use diesel::prelude::*;

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = shared_drives)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SharedDrive {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_by: String,
    pub storage_used_bytes: i64,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

// Only `role` is read (to report the caller's own role); the rest are here
// because Diesel's `Selectable` derive maps every selected column.
#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = shared_drive_members)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SharedDriveMember {
    pub id: String,
    pub shared_drive_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub role: String,
    pub added_by: String,
    pub created_at: NaiveDateTime,
}
