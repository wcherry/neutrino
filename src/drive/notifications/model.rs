use crate::schema::notifications;
use diesel::prelude::*;
use serde::Serialize;

#[derive(Debug, Queryable, Selectable, Serialize, Clone)]
#[diesel(table_name = notifications)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Notification {
    pub id: String,
    pub recipient_id: String,
    pub event_type: String,
    pub payload: String,
    pub is_read: i32,
    pub email_sent: i32,
    pub created_at: chrono::NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = notifications)]
pub struct NewNotification {
    pub id: String,
    pub recipient_id: String,
    pub event_type: String,
    pub payload: String,
    pub is_read: i32,
    pub email_sent: i32,
    pub created_at: chrono::NaiveDateTime,
}
