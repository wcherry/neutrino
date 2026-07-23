use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::files)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FileRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub size_bytes: i64,
    pub mime_type: String,
    pub storage_path: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub folder_id: Option<String>,
    pub is_starred: bool,
    pub deleted_at: Option<NaiveDateTime>,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
    pub starred_at: Option<NaiveDateTime>,
    pub shared_drive_id: Option<String>,
    /// Base64url-encoded XChaCha20-Poly1305 ciphertext of the file's metadata JSON.
    /// Null for non-encrypted files.
    pub encrypted_metadata: Option<String>,
    /// Monotonically increasing revision counter, bumped atomically by 1 on every
    /// content write (autosave and named-version save). Used by clients to detect
    /// "server changed since I last saw it" for offline-conflict handling.
    pub content_version: i32,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::files)]
pub struct NewFileRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub name: &'a str,
    pub size_bytes: i64,
    pub mime_type: &'a str,
    pub storage_path: &'a str,
    pub folder_id: Option<&'a str>,
    pub encrypted_metadata: Option<&'a str>,
}

#[allow(dead_code)]
#[derive(Debug, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_quotas)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserQuota {
    pub user_id: String,
    pub used_bytes: i64,
    pub daily_upload_bytes: i64,
    pub daily_reset_at: NaiveDateTime,
    pub quota_bytes: Option<i64>,
    pub daily_cap_bytes: Option<i64>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::user_quotas)]
pub struct NewUserQuota<'a> {
    pub user_id: &'a str,
}

// ── FileVersion ───────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::file_versions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FileVersionRecord {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub version_number: i32,
    pub size_bytes: i64,
    pub storage_path: String,
    pub label: Option<String>,
    pub created_at: NaiveDateTime,
    pub is_named: bool,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::file_versions)]
pub struct NewFileVersionRecord<'a> {
    pub id: &'a str,
    pub file_id: &'a str,
    pub user_id: &'a str,
    pub version_number: i32,
    pub size_bytes: i64,
    pub storage_path: &'a str,
    pub label: Option<&'a str>,
    pub is_named: bool,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::files)]
pub struct AutosaveFileContent {
    pub size_bytes: i64,
    pub storage_path: String,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::files)]
pub struct UpdateFileContent {
    pub size_bytes: i64,
    pub storage_path: String,
    pub updated_at: NaiveDateTime,
}
