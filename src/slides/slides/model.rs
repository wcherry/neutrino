use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::slides)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SlideRecord {
    pub file_id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::slides)]
pub struct NewSlideRecord<'a> {
    pub file_id: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::slides)]
pub struct UpdateSlideRecord {
    pub updated_at: NaiveDateTime,
}

// ── Theme models ────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::slide_themes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ThemeRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub primary_color: String,
    pub background_color: String,
    pub text_color: String,
    pub accent_color: String,
    pub font_family: String,
    pub background_image: Option<String>,
    pub gradient_background: Option<String>,
    pub default_transition: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub is_system: bool,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::slide_themes)]
pub struct NewThemeRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub name: &'a str,
    pub primary_color: &'a str,
    pub background_color: &'a str,
    pub text_color: &'a str,
    pub accent_color: &'a str,
    pub font_family: &'a str,
    pub background_image: Option<&'a str>,
    pub gradient_background: Option<&'a str>,
    pub default_transition: &'a str,
    pub is_system: bool,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::slide_themes)]
pub struct UpdateThemeRecord {
    pub name: Option<String>,
    pub primary_color: Option<String>,
    pub background_color: Option<String>,
    pub text_color: Option<String>,
    pub accent_color: Option<String>,
    pub font_family: Option<String>,
    pub background_image: Option<Option<String>>,
    pub gradient_background: Option<Option<String>>,
    pub default_transition: Option<String>,
    pub updated_at: NaiveDateTime,
}
