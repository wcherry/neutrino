use chrono::NaiveDateTime;
use diesel::prelude::*;
use crate::schema::{shared_drives, shared_drive_members};

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

#[derive(Debug, Insertable)]
#[diesel(table_name = shared_drives)]
pub struct NewSharedDrive<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub created_by: &'a str,
    pub storage_used_bytes: i64,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

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

#[derive(Debug, Insertable)]
#[diesel(table_name = shared_drive_members)]
pub struct NewSharedDriveMember<'a> {
    pub id: &'a str,
    pub shared_drive_id: &'a str,
    pub user_id: &'a str,
    pub user_email: &'a str,
    pub user_name: &'a str,
    pub role: &'a str,
    pub added_by: &'a str,
    pub created_at: NaiveDateTime,
}
