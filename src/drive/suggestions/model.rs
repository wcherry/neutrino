use diesel::prelude::*;
use serde::Serialize;
use crate::schema::doc_suggestions;

#[derive(Debug, Queryable, Selectable, Serialize, Clone)]
#[diesel(table_name = doc_suggestions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DocSuggestion {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub content_json: String,
    pub status: String,
    pub created_at: chrono::NaiveDateTime,
    pub resolved_at: Option<chrono::NaiveDateTime>,
    pub resolved_by: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = doc_suggestions)]
pub struct NewDocSuggestion {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub content_json: String,
    pub status: String,
    pub created_at: chrono::NaiveDateTime,
}
