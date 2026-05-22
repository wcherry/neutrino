use serde::Serialize;
use crate::drive::notifications::model::Notification;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationResponse {
    pub id: String,
    pub recipient_id: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub is_read: bool,
    pub created_at: String,
}

impl From<Notification> for NotificationResponse {
    fn from(n: Notification) -> Self {
        let payload = serde_json::from_str(&n.payload).unwrap_or(serde_json::Value::Null);
        NotificationResponse {
            id: n.id,
            recipient_id: n.recipient_id,
            event_type: n.event_type,
            payload,
            is_read: n.is_read != 0,
            created_at: n.created_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListResponse {
    pub notifications: Vec<NotificationResponse>,
    pub unread_count: i64,
    pub total: i64,
}
