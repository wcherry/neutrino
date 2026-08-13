use diesel::prelude::*;

#[allow(dead_code)] // `file_id` completes the row shape diesel selects.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::docs)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DocRecord {
    pub file_id: String,
    pub page_setup: String,
}

#[derive(Debug, Insertable, AsChangeset)]
#[diesel(table_name = crate::schema::docs)]
pub struct NewDocRecord<'a> {
    pub file_id: &'a str,
    pub page_setup: &'a str,
}
