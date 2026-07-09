use crate::drive::filesystem::model::{FolderRecord, ShortcutRecord};
use crate::drive::storage::model::FileRecord;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Folder DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFolderRequest {
    pub name: Option<String>,
    /// Set color label (null to clear)
    pub color: Option<Option<String>>,
    pub is_starred: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FolderResponse {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub is_starred: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

impl From<FolderRecord> for FolderResponse {
    fn from(f: FolderRecord) -> Self {
        FolderResponse {
            id: f.id,
            name: f.name,
            parent_id: f.parent_id,
            color: f.color,
            is_starred: f.is_starred,
            created_at: f.created_at,
            updated_at: f.updated_at,
        }
    }
}

// ── File update DTOs ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFileRequest {
    pub name: Option<String>,
    /// Move to folder (null = move to root)
    pub folder_id: Option<Option<String>>,
    pub is_starred: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileResponse {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub mime_type: String,
    pub folder_id: Option<String>,
    pub is_starred: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
    pub encrypted_metadata: Option<String>,
}

impl From<FileRecord> for FileResponse {
    fn from(f: FileRecord) -> Self {
        FileResponse {
            id: f.id,
            name: f.name,
            size_bytes: f.size_bytes,
            mime_type: f.mime_type,
            folder_id: f.folder_id,
            is_starred: f.is_starred,
            created_at: f.created_at,
            updated_at: f.updated_at,
            cover_thumbnail: f.cover_thumbnail,
            cover_thumbnail_mime_type: f.cover_thumbnail_mime_type,
            encrypted_metadata: f.encrypted_metadata,
        }
    }
}

// ── Drive view filter ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum DriveView {
    Recent,
    Starred,
    Trash,
}

/// Filter drive contents to a single kind of file, matched by MIME type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum DriveFileType {
    Photo,
    Video,
    Audio,
    Document,
}

impl DriveFileType {
    /// SQL `LIKE` patterns that a file's MIME type must match (any of them).
    pub fn mime_patterns(&self) -> &'static [&'static str] {
        match self {
            DriveFileType::Photo => &["image/%"],
            DriveFileType::Video => &["video/%"],
            DriveFileType::Audio => &["audio/%"],
            DriveFileType::Document => &[
                "text/%",
                "application/pdf",
                "application/msword",
                "application/vnd.%",
                "application/rtf",
            ],
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootContentsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub order_by: Option<FolderContentsOrderField>,
    pub direction: Option<crate::shared::OrderDirection>,
    pub view: Option<DriveView>,
    /// List only files of this type (e.g. `photo`) across the whole drive.
    #[serde(rename = "type")]
    pub file_type: Option<DriveFileType>,
}

// ── Folder contents ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FolderContentsResponse {
    /// Present when listing a non-root folder
    pub folder: Option<FolderResponse>,
    pub folders: Vec<FolderResponse>,
    pub files: Vec<FileResponse>,
    pub shortcuts: Vec<ShortcutResponse>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum FolderContentsOrderField {
    Name,
    CreatedAt,
    UpdatedAt,
}

// ── Shortcut DTOs ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateShortcutRequest {
    pub target_file_id: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutResponse {
    pub id: String,
    pub target_file_id: String,
    pub folder_id: Option<String>,
    pub created_at: NaiveDateTime,
}

impl From<ShortcutRecord> for ShortcutResponse {
    fn from(s: ShortcutRecord) -> Self {
        ShortcutResponse {
            id: s.id,
            target_file_id: s.target_file_id,
            folder_id: s.folder_id,
            created_at: s.created_at,
        }
    }
}

// ── Bulk DTOs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkMoveRequest {
    pub file_ids: Vec<String>,
    pub folder_ids: Vec<String>,
    /// Target folder (null = root)
    pub target_folder_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkTrashRequest {
    pub file_ids: Vec<String>,
    pub folder_ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkResult {
    pub affected: usize,
}

// ── Starred (Quick Access) DTOs ───────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StarredContentsResponse {
    pub files: Vec<FileResponse>,
    pub folders: Vec<FolderResponse>,
}

// ── Trash DTOs ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrashFileItem {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub mime_type: String,
    pub deleted_at: NaiveDateTime,
}

impl From<FileRecord> for TrashFileItem {
    fn from(f: FileRecord) -> Self {
        TrashFileItem {
            id: f.id,
            name: f.name,
            size_bytes: f.size_bytes,
            mime_type: f.mime_type,
            deleted_at: f.deleted_at.unwrap_or(f.updated_at),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrashFolderItem {
    pub id: String,
    pub name: String,
    pub deleted_at: NaiveDateTime,
}

impl From<FolderRecord> for TrashFolderItem {
    fn from(f: FolderRecord) -> Self {
        TrashFolderItem {
            id: f.id,
            name: f.name,
            deleted_at: f.deleted_at.unwrap_or(f.updated_at),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrashContentsResponse {
    pub files: Vec<TrashFileItem>,
    pub folders: Vec<TrashFolderItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum TrashOrderField {
    Name,
    TrashedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_query_parses_type_param_as_file_type() {
        // The query key is `type` (renamed) and the value is camelCase.
        let q: RootContentsQuery = serde_json::from_str(r#"{"type":"photo"}"#).unwrap();
        assert_eq!(q.file_type, Some(DriveFileType::Photo));
    }

    #[test]
    fn root_query_type_is_optional() {
        let q: RootContentsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(q.file_type, None);
    }

    #[test]
    fn document_covers_pdf_and_text_not_images() {
        let patterns = DriveFileType::Document.mime_patterns();
        assert!(patterns.contains(&"application/pdf"));
        assert!(patterns.contains(&"text/%"));
        assert!(!patterns.contains(&"image/%"));
    }
}
