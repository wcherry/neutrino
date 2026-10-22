// ── branding::dto ─────────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The instance's brand, as every client reads it. Absent fields mean Neutrino's own.
#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrandingResponse {
    pub name: Option<String>,
    /// `#rrggbb`; at least 4.5:1 on white.
    pub accent: Option<String>,
    pub sign_in_message: Option<String>,
    /// Cache-busting URLs, or `null` when that image has not been uploaded.
    pub logo_light_url: Option<String>,
    pub logo_dark_url: Option<String>,
    pub favicon_url: Option<String>,
    /// Changes on every edit; `null` before the first.
    pub version: Option<String>,
}

/// Replace the instance's name, accent and sign-in message. `null` (or an omitted field) returns
/// that field to Neutrino's default.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutBrandingRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default)]
    pub sign_in_message: Option<String>,
}
