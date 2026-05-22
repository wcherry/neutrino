use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::share_links)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ShareLinkRecord {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub token: String,
    pub visibility: String,
    pub role: String,
    pub expires_at: Option<NaiveDateTime>,
    pub is_active: bool,
    pub created_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::share_links)]
pub struct NewShareLinkRecord<'a> {
    pub id: &'a str,
    pub resource_type: &'a str,
    pub resource_id: &'a str,
    pub token: &'a str,
    pub visibility: &'a str,
    pub role: &'a str,
    pub expires_at: Option<NaiveDateTime>,
    pub is_active: bool,
    pub created_by: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::share_links)]
pub struct UpdateShareLinkRecord {
    pub visibility: Option<String>,
    pub role: Option<String>,
    pub expires_at: Option<Option<NaiveDateTime>>,
    pub is_active: Option<bool>,
    pub updated_at: NaiveDateTime,
}
