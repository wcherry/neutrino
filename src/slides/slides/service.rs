use crate::shared::{ApiError, AuthenticatedUser};
use crate::slides::slides::{
    dto::{
        CreateSlideRequest, ListSlidesResponse, SaveSlideRequest, SlideMetaResponse, SlideResponse,
        CreateThemeRequest, UpdateThemeRequest, ThemeResponse, ListThemesResponse,
    },
    model::{NewSlideRecord, UpdateSlideRecord, NewThemeRecord, UpdateThemeRecord},
    repository::SlidesRepository,
};

fn content_urls(file_id: &str) -> (String, String) {
    (
        format!("/api/v1/drive/files/{}", file_id),
        format!("/api/v1/drive/files/{}/versions", file_id),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_urls_returns_correct_paths() {
        let (content_url, versions_url) = content_urls("slide-xyz");
        assert_eq!(content_url, "/api/v1/drive/files/slide-xyz");
        assert_eq!(versions_url, "/api/v1/drive/files/slide-xyz/versions");
    }

    #[test]
    fn mime_type_constant_is_correct() {
        assert_eq!(MIME_TYPE, "application/x-neutrino-slide");
    }

    #[test]
    fn empty_slides_content_is_nonempty_and_contains_slides_key() {
        assert!(!EMPTY_SLIDES_CONTENT.is_empty());
        assert!(EMPTY_SLIDES_CONTENT.contains("slides"));
        assert!(EMPTY_SLIDES_CONTENT.contains("theme"));
    }
}
use crate::shared::drive_client::DriveClient;
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// Default empty presentation: one blank title slide.
const EMPTY_SLIDES_CONTENT: &str = r#"{"slides":[{"id":"s1","background":{"type":"color","value":"\#ffffff"},"elements":[{"id":"e1","type":"text","x":10,"y":30,"w":80,"h":20,"content":"Click to add title","style":{"fontSize":40,"bold":true,"italic":false,"underline":false,"color":"\#1f2937","align":"center","fontFamily":"Inter"}},{"id":"e2","type":"text","x":15,"y":55,"w":70,"h":15,"content":"Click to add subtitle","style":{"fontSize":24,"bold":false,"italic":false,"underline":false,"color":"\#6b7280","align":"center","fontFamily":"Inter"}}],"notes":"","transition":"fade"}],"theme":{"name":"default","primaryColor":"\#4f46e5","backgroundColor":"\#ffffff","textColor":"\#1f2937","accentColor":"\#818cf8","fontFamily":"Inter","defaultTransition":"fade"}}"#;
const MIME_TYPE: &str = "application/x-neutrino-slide";

pub struct SlidesService {
    repo: Arc<SlidesRepository>,
    drive: Arc<DriveClient>,
}

impl SlidesService {
    pub fn new(repo: Arc<SlidesRepository>, drive: Arc<DriveClient>) -> Self {
        SlidesService { repo, drive }
    }

    pub async fn list_slides(&self, user: &AuthenticatedUser) -> Result<ListSlidesResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let slides = items
            .into_iter()
            .map(|item| SlideMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
            })
            .collect();
        Ok(ListSlidesResponse { slides })
    }

    pub async fn create_slide(
        &self,
        user: &AuthenticatedUser,
        req: CreateSlideRequest,
    ) -> Result<SlideResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Presentation title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;
        let new_slide = NewSlideRecord { file_id: &id };
        self.repo.insert_slide(new_slide)?;

        self.drive
            .upload_content(&id, EMPTY_SLIDES_CONTENT, "upload_slide_content")
            .await?;

        let (content_url, content_write_url) = content_urls(&id);
        Ok(SlideResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn get_slide(
        &self,
        user: &AuthenticatedUser,
        slide_id: &str,
    ) -> Result<SlideResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, slide_id, "Presentation not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Presentation is in trash"));
        }
        let (content_url, content_write_url) = content_urls(slide_id);
        Ok(SlideResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    // ── Theme methods ───────────────────────────────────────────────────────

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
        if let Some(ref c) = req.primary_color { validate_hex_color(c, "primaryColor")?; }
        if let Some(ref c) = req.background_color { validate_hex_color(c, "backgroundColor")?; }
        if let Some(ref c) = req.text_color { validate_hex_color(c, "textColor")?; }
        if let Some(ref c) = req.accent_color { validate_hex_color(c, "accentColor")?; }

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

    pub async fn autosave(
        &self,
        user: &AuthenticatedUser,
        slide_id: &str,
        bytes: &[u8],
        title: Option<&str>,
    ) -> Result<SlideMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, slide_id, "Presentation not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Presentation is in trash"));
        }

        self.drive.upload_content_bytes(slide_id, bytes)?;

        let new_title = if let Some(t) = title {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, slide_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSlideRecord { updated_at: now };
        self.repo.update_slide(slide_id, changes)?;

        Ok(SlideMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_slide(
        &self,
        user: &AuthenticatedUser,
        slide_id: &str,
        req: SaveSlideRequest,
    ) -> Result<SlideMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, slide_id, "Presentation not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Presentation is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, slide_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSlideRecord { updated_at: now };
        self.repo.update_slide(slide_id, changes)?;

        Ok(SlideMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }
}

// ── Free helpers ────────────────────────────────────────────────────────────

use crate::slides::slides::model::ThemeRecord;

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
    if s.starts_with('#') && (s.len() == 7 || s.len() == 4) && s[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(ApiError::bad_request(&format!("{field} must be a valid hex colour (e.g. #ff0000)")))
    }
}
