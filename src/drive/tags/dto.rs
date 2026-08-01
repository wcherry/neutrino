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
    /// Number of non-trashed files carrying this tag. Clients order tag lists
    /// by this ("most used first"), so it is always populated.
    pub file_count: i64,
}

impl TagResponse {
    pub fn from_record(t: TagRecord, file_count: i64) -> Self {
        TagResponse {
            id: t.id,
            name: t.name,
            created_at: t.created_at,
            file_count,
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

/// A file returned when listing files by tag.
///
/// Deliberately mirrors `filesystem::dto::FileResponse` field-for-field: the
/// web client feeds both into the same `FileItem`/`FileGrid` rendering path,
/// which needs the star state, cover thumbnail, and content version.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaggedFileResponse {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub is_starred: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
    pub encrypted_metadata: Option<String>,
    pub content_version: i32,
}

impl From<FileRecord> for TaggedFileResponse {
    fn from(f: FileRecord) -> Self {
        TaggedFileResponse {
            id: f.id,
            name: f.name,
            mime_type: f.mime_type,
            size_bytes: f.size_bytes,
            folder_id: f.folder_id,
            is_starred: f.is_starred,
            created_at: f.created_at,
            updated_at: f.updated_at,
            cover_thumbnail: f.cover_thumbnail,
            cover_thumbnail_mime_type: f.cover_thumbnail_mime_type,
            encrypted_metadata: f.encrypted_metadata,
            content_version: f.content_version,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaggedFilesResponse {
    pub files: Vec<TaggedFileResponse>,
    /// Total number of accessible files carrying the tag, before pagination.
    pub total: usize,
    pub limit: i64,
    pub offset: i64,
}
