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
    /// Server-side content revision. Present here too so a rename response can
    /// be used to refresh a client's optimistic-concurrency guard without a
    /// second round trip — every other file DTO already carries it.
    pub content_version: i32,
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
            content_version: f.content_version,
        }
    }
}

/// Filter drive contents to a single kind of file, matched by MIME type.
///
/// Two generations of value live here and both are answered, because clients
/// ship on their own schedules: the **per-app types** are pinned by the iOS
/// apps (Photos asks for `photo` and `video`, Docs/Sheets/Slides for their own
/// native MIME) and cannot be renamed out from under a released build, while
/// the **categories** are what the web filter chips ask for. A category is
/// coarser on purpose — the web sidebar already has a nav entry per app, so a
/// chip per app filtered Drive by a cut that had already been made, and left
/// the file types a drive actually fills up with (PDFs, archives, source
/// files) with no filter at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum DriveFileType {
    // ── Per-app types ─────────────────────────────────────────────────────────
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

    // ── Categories ────────────────────────────────────────────────────────────
    /// Anything you look at or play: pictures, clips and sound.
    Media,
    /// The office suite — Neutrino's own documents and their uploaded equivalents.
    Office,
    /// The two canvas apps: diagrams and drawings.
    Canvas,
    Pdf,
    Archive,
    Code,
}

/// What a MIME type has to look like to be a given [`DriveFileType`].
///
/// Two lists rather than one because the categories are resolved *in order*
/// (see [`DriveFileType::CATEGORY_ORDER`]): `exclude` is how a later category
/// gives up a file an earlier one has already claimed, which is what keeps a
/// `.docx` — `application/vnd.openxmlformats-officedocument…`, containing the
/// substring "xml" — out of `Code`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MimeFilter {
    /// SQL `LIKE` patterns; matching any one of them is a match.
    pub include: &'static [&'static str],
    /// Patterns that take the file back out again, whatever `include` said.
    pub exclude: Vec<&'static str>,
}

/// The `LIKE` forms these patterns use, matched in memory: `a/%` is a prefix,
/// `%a%` a substring, `%a` a suffix, and a pattern with no `%` is an exact MIME.
///
/// SQLite's `LIKE` is case-insensitive for ASCII, so the comparison is made on
/// a lowercased MIME to keep the in-memory answer and the SQL one the same.
fn like_matches(pattern: &str, mime: &str) -> bool {
    match (pattern.strip_prefix('%'), pattern.strip_suffix('%')) {
        (Some(_), Some(_)) => mime.contains(pattern.trim_matches('%')),
        (Some(suffix), None) => mime.ends_with(suffix),
        (None, Some(prefix)) => mime.starts_with(prefix),
        (None, None) => mime == pattern,
    }
}

impl DriveFileType {
    /// The categories in resolution order: a MIME that could answer to two of
    /// them belongs to the first, and the ones after it exclude the ones before.
    ///
    /// The per-app types are deliberately absent. They are pinned by shipped
    /// clients, so they keep the exact meaning they have always had and overlap
    /// each other freely — `document` and `doc` are different filters, not two
    /// halves of one partition.
    const CATEGORY_ORDER: [DriveFileType; 6] = [
        DriveFileType::Pdf,
        DriveFileType::Media,
        DriveFileType::Canvas,
        DriveFileType::Office,
        DriveFileType::Archive,
        DriveFileType::Code,
    ];

    /// SQL `LIKE` patterns that a file's MIME type must match (any of them),
    /// before precedence between the categories is applied.
    ///
    /// The categories match on substrings where the per-app types match on
    /// prefixes, because the same file arrives under several MIME types
    /// depending on what uploaded it — a zip is `application/zip` from one
    /// browser and `application/x-zip-compressed` from another — and an
    /// exhaustive list of the spellings would be wrong the first time an
    /// unusual one turned up.
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

