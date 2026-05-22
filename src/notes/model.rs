use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::notes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct NoteRecord {
    pub file_id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::notes)]
pub struct NewNoteRecord<'a> {
    pub file_id: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::notes)]
pub struct UpdateNoteRecord {
    pub updated_at: NaiveDateTime,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::note_links)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct NoteLinkRecord {
    pub source_note_id: String,
    pub target_note_id: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::note_links)]
pub struct NewNoteLinkRecord<'a> {
    pub source_note_id: &'a str,
    pub target_note_id: &'a str,
}
