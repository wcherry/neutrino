use crate::drive::storage::model::{FileRecord, FileVersionRecord};
use crate::shared::ApiError;
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum FileOrderField {
    Name,
    Size,
    CreatedAt,
    UpdatedAt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum VersionOrderField {
    VersionNumber,
    CreatedAt,
    Size,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ZipEntryOrderField {
    Name,
    Size,
    CompressedSize,
    IsDir,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadataResponse {
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
    /// Comma-separated tag names assigned to this file.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Base64url-encoded XChaCha20-Poly1305 ciphertext of the file's metadata JSON.
    /// Present only for E2EE files; null otherwise.
    pub encrypted_metadata: Option<String>,
    /// Monotonically increasing revision counter, bumped atomically by 1 on every
    /// content write (autosave and named-version save). Used by clients to detect
    /// "server changed since I last saw it" for offline-conflict handling.
    pub content_version: i32,
    /// When an import run wrote this file; null for a file created here. On an
    /// imported file `created_at` is the source file's own date, so this is the
    /// only thing that says when it actually arrived.
    pub imported_at: Option<NaiveDateTime>,
    /// Where in the imported archive this file came from, e.g.
    /// `Takeout/Drive/Work/Q3 plan.docx`. Null unless `imported_at` is set.
    pub import_source: Option<String>,
}

impl From<FileRecord> for FileMetadataResponse {
    fn from(f: FileRecord) -> Self {
        FileMetadataResponse {
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
            tags: vec![],
            encrypted_metadata: f.encrypted_metadata,
            content_version: f.content_version,
            imported_at: f.imported_at,
            import_source: f.import_source,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesResponse {
    pub files: Vec<FileMetadataResponse>,
    pub total: usize,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntry {
    pub name: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ZipContentsResponse {
    pub entries: Vec<ZipEntry>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct FileVersionResponse {
    pub id: String,
    pub file_id: String,
    pub version_number: i32,
    pub size_bytes: i64,
    pub label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_named: bool,
}

impl From<FileVersionRecord> for FileVersionResponse {
    fn from(v: FileVersionRecord) -> Self {
        FileVersionResponse {
            id: v.id,
            file_id: v.file_id,
            version_number: v.version_number,
            size_bytes: v.size_bytes,
            label: v.label,
            created_at: DateTime::from_naive_utc_and_offset(v.created_at, Utc),
            is_named: v.is_named,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListVersionsResponse {
    pub versions: Vec<FileVersionResponse>,
    pub total: usize,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVersionLabelRequest {
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SaveVersionRequest {
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileRequest {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub folder_id: Option<String>,
    /// Body to write at creation time. Omit and a native Neutrino type
    /// (see `native_types`) is seeded with its default content instead, so a
    /// new spreadsheet opens as a valid empty workbook rather than a
    /// zero-byte read every editor has to special-case. Non-native types
    /// stay empty, as before.
    pub initial_content: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConvertFileRequest {
    /// The native Neutrino mime type to convert into, e.g.
    /// `application/x-neutrino-sheet`.
    pub target_mime_type: String,
    /// The file's new body, already converted to the native format.
    /// Conversion from OOXML happens client-side; the backend never parses
    /// office bytes.
    pub content: String,
}

/// What an importer says about a file it has just finished writing.
///
/// Sent once per file, after its content is in place, because the write is
/// what stamps `updated_at` with the current time — setting the dates at
/// creation would only have them overwritten a moment later.
///
/// `importSource` is required. Rewriting a file's dates is a history rewrite,
/// and this is the endpoint's whole justification for allowing one: the row
/// keeps a record of where the dates came from.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportMetadataRequest {
    /// Where the file came from inside the archive, e.g.
    /// `Takeout/Drive/Work/Q3 plan.docx`.
    pub import_source: String,
    /// The source file's creation date. Omit to leave the existing one alone.
    pub created_at: Option<String>,
    /// The source file's last-modified date. Omit to leave the existing one alone.
    pub updated_at: Option<String>,
    /// When the import ran. Defaults to now, which is what a live import
    /// wants; an importer replaying an interrupted run can pin it instead.
    pub imported_at: Option<String>,
}

/// Parse a timestamp an importer sent, in UTC.
///
/// Deliberately lenient about the shape and deliberately strict about failure.
/// Lenient because the dates come from three sources that format them
/// differently — an offset (`2014-03-01T12:00:00+02:00`), a `Z` and
/// milliseconds from `toISOString`, or neither — and a caller should not have
/// to know which. Strict because the alternative, the `.ok()` that
/// `register_photo` uses on its capture date, turns a format we don't
/// recognise into a file silently keeping the wrong date, which is the exact
/// failure issue #110 was about. A rejected request is visible; a dropped date
/// is not.
pub fn parse_import_timestamp(value: &str) -> Result<NaiveDateTime, ApiError> {
    let text = value.trim();
    // An offset or a `Z` means the instant is unambiguous — convert to UTC
    // rather than keeping the local wall clock, which would shift the date.
    if let Ok(fixed) = DateTime::parse_from_rfc3339(text) {
        return Ok(fixed.with_timezone(&Utc).naive_utc());
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(text, format) {
            return Ok(naive);
        }
    }
    // A bare date carries no time, so it cannot go through the loop above.
    if let Ok(date) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return Ok(date.and_hms_opt(0, 0, 0).expect("midnight is a valid time"));
    }
    Err(ApiError::bad_request(format!(
        "Could not read the timestamp {text:?}; expected an ISO 8601 date such as 2014-03-01T12:00:00Z"
    )))
}

/// Optional metadata part of an autosave multipart body. Editors send it
/// alongside the file part so a rename lands in the same request as the
/// content write instead of racing a separate PATCH.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutosaveMetadata {
    pub title: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuotaResponse {
    pub used_bytes: i64,
    pub daily_upload_bytes: i64,
    /// `null` means no limit
    pub quota_bytes: Option<i64>,
    /// `null` means no limit
    pub daily_cap_bytes: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocFileMetadataResponse {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
    pub your_role: String,
    pub storage_path: Option<String>,
    pub mime_type: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
    /// Tag names assigned to this file.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Base64url-encoded XChaCha20-Poly1305 ciphertext of the file's metadata JSON.
    pub encrypted_metadata: Option<String>,
    /// Monotonically increasing revision counter, bumped atomically by 1 on every
    /// content write (autosave and named-version save). Used by clients to detect
    /// "server changed since I last saw it" for offline-conflict handling.
    pub content_version: i32,
}
