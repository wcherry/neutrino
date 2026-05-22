use diesel::prelude::*;

#[derive(Queryable, Selectable, Debug)]
#[diesel(table_name = crate::schema::file_content_index)]
pub struct ContentIndex {
    pub file_id: String,
    pub user_id: String,
    pub indexed_at: chrono::NaiveDateTime,
    pub text_content: String,
}

#[derive(Insertable)]
#[diesel(table_name = crate::schema::file_content_index)]
pub struct NewContentIndex {
    pub file_id: String,
    pub user_id: String,
    pub indexed_at: chrono::NaiveDateTime,
    pub text_content: String,
}
