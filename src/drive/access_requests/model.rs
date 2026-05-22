use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::access_requests)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AccessRequestRecord {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub requester_id: String,
    pub requester_email: String,
    pub requester_name: String,
    pub message: Option<String>,
    pub requested_role: String,
    pub status: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::access_requests)]
pub struct NewAccessRequestRecord<'a> {
    pub id: &'a str,
    pub resource_type: &'a str,
    pub resource_id: &'a str,
    pub requester_id: &'a str,
    pub requester_email: &'a str,
    pub requester_name: &'a str,
    pub message: Option<&'a str>,
    pub requested_role: &'a str,
    pub status: &'a str,
}
