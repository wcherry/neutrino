// ── themes::model ──────────────────────────────────────────────────────────────
//
// Mirrors `src/slides/slides/model.rs`'s `ThemeRecord`/`NewThemeRecord`/
// `UpdateThemeRecord` triple structurally. `created_at`/`updated_at` are plain
// `Text` columns (not Diesel `Timestamp`) following `custom_fonts`'s
// convention rather than `slide_themes`'s `NaiveDateTime` convention — see the
// migration's `up.sql` for the exact column types.

use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::custom_themes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct CustomThemeRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub is_public: bool,
    pub color_scheme: String,
    /// Serialized JSON object of the canonical color tokens (TEXT-blob-of-JSON
    /// convention — see `user_profiles.social_links`).
    pub tokens: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::custom_themes)]
pub struct NewCustomThemeRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub name: &'a str,
    pub is_public: bool,
    pub color_scheme: &'a str,
    pub tokens: &'a str,
    pub created_at: &'a str,
    pub updated_at: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::custom_themes)]
pub struct UpdateCustomThemeRecord {
    pub name: Option<String>,
    pub is_public: Option<bool>,
    pub color_scheme: Option<String>,
    pub tokens: Option<String>,
    pub updated_at: String,
}
