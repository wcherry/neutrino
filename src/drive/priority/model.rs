use diesel::prelude::*;

#[derive(Queryable, Selectable, Debug)]
#[diesel(table_name = crate::schema::file_access_scores)]
pub struct FileAccessScore {
    pub file_id: String,
    pub user_id: String,
    pub score: f64,
    pub computed_at: chrono::NaiveDateTime,
}

#[derive(Insertable)]
#[diesel(table_name = crate::schema::file_access_scores)]
pub struct NewFileAccessScore {
    pub file_id: String,
    pub user_id: String,
    pub score: f64,
    pub computed_at: chrono::NaiveDateTime,
}
