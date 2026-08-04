use crate::drive::filesystem::model::{FolderRecord, ShortcutRecord};
use crate::drive::storage::model::FileRecord;
use crate::shared::ListQueryParams;
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
    Doc,
    Sheet,
    Slide,
    Diagram,
    Drawing,
    Note,
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
            DriveFileType::Doc => &["application/x-neutrino-doc"],
            DriveFileType::Sheet => &["application/x-neutrino-sheet"],
            DriveFileType::Slide => &["application/x-neutrino-slide"],
            DriveFileType::Diagram => &["application/x-neutrino-diagram"],
            DriveFileType::Drawing => &["application/x-neutrino-drawing"],
            DriveFileType::Note => &["application/x-neutrino-note"],
        }
    }

    /// Whether a MIME type matches this file type, in memory.
    ///
    /// The SQL counterpart is [`Self::mime_patterns`] fed to `LIKE`; this is for
    /// the listings that are already loaded and sorted in Rust (folder contents,
    /// the `view=` listings, trash, shared-with-me, tagged files) rather than
    /// filtered in the query. Every pattern is either an exact MIME or a
    /// trailing-`%` prefix, so those are the only two forms handled.
    pub fn matches(&self, mime: &str) -> bool {
        self.mime_patterns()
            .iter()
            .any(|pattern| match pattern.strip_suffix('%') {
                Some(prefix) => mime.starts_with(prefix),
                None => mime == *pattern,
            })
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

impl RootContentsQuery {
    /// The pagination/sort subset, for the services that take a plain list query.
    pub fn list_params(&self) -> ListQueryParams<FolderContentsOrderField> {
        ListQueryParams {
            limit: self.limit,
            offset: self.offset,
            order_by: self.order_by,
            direction: self.direction,
        }
    }
}

/// The trash listing's query: the usual pagination/sort plus the same `type`
/// filter the drive listings take.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashContentsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub order_by: Option<TrashOrderField>,
    pub direction: Option<crate::shared::OrderDirection>,
    /// List only trashed files of this type. Trashed folders are always listed.
    #[serde(rename = "type")]
    pub file_type: Option<DriveFileType>,
}

impl TrashContentsQuery {
    pub fn list_params(&self) -> ListQueryParams<TrashOrderField> {
        ListQueryParams {
            limit: self.limit,
            offset: self.offset,
            order_by: self.order_by,
            direction: self.direction,
        }
    }
}

