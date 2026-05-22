use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::docs)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DocRecord {
    pub file_id: String,
    pub page_setup: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::docs)]
pub struct NewDocRecord<'a> {
    pub file_id: &'a str,
    pub page_setup: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::docs)]
pub struct UpdateDocRecord {
    pub page_setup: Option<String>,
    pub updated_at: NaiveDateTime,
}
