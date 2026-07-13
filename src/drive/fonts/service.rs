use std::path::{Path, PathBuf};
use std::sync::Arc;

use uuid::Uuid;

use super::model::{CustomFontRecord, NewCustomFontRecord};
use super::repository::FontsRepository;
use crate::drive::storage::store::LocalFileStore;
use crate::shared::ApiError;

/// Maximum allowed custom font upload size (5 MB), enforced by the caller
/// while streaming the multipart body to a temp file (see
/// `drive::fonts::api::upload_font`), before `finalize_upload` is called.
pub const MAX_FONT_SIZE_BYTES: u64 = 5 * 1024 * 1024;

/// Font file extensions accepted for upload.
const ALLOWED_EXTENSIONS: &[&str] = &["woff2", "woff", "ttf", "otf"];

/// Wraps `FontsRepository` (DB metadata) and the shared `LocalFileStore`
/// (disk) to implement admin-uploadable custom fonts: format/MIME
/// validation, on-disk storage under the `"fonts"` partition, and file
/// resolution for serving via `GET /fonts/{id}/file`.
pub struct FontsService {
    repo: Arc<FontsRepository>,
    store: Arc<LocalFileStore>,
}

impl FontsService {
    pub fn new(repo: Arc<FontsRepository>, store: Arc<LocalFileStore>) -> Self {
        Self { repo, store }
    }

    /// List all uploaded fonts.
    pub fn list(&self) -> Result<Vec<CustomFontRecord>, ApiError> {
        self.repo.list()
    }

    /// Look up a single font by id.
    #[allow(dead_code)]
    pub fn find_by_id(&self, id: &str) -> Result<Option<CustomFontRecord>, ApiError> {
        self.repo.find_by_id(id)
    }

    /// Ensure the shared `LocalFileStore`'s `"fonts"` partition directory
    /// exists, so a temp file can be created in it before validation and
    /// streaming complete.
    pub fn ensure_fonts_temp_dir(&self) -> Result<(), String> {
        self.store.ensure_user_dir("fonts")
    }

    /// Absolute path for a temp file used while streaming an in-progress
    /// upload, before it is validated/moved into permanent storage.
    pub fn temp_path(&self, temp_id: &str) -> PathBuf {
        self.store.temp_path("fonts", temp_id)
    }

    /// Validate a candidate upload's filename + declared MIME type against
    /// the allowed font formats (woff2/woff/ttf/otf), checking both the file
    /// extension and the sniffed/declared MIME type. Returns the normalized
    /// format string (e.g. `"woff2"`) on success, or a 400 `ApiError`.
    ///
    /// A renamed `.txt` masquerading as a font is rejected by the extension
    /// check alone; this does not sniff file *contents* (nothing else in
    /// this codebase's upload path does either — see `drive/storage/api.rs`,
    /// which trusts `mime_guess::from_path`/declared content-type the same
    /// way). A corrupt-but-correctly-extensioned file will simply fail to
    /// render as a font client-side, which is an accepted failure mode.
    pub fn validate_format(&self, file_name: &str, declared_mime: &str) -> Result<String, ApiError> {
        let ext = Path::new(file_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .filter(|e| !e.is_empty())
            .ok_or_else(|| ApiError::bad_request("File must have a recognized font extension"))?;

        if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
            return Err(ApiError::bad_request(format!(
                "Unsupported font format: .{ext}. Allowed formats: woff2, woff, ttf, otf"
            )));
        }

        let sniffed = mime_guess::from_path(file_name)
            .first_or_octet_stream()
            .to_string();

        let declared_matches = !declared_mime.is_empty() && mime_matches_format(declared_mime, &ext);
        let sniffed_matches = mime_matches_format(&sniffed, &ext);

        if !declared_matches && !sniffed_matches {
            return Err(ApiError::bad_request(format!(
                "Declared MIME type {declared_mime} does not match font extension .{ext}"
            )));
        }

        Ok(ext)
    }

    /// Move a validated, fully-streamed temp file into permanent storage
    /// under the `"fonts"` partition and persist its metadata. Caller is
    /// responsible for having already enforced the 5 MB size limit and
    /// validated the format via `validate_format` while streaming the
    /// upload.
    pub fn finalize_upload(
        &self,
        uploaded_by: &str,
        display_name: &str,
        original_filename: &str,
        format: &str,
        temp_path: &Path,
    ) -> Result<CustomFontRecord, ApiError> {
        self.store.ensure_user_dir("fonts").map_err(|e| {
            tracing::error!("Failed to create fonts directory: {:?}", e);
            ApiError::internal("Failed to save uploaded font")
        })?;

        let id = Uuid::new_v4().to_string();
        let final_path = self.store.file_path("fonts", &format!("{id}.{format}"));
        let storage_key = format!("fonts/{id}.{format}");

        std::fs::rename(temp_path, &final_path).map_err(|e| {
            tracing::error!("Failed to move temp font file to final path: {:?}", e);
            ApiError::internal("Failed to save uploaded font")
        })?;

        self.repo
            .insert(NewCustomFontRecord {
                id: &id,
                display_name,
                original_filename,
                format,
                storage_key: &storage_key,
                uploaded_by,
            })
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&final_path);
            })
    }

    /// Delete a font's DB row and its on-disk file. A missing/already-gone
    /// disk file is not treated as an error (best-effort cleanup).
    pub fn delete(&self, id: &str) -> Result<(), ApiError> {
        let record = self
            .repo
            .find_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Font not found"))?;
        self.repo.delete(id)?;
        let path = self.store.resolve(&record.storage_key);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// Resolve a font's on-disk path, `Content-Type`, and original filename
    /// for serving via `GET /fonts/{id}/file`.
    pub fn resolve_file(&self, id: &str) -> Result<(PathBuf, String, String), ApiError> {
        let record = self
            .repo
            .find_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Font not found"))?;
        let path = self
            .store
            .resolve_for_serving(&record.storage_key)
            .map_err(|_| ApiError::not_found("Font file not found"))?;
        Ok((path, format_content_type(&record.format), record.original_filename))
    }
}

/// Map a stored font format to its `Content-Type` for serving.
pub fn format_content_type(format: &str) -> String {
    match format {
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Whether a MIME type is an accepted value for a given font extension.
/// Accepts a handful of real-world variants plus a generic
/// `application/octet-stream` fallback, since many clients/proxies report
/// that for binary font files rather than a font-specific type.
fn mime_matches_format(mime: &str, ext: &str) -> bool {
    let mime = mime.to_lowercase();
    if mime == "application/octet-stream" {
        return true;
    }
    let allowed: &[&str] = match ext {
        "woff2" => &["font/woff2", "application/font-woff2"],
        "woff" => &["font/woff", "application/font-woff"],
        "ttf" => &[
            "font/ttf",
            "font/sfnt",
            "application/font-sfnt",
            "application/x-font-ttf",
            "application/x-font-truetype",
        ],
        "otf" => &[
            "font/otf",
            "font/sfnt",
            "application/font-sfnt",
            "application/x-font-otf",
        ],
        _ => &[],
    };
    allowed.contains(&mime.as_str())
}