            DriveFileType::Media => &["image/%", "video/%", "audio/%"],
            DriveFileType::Office => &[
                "application/x-neutrino-doc",
                "application/x-neutrino-sheet",
                "application/x-neutrino-slide",
                "application/x-neutrino-note",
                "%officedocument%",
                "%opendocument%",
                "%msword%",
                "%ms-excel%",
                "%ms-powerpoint%",
                "%spreadsheet%",
                "%presentation%",
                "application/rtf",
                "text/plain",
                "text/markdown",
                "text/csv",
                "text/tab-separated-values",
            ],
            DriveFileType::Canvas => &[
                "application/x-neutrino-diagram",
                "application/x-neutrino-drawing",
            ],
            DriveFileType::Pdf => &["application/pdf"],
            DriveFileType::Archive => &[
                "%zip%",
                "%tar%",
                "%rar%",
                "%7z%",
                "%gzip%",
                "%bzip%",
                "%compressed%",
            ],
            DriveFileType::Code => &[
                "%javascript%",
                "%typescript%",
                "%python%",
                "%ruby%",
                "%java%",
                "%php%",
                "%rust%",
                "%json%",
                "%yaml%",
                "%xml%",
                "%sql%",
                "%x-sh%",
                "%x-go%",
                "%x-perl%",
                "%x-swift%",
                "text/css",
                "text/html",
                "text/x-c",
                "text/x-c++src",
                "text/x-csrc",
            ],
        }
    }

    /// The patterns plus the precedence, as one value the SQL and the in-memory
    /// filter both read — so the two cannot answer the same question differently.
    pub fn mime_filter(&self) -> MimeFilter {
        let exclude = match Self::CATEGORY_ORDER.iter().position(|c| c == self) {
            Some(i) => Self::CATEGORY_ORDER[..i]
                .iter()
                .flat_map(|earlier| earlier.mime_patterns())
                .copied()
                .collect(),
            None => Vec::new(),
        };
        MimeFilter {
            include: self.mime_patterns(),
            exclude,
        }
    }

    /// Whether a MIME type matches this file type, in memory.
    ///
    /// The SQL counterpart is [`Self::mime_filter`] fed to `LIKE`; this is for
    /// the listings that are already loaded and sorted in Rust (the `view=`
    /// listings, trash, shared-with-me, tagged files) rather than filtered in
    /// the query.
    pub fn matches(&self, mime: &str) -> bool {
        let mime = mime.to_ascii_lowercase();
        let filter = self.mime_filter();
        filter
            .include
            .iter()
            .any(|pattern| like_matches(pattern, &mime))
            && !filter
                .exclude
                .iter()
                .any(|pattern| like_matches(pattern, &mime))
    }
}

/// The folder-contents listing's query: `id == user_id` is the folder route's
/// root sentinel (see `get_folder_contents`), so this has no separate "whole
/// drive" mode any more — `type` scopes to whichever folder is being listed.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderContentsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub order_by: Option<FolderContentsOrderField>,
    pub direction: Option<crate::shared::OrderDirection>,
    /// List only files of this type (e.g. `photo`) within the folder being listed.
    #[serde(rename = "type")]
    pub file_type: Option<DriveFileType>,
}

