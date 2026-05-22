use chrono::NaiveDateTime;
use diesel::prelude::*;

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::calendar_connections)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ConnectionRecord {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<NaiveDateTime>,
    pub sync_cursor: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub email: Option<String>,
    pub caldav_url: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::calendar_connections)]
pub struct NewConnectionRecord {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<NaiveDateTime>,
    pub sync_cursor: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub email: Option<String>,
    pub caldav_url: Option<String>,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::calendar_connections)]
pub struct UpdateConnectionTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<NaiveDateTime>,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::calendar_connections)]
pub struct UpdateSyncCursor {
    pub sync_cursor: Option<String>,
    pub updated_at: NaiveDateTime,
}
