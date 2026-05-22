use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::events)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct EventRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_time: NaiveDateTime,
    pub end_time: NaiveDateTime,
    pub all_day: bool,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    pub external_id: Option<String>,
    pub source: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub timezone: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::events)]
pub struct NewEventRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_time: NaiveDateTime,
    pub end_time: NaiveDateTime,
    pub all_day: bool,
    pub location: Option<String>,
    pub recurrence_rule: Option<String>,
    pub external_id: Option<String>,
    pub source: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub timezone: Option<String>,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::events)]
pub struct UpdateEventRecord {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub start_time: Option<NaiveDateTime>,
    pub end_time: Option<NaiveDateTime>,
    pub all_day: Option<bool>,
    pub location: Option<Option<String>>,
    pub recurrence_rule: Option<Option<String>>,
    pub updated_at: NaiveDateTime,
    pub timezone: Option<Option<String>>,
}
