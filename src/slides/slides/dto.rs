use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSlideRequest {
    pub title: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromoteSlideRequest {
    /// Already-converted native Neutrino slide JSON content (conversion from
    /// OOXML happens client-side; the backend never parses office bytes).
    pub content: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveSlideRequest {
    /// Optional new title (renames the backing file record).
    pub title: Option<String>,
}

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
pub struct SlideResponse {
    pub id: String,
    pub title: String,
    /// Path to read presentation content directly from the drive API.
    pub content_url: String,
    /// Path to write presentation content directly to the drive API (multipart POST).
    pub content_write_url: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlideMetaResponse {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSlidesResponse {
    pub slides: Vec<SlideMetaResponse>,
}

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
