use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::tags)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TagRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::tags)]
pub struct NewTagRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub name: &'a str,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::file_tags)]
pub struct NewFileTag<'a> {
    pub file_id: &'a str,
    pub tag_id: &'a str,
}
