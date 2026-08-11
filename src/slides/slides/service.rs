//! Slide themes — the one piece of slides state that isn't a Drive file.
//!
//! Presentation CRUD used to live here as a pass-through to `DriveClient`; it
//! now goes straight to the generic drive file endpoints, with
//! `application/x-neutrino-slide` (see `drive::storage::native_types`) marking
//! a file as a presentation. Themes are user-owned records, not files, so they
//! stay.

use crate::shared::{ApiError, AuthenticatedUser};
use crate::slides::slides::{
    dto::{CreateThemeRequest, ListThemesResponse, ThemeResponse, UpdateThemeRequest},
    model::{NewThemeRecord, ThemeRecord, UpdateThemeRecord},
    repository::SlidesRepository,
};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

pub struct SlidesService {
    repo: Arc<SlidesRepository>,
}

impl SlidesService {
    pub fn new(repo: Arc<SlidesRepository>) -> Self {
        SlidesService { repo }
    }

    pub fn list_themes(&self, user: &AuthenticatedUser) -> Result<ListThemesResponse, ApiError> {
        let records = self.repo.list_themes_for_user(&user.user_id)?;
        let themes = records.into_iter().map(theme_record_to_response).collect();
        Ok(ListThemesResponse { themes })
    }

    pub fn create_theme(
        &self,
        user: &AuthenticatedUser,
        req: CreateThemeRequest,
    ) -> Result<ThemeResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Theme name cannot be empty"));
        }
        validate_hex_color(&req.primary_color, "primaryColor")?;
        validate_hex_color(&req.background_color, "backgroundColor")?;
        validate_hex_color(&req.text_color, "textColor")?;
        validate_hex_color(&req.accent_color, "accentColor")?;

        let id = Uuid::new_v4().to_string();
        let new_theme = NewThemeRecord {
            id: &id,
            user_id: &user.user_id,
            name: &name,
            primary_color: &req.primary_color,
            background_color: &req.background_color,
            text_color: &req.text_color,
            accent_color: &req.accent_color,
            font_family: &req.font_family,
            background_image: req.background_image.as_deref(),
            gradient_background: req.gradient_background.as_deref(),
            default_transition: &req.default_transition,
            is_system: false,
        };
        let record = self.repo.insert_theme(new_theme)?;
        Ok(theme_record_to_response(record))
    }

    pub fn update_theme(
        &self,
        user: &AuthenticatedUser,
        theme_id: &str,
        req: UpdateThemeRequest,
    ) -> Result<ThemeResponse, ApiError> {
        if let Some(ref name) = req.name {
            if name.trim().is_empty() {
                return Err(ApiError::bad_request("Theme name cannot be empty"));
            }
        }
        if let Some(ref c) = req.primary_color {
            validate_hex_color(c, "primaryColor")?;
        }
        if let Some(ref c) = req.background_color {
            validate_hex_color(c, "backgroundColor")?;
        }
        if let Some(ref c) = req.text_color {
            validate_hex_color(c, "textColor")?;
        }
        if let Some(ref c) = req.accent_color {
            validate_hex_color(c, "accentColor")?;
        }

        let changes = UpdateThemeRecord {
            name: req.name.map(|n| n.trim().to_string()),
            primary_color: req.primary_color,
            background_color: req.background_color,
            text_color: req.text_color,
            accent_color: req.accent_color,
            font_family: req.font_family,
            background_image: req.background_image,
            gradient_background: req.gradient_background,
            default_transition: req.default_transition,
            updated_at: Utc::now().naive_utc(),
        };
        let record = self.repo.update_theme(theme_id, &user.user_id, changes)?;
        Ok(theme_record_to_response(record))
    }

    pub fn delete_theme(&self, user: &AuthenticatedUser, theme_id: &str) -> Result<(), ApiError> {
        self.repo.delete_theme(theme_id, &user.user_id)
    }
}

fn theme_record_to_response(r: ThemeRecord) -> ThemeResponse {
    ThemeResponse {
        id: r.id,
        name: r.name,
        primary_color: r.primary_color,
        background_color: r.background_color,
        text_color: r.text_color,
        accent_color: r.accent_color,
        font_family: r.font_family,
        background_image: r.background_image,
        gradient_background: r.gradient_background,
        default_transition: r.default_transition,
        is_system: r.is_system,
        created_at: r.created_at.and_utc().to_rfc3339(),
        updated_at: r.updated_at.and_utc().to_rfc3339(),
    }
}

/// Reject obviously non-hex values to prevent garbage data in the DB.
fn validate_hex_color(value: &str, field: &str) -> Result<(), ApiError> {
    let s = value.trim();
    if s.starts_with('#')
        && (s.len() == 7 || s.len() == 4)
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        Ok(())
    } else {
        Err(ApiError::bad_request(&format!(
            "{field} must be a valid hex colour (e.g. #ff0000)"
        )))
    }
}
