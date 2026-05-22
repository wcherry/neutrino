use serde::Serialize;
use crate::drive::activity::model::ActivityEntry;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntryResponse {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub action: String,
    pub detail: Option<serde_json::Value>,
    pub created_at: String,
}

impl From<ActivityEntry> for ActivityEntryResponse {
    fn from(e: ActivityEntry) -> Self {
        let detail = e.detail_json.as_deref().and_then(|d| serde_json::from_str(d).ok());
        ActivityEntryResponse {
            id: e.id,
            file_id: e.file_id,
            user_id: e.user_id,
            user_name: e.user_name,
            action: e.action,
            detail,
            created_at: e.created_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityListResponse {
    pub entries: Vec<ActivityEntryResponse>,
    pub total: i64,
}
