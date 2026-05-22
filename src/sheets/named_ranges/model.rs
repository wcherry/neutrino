use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::named_ranges)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct NamedRangeRecord {
    pub id: String,
    pub sheet_db_id: String,
    pub sheet_id: String,
    pub start_row: i32,
    pub start_col: i32,
    pub end_row: i32,
    pub end_col: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::named_ranges)]
pub struct NewNamedRangeRecord<'a> {
    pub id: &'a str,
    pub sheet_db_id: &'a str,
    pub sheet_id: &'a str,
    pub start_row: i32,
    pub start_col: i32,
    pub end_row: i32,
    pub end_col: i32,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::named_ranges)]
pub struct UpdateNamedRangeRecord {
    pub start_row: i32,
    pub start_col: i32,
    pub end_row: i32,
    pub end_col: i32,
    pub updated_at: NaiveDateTime,
}
