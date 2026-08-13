use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ──────────────────────────────────────────────────────────────

// ── Theme request types ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateThemeRequest {
    pub name: String,
    pub primary_color: String,
    pub background_color: String,
    pub text_color: String,
    pub accent_color: String,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    pub background_image: Option<String>,
    pub gradient_background: Option<String>,
    #[serde(default = "default_transition")]
    pub default_transition: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThemeRequest {
    pub name: Option<String>,
    pub primary_color: Option<String>,
    pub background_color: Option<String>,
    pub text_color: Option<String>,
    pub accent_color: Option<String>,
    pub font_family: Option<String>,
    /// Pass `null` to clear the background image.
    pub background_image: Option<Option<String>>,
    /// Pass `null` to clear the gradient.
    pub gradient_background: Option<Option<String>>,
    pub default_transition: Option<String>,
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThemeResponse {
    pub id: String,
    pub name: String,
    pub primary_color: String,
    pub background_color: String,
    pub text_color: String,
    pub accent_color: String,
    pub font_family: String,
    pub background_image: Option<String>,
    pub gradient_background: Option<String>,
    pub default_transition: String,
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListThemesResponse {
    pub themes: Vec<ThemeResponse>,
}

// ── Defaults ───────────────────────────────────────────────────────────────────

fn default_font_family() -> String {
    "Inter".to_string()
}

fn default_transition() -> String {
    "fade".to_string()
}
