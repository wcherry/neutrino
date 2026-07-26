// ── themes::dto ────────────────────────────────────────────────────────────────

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The single source of truth for which token keys a custom theme may set.
/// Mirrored exactly (including the `--` prefix) by the `@neutrino/api-themes`
/// TS constant and diffed against `web/packages/tokens/src/colors.css` lines
/// 1-57 — see the plan doc's "Token key drift" risk note. The real
/// implementation validates `tokens` keys against this list; the red-phase
/// stub in `service.rs` does not yet enforce it.
pub const CANONICAL_THEME_TOKENS: &[&str] = &[
    "--color-bg",
    "--color-bg-subtle",
    "--color-surface",
    "--color-surface-raised",
    "--color-surface-overlay",
    "--color-border",
    "--color-border-strong",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-muted",
    "--color-text-inverse",
    "--color-text-on-accent",
    "--color-accent",
    "--color-accent-hover",
    "--color-accent-subtle",
    "--color-accent-text",
    "--color-success",
    "--color-success-subtle",
    "--color-warning",
    "--color-warning-subtle",
    "--color-error",
    "--color-error-subtle",
    "--color-info",
    "--color-info-subtle",
];

// ── Request types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateThemeRequest {
    pub name: String,
    pub color_scheme: String,
    pub tokens: HashMap<String, String>,
    #[serde(default)]
    pub is_public: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThemeRequest {
    pub name: Option<String>,
    pub color_scheme: Option<String>,
    pub tokens: Option<HashMap<String, String>>,
    pub is_public: Option<bool>,
}

// ── Response types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThemeResponse {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub is_public: bool,
    /// True when the requesting user owns this theme — drives the Edit/Delete
    /// affordance client-side. Computed server-side; never trust a client
    /// value for this.
    pub is_owner: bool,
    pub color_scheme: String,
    pub tokens: HashMap<String, String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListThemesResponse {
    pub themes: Vec<ThemeResponse>,
}