/// The shared-with-me listing's query. Only `type` — the endpoint returns
/// everything shared with the user, unpaginated.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedWithMeQuery {
    /// List only shared files of this type. Shared folders are always listed.
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
    fn list_params_carries_the_pagination_and_sort_subset() {
        let q: RootContentsQuery = serde_json::from_str(
            r#"{"limit":10,"offset":20,"orderBy":"createdAt","direction":"desc"}"#,
        )
        .unwrap();
        let params = q.list_params();
        assert_eq!(params.limit, Some(10));
        assert_eq!(params.offset, Some(20));
        assert_eq!(params.order_by, Some(FolderContentsOrderField::CreatedAt));
        assert_eq!(params.direction, Some(crate::shared::OrderDirection::Desc));
    }

    #[test]
    fn list_params_drops_the_whole_drive_filters() {
        // The folder listing takes the same query type as the root listing but
        // only honours the subset below; `view`/`type` are drive-wide.
        let q: RootContentsQuery =
            serde_json::from_str(r#"{"view":"recent","type":"photo","limit":5}"#).unwrap();
        let params = q.list_params();
        assert_eq!(params.limit, Some(5));
        assert_eq!(params.order_by, None);
        assert_eq!(params.direction, None);
    }

    #[test]
    fn matches_handles_exact_mimes() {
        assert!(DriveFileType::Doc.matches("application/x-neutrino-doc"));
        assert!(!DriveFileType::Doc.matches("application/x-neutrino-note"));
        assert!(DriveFileType::Note.matches("application/x-neutrino-note"));
        assert!(!DriveFileType::Note.matches("image/png"));
    }

    #[test]
    fn matches_handles_wildcard_prefixes() {
        assert!(DriveFileType::Photo.matches("image/png"));
        assert!(DriveFileType::Photo.matches("image/jpeg"));
        assert!(!DriveFileType::Photo.matches("video/mp4"));
        // The prefix must be a real prefix, not a substring.
        assert!(!DriveFileType::Photo.matches("application/image/png"));
    }

    #[test]
    fn matches_accepts_any_of_several_patterns() {
        assert!(DriveFileType::Document.matches("text/plain"));
        assert!(DriveFileType::Document.matches("application/pdf"));
        assert!(DriveFileType::Document.matches("application/vnd.oasis.opendocument.text"));
        assert!(!DriveFileType::Document.matches("image/png"));
    }

    #[test]
    fn matches_agrees_with_the_sql_patterns() {
        // Every exact (non-wildcard) pattern must match itself, so the in-memory
        // filter and the `LIKE` query cannot drift apart.
        for file_type in [
            DriveFileType::Photo,
            DriveFileType::Video,
            DriveFileType::Audio,
            DriveFileType::Document,
            DriveFileType::Doc,
            DriveFileType::Sheet,
            DriveFileType::Slide,
            DriveFileType::Diagram,
            DriveFileType::Drawing,
            DriveFileType::Note,
        ] {
            for pattern in file_type.mime_patterns() {
                let sample = pattern.replace('%', "sample");
                assert!(
                    file_type.matches(&sample),
                    "{file_type:?} should match {sample}"
                );
            }
        }
    }

    #[test]
    fn document_covers_pdf_and_text_not_images() {
        let patterns = DriveFileType::Document.mime_patterns();
        assert!(patterns.contains(&"application/pdf"));
        assert!(patterns.contains(&"text/%"));
        assert!(!patterns.contains(&"image/%"));
    }

    #[test]
    fn photo_video_audio_match_only_their_own_wildcard() {
        assert_eq!(DriveFileType::Photo.mime_patterns(), &["image/%"]);
        assert_eq!(DriveFileType::Video.mime_patterns(), &["video/%"]);
        assert_eq!(DriveFileType::Audio.mime_patterns(), &["audio/%"]);
    }

    #[test]
    fn doc_matches_only_its_own_exact_mime() {
        assert_eq!(
            DriveFileType::Doc.mime_patterns(),
            &["application/x-neutrino-doc"]
        );
    }

    #[test]
    fn sheet_matches_only_its_own_exact_mime() {
        assert_eq!(
            DriveFileType::Sheet.mime_patterns(),
            &["application/x-neutrino-sheet"]
        );
    }

    #[test]
    fn slide_matches_only_its_own_exact_mime() {
        assert_eq!(
            DriveFileType::Slide.mime_patterns(),
            &["application/x-neutrino-slide"]
        );
    }

    #[test]
    fn diagram_matches_only_its_own_exact_mime() {
        assert_eq!(
            DriveFileType::Diagram.mime_patterns(),
            &["application/x-neutrino-diagram"]
        );
    }

    #[test]
    fn drawing_matches_only_its_own_exact_mime() {
        assert_eq!(
            DriveFileType::Drawing.mime_patterns(),
            &["application/x-neutrino-drawing"]
        );
    }

    #[test]
    fn note_matches_only_its_own_exact_mime() {
        assert_eq!(
            DriveFileType::Note.mime_patterns(),
            &["application/x-neutrino-note"]
        );
    }

    #[test]
    fn root_query_parses_new_native_type_variants() {
        for (json_val, expected) in [
            (r#"{"type":"doc"}"#, DriveFileType::Doc),
            (r#"{"type":"sheet"}"#, DriveFileType::Sheet),
            (r#"{"type":"slide"}"#, DriveFileType::Slide),
            (r#"{"type":"diagram"}"#, DriveFileType::Diagram),
            (r#"{"type":"drawing"}"#, DriveFileType::Drawing),
            (r#"{"type":"note"}"#, DriveFileType::Note),
        ] {
            let q: RootContentsQuery = serde_json::from_str(json_val).unwrap();
            assert_eq!(q.file_type, Some(expected));
        }
    }
}
