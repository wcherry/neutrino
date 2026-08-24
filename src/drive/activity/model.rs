use crate::schema::file_activity_log;
use diesel::prelude::*;

#[derive(Debug, Insertable)]
#[diesel(table_name = file_activity_log)]
pub struct NewActivityEntry {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub action: String,
    pub detail_json: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub resource_type: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}