impl FolderContentsQuery {
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

/// The recent-files listing's query: whole-drive, sorted by recency, no
/// pagination beyond `limit`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentQuery {
    pub limit: Option<i64>,
    #[serde(rename = "type")]
    pub file_type: Option<DriveFileType>,
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

/// All of the caller's shortcuts, anywhere in the drive.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutListResponse {
    pub shortcuts: Vec<ShortcutResponse>,
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
    fn folder_query_parses_type_param_as_file_type() {
        // The query key is `type` (renamed) and the value is camelCase.
        let q: FolderContentsQuery = serde_json::from_str(r#"{"type":"photo"}"#).unwrap();
        assert_eq!(q.file_type, Some(DriveFileType::Photo));
    }

    #[test]
    fn folder_query_type_is_optional() {
        let q: FolderContentsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(q.file_type, None);
    }

    #[test]
    fn list_params_carries_the_pagination_and_sort_subset() {
        let q: FolderContentsQuery = serde_json::from_str(
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
    fn list_params_drops_the_type_filter() {
        // `list_params` is the pagination/sort subset; `type` is applied
        // separately by the caller.
        let q: FolderContentsQuery = serde_json::from_str(r#"{"type":"photo","limit":5}"#).unwrap();
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

    /// Every type the enum has, so a new variant cannot be added without the
    /// tests below covering it.
    const ALL_TYPES: [DriveFileType; 16] = [
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
        DriveFileType::Media,
        DriveFileType::Office,
        DriveFileType::Canvas,
        DriveFileType::Pdf,
        DriveFileType::Archive,
        DriveFileType::Code,
    ];

    #[test]
    fn matches_agrees_with_the_sql_patterns() {
        // Every pattern must match a MIME built from it, so the in-memory filter
        // and the `LIKE` query cannot drift apart.
        for file_type in ALL_TYPES {
            for pattern in file_type.mime_patterns() {
                let sample = pattern.replace('%', "sample");
                assert!(
                    file_type.matches(&sample),
                    "{file_type:?} should match {sample}"
                );
            }
        }
    }

    // ── Categories ────────────────────────────────────────────────────────────

    /// A drive's worth of MIME types, including every one that answers to two
    /// categories at once.
    const CORPUS: [&str; 20] = [
        "image/png",
        "image/svg+xml",
        "video/mp4",
        "audio/mpeg",
        "application/pdf",
        "application/x-neutrino-doc",
        "application/x-neutrino-sheet",
        "application/x-neutrino-slide",
        "application/x-neutrino-note",
        "application/x-neutrino-diagram",
        "application/x-neutrino-drawing",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.text",
        "text/plain",
        "text/csv",
        "application/zip",
        "application/x-7z-compressed",
        "application/json",
        "application/octet-stream",
    ];

    const CATEGORIES: [DriveFileType; 6] = [
        DriveFileType::Media,
        DriveFileType::Office,
        DriveFileType::Canvas,
        DriveFileType::Pdf,
        DriveFileType::Archive,
        DriveFileType::Code,
    ];

    #[test]
    fn query_parses_the_category_values() {
        for (raw, expected) in [
            (r#"{"type":"media"}"#, DriveFileType::Media),
            (r#"{"type":"office"}"#, DriveFileType::Office),
            (r#"{"type":"canvas"}"#, DriveFileType::Canvas),
            (r#"{"type":"pdf"}"#, DriveFileType::Pdf),
            (r#"{"type":"archive"}"#, DriveFileType::Archive),
            (r#"{"type":"code"}"#, DriveFileType::Code),
        ] {
            let q: FolderContentsQuery = serde_json::from_str(raw).unwrap();
            assert_eq!(q.file_type, Some(expected), "parsing {raw}");
        }
    }

    #[test]
    fn media_gathers_pictures_clips_and_sound() {
        assert!(DriveFileType::Media.matches("image/png"));
        assert!(DriveFileType::Media.matches("video/quicktime"));
        assert!(DriveFileType::Media.matches("audio/mpeg"));
        assert!(!DriveFileType::Media.matches("application/pdf"));
    }

    #[test]
    fn office_gathers_the_suite_and_its_uploaded_equivalents() {
        for mime in [
            "application/x-neutrino-doc",
            "application/x-neutrino-sheet",
            "application/x-neutrino-slide",
            "application/x-neutrino-note",
            "application/msword",
            "application/vnd.oasis.opendocument.text",
            "text/csv",
        ] {
            assert!(DriveFileType::Office.matches(mime), "office should hold {mime}");
        }
        assert!(!DriveFileType::Office.matches("application/x-neutrino-diagram"));
    }

    #[test]
    fn canvas_gathers_diagrams_and_drawings() {
        assert!(DriveFileType::Canvas.matches("application/x-neutrino-diagram"));
        assert!(DriveFileType::Canvas.matches("application/x-neutrino-drawing"));
        assert!(!DriveFileType::Canvas.matches("application/x-neutrino-doc"));
    }

    /// The precedence the `exclude` half of a [`MimeFilter`] exists for: both of
    /// these contain a substring `code` claims, and both are claimed earlier.
    #[test]
    fn code_gives_up_what_an_earlier_category_claimed() {
        let docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        assert!(DriveFileType::Office.matches(docx));
        assert!(!DriveFileType::Code.matches(docx), "a .docx is not source code");

        assert!(DriveFileType::Media.matches("image/svg+xml"));
        assert!(!DriveFileType::Code.matches("image/svg+xml"));

        // An XML file that is not an office part or an image still is code.
        assert!(DriveFileType::Code.matches("application/xml"));
    }

    #[test]
    fn every_file_belongs_to_at_most_one_category() {
        for mime in CORPUS {
            let claimed: Vec<DriveFileType> = CATEGORIES
                .into_iter()
                .filter(|category| category.matches(mime))
                .collect();
            assert!(
                claimed.len() <= 1,
                "{mime} was claimed by more than one category: {claimed:?}"
            );
        }
    }

    /// `application/octet-stream` is the remainder: it is under no chip, and is
    /// reachable only by listing the folder unfiltered.
    #[test]
    fn an_unrecognised_mime_belongs_to_no_category() {
        assert!(!CATEGORIES
            .into_iter()
            .any(|category| category.matches("application/octet-stream")));
    }

    #[test]
    fn only_the_categories_carry_precedence() {
        // The per-app types are pinned by shipped clients and overlap freely —
        // `document` and `doc` both hold things the other does. Giving them
        // exclusions would silently change what an iOS build already asks for.
        for file_type in ALL_TYPES {
            let has_exclusions = !file_type.mime_filter().exclude.is_empty();
            assert_eq!(
                has_exclusions,
                CATEGORIES.contains(&file_type) && file_type != DriveFileType::Pdf,
                "{file_type:?}"
            );
        }
    }

    /// The per-app filters the iOS apps and the macOS client pin. Renaming or
    /// re-scoping one of these breaks a shipped build, which cannot be updated
    /// in the same release — see the coupling rules in the platform CLAUDE.md.
    #[test]
    fn the_per_app_types_still_mean_what_the_clients_expect() {
        assert!(DriveFileType::Photo.matches("image/png"));
        assert!(!DriveFileType::Photo.matches("video/mp4"));
        assert!(DriveFileType::Video.matches("video/mp4"));
        assert!(DriveFileType::Doc.matches("application/x-neutrino-doc"));
        assert!(!DriveFileType::Doc.matches("application/x-neutrino-note"));
        assert!(DriveFileType::Sheet.matches("application/x-neutrino-sheet"));
        assert!(DriveFileType::Slide.matches("application/x-neutrino-slide"));
        // `drawing` is still the drawing app alone; `canvas` is the group.
        assert!(DriveFileType::Drawing.matches("application/x-neutrino-drawing"));
        assert!(!DriveFileType::Drawing.matches("application/x-neutrino-diagram"));
    }

    #[test]
    fn like_forms_are_matched_the_way_sqlite_would() {
        assert!(like_matches("image/%", "image/png"));
        assert!(!like_matches("image/%", "application/image/png"));
        assert!(like_matches("%zip%", "application/x-zip-compressed"));
        assert!(like_matches("%zip", "application/zip"));
        assert!(like_matches("text/csv", "text/csv"));
        assert!(!like_matches("text/csv", "text/csv2"));
    }

    #[test]
    fn matching_ignores_case_the_way_sqlite_like_does() {
        // A client that uploads with `IMAGE/PNG` is filtered the same either way,
        // rather than appearing under a chip in SQL and vanishing in memory.
        assert!(DriveFileType::Media.matches("IMAGE/PNG"));
        assert!(DriveFileType::Pdf.matches("Application/PDF"));
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
    fn folder_query_parses_new_native_type_variants() {
        for (json_val, expected) in [
            (r#"{"type":"doc"}"#, DriveFileType::Doc),
            (r#"{"type":"sheet"}"#, DriveFileType::Sheet),
            (r#"{"type":"slide"}"#, DriveFileType::Slide),
            (r#"{"type":"diagram"}"#, DriveFileType::Diagram),
            (r#"{"type":"drawing"}"#, DriveFileType::Drawing),
            (r#"{"type":"note"}"#, DriveFileType::Note),
        ] {
            let q: FolderContentsQuery = serde_json::from_str(json_val).unwrap();
            assert_eq!(q.file_type, Some(expected));
        }
    }
}
