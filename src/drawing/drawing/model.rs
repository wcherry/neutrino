use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::drawings)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DrawingRecord {
    pub file_id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::drawings)]
pub struct NewDrawingRecord<'a> {
    pub file_id: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::drawings)]
pub struct UpdateDrawingRecord {
    pub updated_at: NaiveDateTime,
}
