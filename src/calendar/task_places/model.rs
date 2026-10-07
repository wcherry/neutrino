use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::task_places)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TaskPlaceRecord {
    pub id: String,
    pub user_id: String,
    /// A v1 PlaceEnvelope. Opaque here: never parsed, never logged.
    pub encrypted_payload: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::task_places)]
pub struct NewTaskPlaceRecord {
    pub id: String,
    pub user_id: String,
    pub encrypted_payload: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}
