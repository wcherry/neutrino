use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::persons)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct PersonRecord {
    pub id: String,
    pub user_id: String,
    pub cover_face_id: Option<String>,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
    pub face_count: i32,
    pub name: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::persons)]
pub struct NewPersonRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub cover_face_id: Option<&'a str>,
    pub cover_thumbnail: Option<&'a str>,
    pub cover_thumbnail_mime_type: Option<&'a str>,
    pub face_count: i32,
    pub name: Option<&'a str>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}
