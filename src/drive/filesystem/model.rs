use chrono::NaiveDateTime;
use diesel::prelude::*;

// ── Folder ────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::folders)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FolderRecord {
    pub id: String,
    pub user_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub is_starred: bool,
    pub color: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub starred_at: Option<NaiveDateTime>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::folders)]
pub struct NewFolderRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub parent_id: Option<&'a str>,
    pub name: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::folders)]
pub struct UpdateFolderRecord {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
    pub is_starred: Option<bool>,
    pub starred_at: Option<Option<NaiveDateTime>>,
    pub parent_id: Option<Option<String>>,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::folders)]
pub struct TrashFolderRecord {
    pub deleted_at: Option<NaiveDateTime>,
    pub updated_at: NaiveDateTime,
}

// ── Shortcut ──────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::shortcuts)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ShortcutRecord {
    pub id: String,
    pub user_id: String,
    pub target_file_id: String,
    pub folder_id: Option<String>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::shortcuts)]
pub struct NewShortcutRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub target_file_id: &'a str,
    pub folder_id: Option<&'a str>,
}
