use crate::shared::{ApiError, AuthenticatedUser};
use crate::drawing::drawing::{
    dto::{CreateDrawingRequest, DrawingMetaResponse, DrawingResponse, ListDrawingsResponse, SaveDrawingRequest},
    model::{NewDrawingRecord, UpdateDrawingRecord},
    repository::DrawingRepository,
};
use crate::shared::drive_client::DriveClient;
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

fn content_urls(file_id: &str) -> (String, String) {
    (
        format!("/api/v1/drive/files/{}", file_id),
        format!("/api/v1/drive/files/{}/versions", file_id),
    )
}

const EMPTY_DRAWING_CONTENT: &str = r#"{"version":1,"shapes":[]}"#;
const MIME_TYPE: &str = "application/x-neutrino-drawing";

pub struct DrawingService {
    repo: Arc<DrawingRepository>,
    drive: Arc<DriveClient>,
}

impl DrawingService {
    pub fn new(repo: Arc<DrawingRepository>, drive: Arc<DriveClient>) -> Self {
        DrawingService { repo, drive }
    }

    pub async fn list_drawings(&self, user: &AuthenticatedUser) -> Result<ListDrawingsResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let drawings = items
            .into_iter()
            .map(|item| DrawingMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
            })
            .collect();
        Ok(ListDrawingsResponse { drawings })
    }

    pub async fn create_drawing(
        &self,
        user: &AuthenticatedUser,
        req: CreateDrawingRequest,
    ) -> Result<DrawingResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Drawing title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;
        let new_drawing = NewDrawingRecord { file_id: &id };
        self.repo.insert_drawing(new_drawing)?;

        self.drive
            .upload_content(&id, EMPTY_DRAWING_CONTENT, "upload_drawing_content")
            .await?;

        let (content_url, content_write_url) = content_urls(&id);
        Ok(DrawingResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn get_drawing(
        &self,
        user: &AuthenticatedUser,
        drawing_id: &str,
    ) -> Result<DrawingResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, drawing_id, "Drawing not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Drawing is in trash"));
        }
        let (content_url, content_write_url) = content_urls(drawing_id);
        Ok(DrawingResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn autosave(
        &self,
        user: &AuthenticatedUser,
        drawing_id: &str,
        bytes: &[u8],
        title: Option<&str>,
    ) -> Result<DrawingMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, drawing_id, "Drawing not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Drawing is in trash"));
        }

        self.drive.upload_content_bytes(drawing_id, bytes)?;

        let new_title = if let Some(t) = title {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, drawing_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateDrawingRecord { updated_at: now };
        self.repo.update_drawing(drawing_id, changes)?;

        Ok(DrawingMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_drawing(
        &self,
        user: &AuthenticatedUser,
        drawing_id: &str,
        req: SaveDrawingRequest,
    ) -> Result<DrawingMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, drawing_id, "Drawing not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Drawing is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, drawing_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateDrawingRecord { updated_at: now };
        self.repo.update_drawing(drawing_id, changes)?;

        Ok(DrawingMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }
}
