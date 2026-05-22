use crate::drive::storage::model::FileRecord;
use crate::drive::tags::model::TagRecord;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TagResponse {
    pub id: String,
    pub name: String,
    pub created_at: NaiveDateTime,
}

impl From<TagRecord> for TagResponse {
    fn from(t: TagRecord) -> Self {
        TagResponse {
            id: t.id,
            name: t.name,
            created_at: t.created_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTagsResponse {
    pub tags: Vec<TagResponse>,
    pub total: usize,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagRequest {
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagRequest {
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetFileTagsRequest {
    /// List of tag IDs to assign to the file (replaces existing tags).
    pub tag_ids: Vec<String>,
}

/// A minimal file summary returned when listing files by tag.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaggedFileResponse {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

impl From<FileRecord> for TaggedFileResponse {
    fn from(f: FileRecord) -> Self {
        TaggedFileResponse {
            id: f.id,
            name: f.name,
            mime_type: f.mime_type,
            size_bytes: f.size_bytes,
            folder_id: f.folder_id,
            created_at: f.created_at,
            updated_at: f.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaggedFilesResponse {
    pub files: Vec<TaggedFileResponse>,
    pub total: usize,
}
