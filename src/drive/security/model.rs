use chrono::NaiveDateTime;
use diesel::prelude::*;
use crate::schema::{ransomware_events, siem_configs};

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = ransomware_events)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct RansomwareEvent {
    pub id: String,
    pub user_id: String,
    pub triggered_at: NaiveDateTime,
    pub event_count: i32,
    pub status: String,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<NaiveDateTime>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = ransomware_events)]
pub struct NewRansomwareEvent<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub triggered_at: NaiveDateTime,
    pub event_count: i32,
    pub status: &'a str,
}

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = siem_configs)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SiemConfig {
    pub id: String,
    pub endpoint_url: String,
    pub api_key: String,
    pub format: String,
    pub is_active: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = siem_configs)]
pub struct NewSiemConfig<'a> {
    pub id: &'a str,
    pub endpoint_url: &'a str,
    pub api_key: &'a str,
    pub format: &'a str,
    pub is_active: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}
