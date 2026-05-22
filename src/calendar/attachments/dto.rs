use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAttachmentRequest {
    /// Drive file ID (omit for a text note)
    pub file_id: Option<String>,
    /// Display name for the file attachment
    pub name: Option<String>,
    /// Inline text note (omit for a file attachment)
    pub note: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentResponse {
    pub id: String,
    pub event_id: String,
    pub file_id: Option<String>,
    pub name: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAttachmentsResponse {
    pub attachments: Vec<AttachmentResponse>,
}
