use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::file_links)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FileLinkRecord {
    pub source_file_id: String,
    pub target_file_id: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::file_links)]
pub struct NewFileLinkRecord<'a> {
    pub source_file_id: &'a str,
    pub target_file_id: &'a str,
}
