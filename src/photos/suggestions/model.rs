use chrono::NaiveDateTime;
use diesel::prelude::*;

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::face_suggestions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SuggestionRecord {
    pub id: String,
    pub face_id: String,
    pub person_id: String,
    pub confidence: f32,
    /// 'pending' | 'accepted' | 'rejected'
    pub status: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::face_suggestions)]
pub struct NewSuggestionRecord<'a> {
    pub id: &'a str,
    pub face_id: &'a str,
    pub person_id: &'a str,
    pub confidence: f32,
    pub status: &'a str,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}
