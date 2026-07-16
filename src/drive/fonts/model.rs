use diesel::prelude::*;

/// A stored admin-uploaded custom font, as persisted in the `custom_fonts` table.
///
/// `uploaded_by`/`created_at` are persisted for audit purposes but not
/// currently surfaced in `CustomFontDto` — allow(dead_code) mirrors the same
/// pattern used for `FileRecord`/`UserQuota` in `drive/storage/model.rs`.
#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::custom_fonts)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct CustomFontRecord {
    pub id: String,
    pub display_name: String,
    pub original_filename: String,
    pub format: String,
    pub storage_key: String,
    pub uploaded_by: String,
    pub created_at: String,
}

/// Insertable payload for creating a new `custom_fonts` row.
#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::custom_fonts)]
pub struct NewCustomFontRecord<'a> {
    pub id: &'a str,
    pub display_name: &'a str,
    pub original_filename: &'a str,
    pub format: &'a str,
    pub storage_key: &'a str,
    pub uploaded_by: &'a str,
}
