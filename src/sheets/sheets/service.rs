use crate::shared::{ApiError, AuthenticatedUser};
use crate::sheets::sheets::{
    dto::{
        CreateSheetRequest, ListSheetsResponse, SaveSheetRequest, SheetMetaResponse, SheetResponse,
    },
    model::{NewSheetRecord, UpdateSheetRecord},
    repository::SheetsRepository,
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
        let (content_url, versions_url) = content_urls("file-abc");
        assert_eq!(content_url, "/api/v1/drive/files/file-abc");
        assert_eq!(versions_url, "/api/v1/drive/files/file-abc/versions");
    }

    #[test]
    fn mime_type_constant_is_correct() {
        assert_eq!(MIME_TYPE, "application/x-neutrino-sheet");
    }

    #[test]
    fn empty_sheet_content_is_valid_json() {
        let result = serde_json::from_str::<serde_json::Value>(EMPTY_SHEET_CONTENT);
        assert!(
            result.is_ok(),
            "EMPTY_SHEET_CONTENT should be valid JSON: {:?}",
            result.err()
        );
    }

    #[test]
    fn empty_sheet_content_is_array_with_one_sheet() {
        let parsed: serde_json::Value = serde_json::from_str(EMPTY_SHEET_CONTENT).unwrap();
        assert!(parsed.is_array(), "Sheet content should be a JSON array");
        assert_eq!(parsed.as_array().unwrap().len(), 1);
    }

    #[test]
    fn empty_sheet_has_name_and_celldata() {
        let parsed: serde_json::Value = serde_json::from_str(EMPTY_SHEET_CONTENT).unwrap();
        let sheet = &parsed[0];
        assert!(sheet["name"].is_string(), "Sheet should have a name");
        assert!(
            sheet["celldata"].is_array(),
            "Sheet should have celldata array"
        );
    }
}
use crate::shared::drive_client::DriveClient;
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// Default empty FortuneSheet workbook: one sheet named "Sheet1".
const EMPTY_SHEET_CONTENT: &str = r#"[{"index":"0","name":"Sheet1","celldata":[],"row":100,"column":26,"order":0,"status":1,"config":{}}]"#;
const MIME_TYPE: &str = "application/x-neutrino-sheet";

pub struct SheetsService {
    repo: Arc<SheetsRepository>,
    drive: Arc<DriveClient>,
}

impl SheetsService {
    pub fn new(repo: Arc<SheetsRepository>, drive: Arc<DriveClient>) -> Self {
        SheetsService { repo, drive }
    }

    pub async fn list_sheets(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListSheetsResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let sheets = items
            .into_iter()
            .map(|item| SheetMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
            })
            .collect();
        Ok(ListSheetsResponse { sheets })
    }

    pub async fn create_sheet(
        &self,
        user: &AuthenticatedUser,
        req: CreateSheetRequest,
    ) -> Result<SheetResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Spreadsheet title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;
        let new_sheet = NewSheetRecord { file_id: &id };
        self.repo.insert_sheet(new_sheet)?;

        self.drive
            .upload_content(&id, EMPTY_SHEET_CONTENT, "upload_sheet_content")
            .await?;

        let (content_url, content_write_url) = content_urls(&id);
        Ok(SheetResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
            your_role: file.your_role,
        })
    }

    pub async fn get_sheet(
        &self,
        user: &AuthenticatedUser,
        sheet_id: &str,
    ) -> Result<SheetResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, sheet_id, "Spreadsheet not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }
        let (content_url, content_write_url) = content_urls(sheet_id);
        Ok(SheetResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
            your_role: file.your_role,
        })
    }

    pub async fn autosave(
        &self,
        user: &AuthenticatedUser,
        sheet_id: &str,
        bytes: &[u8],
        title: Option<&str>,
    ) -> Result<SheetMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, sheet_id, "Spreadsheet not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }

        self.drive.upload_content_bytes(sheet_id, bytes)?;

        let new_title = if let Some(t) = title {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                self.drive
                    .update_file_name(user, sheet_id, &trimmed)
                    .await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSheetRecord { updated_at: now };
        self.repo.update_sheet(sheet_id, changes)?;

        Ok(SheetMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_sheet(
        &self,
        user: &AuthenticatedUser,
        sheet_id: &str,
        req: SaveSheetRequest,
    ) -> Result<SheetMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, sheet_id, "Spreadsheet not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive
                    .update_file_name(user, sheet_id, &trimmed)
                    .await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateSheetRecord { updated_at: now };
        self.repo.update_sheet(sheet_id, changes)?;

        Ok(SheetMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }
}
