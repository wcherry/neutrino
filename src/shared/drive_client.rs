use chrono::NaiveDateTime;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::shared::ApiError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveListItem {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveListFilesResponse {
    files: Vec<DriveListItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileRecord {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub folder_id: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
    pub your_role: String,
    pub storage_path: Option<String>,
    pub mime_type: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateFileInfo {
    id: String,
    name: String,
    mime_type: String,
    folder_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateFileBody {
    name: Option<String>,
}

pub struct DriveClient {
    base_url: String,
    http: Client,
}

impl DriveClient {
    pub fn new(base_url: String) -> Self {
        DriveClient {
            base_url,
            http: Client::new(),
        }
    }

    pub async fn list_files(
        &self,
        token: &str,
        mime_type: &str,
    ) -> Result<Vec<DriveListItem>, ApiError> {
        let url = format!("{}/api/v1/drive/files", self.base_url);
        let resp = self
            .http
            .get(url)
            .bearer_auth(token)
            .query(&[("mimeType", mime_type), ("limit", "200")])
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Drive client list_files error: {:?}", e);
                ApiError::internal("Failed to reach drive service")
            })?;
        if !resp.status().is_success() {
            tracing::error!("Drive service list_files returned {}", resp.status());
            return Err(ApiError::internal("Drive service error"));
        }
        let body = resp.json::<DriveListFilesResponse>().await.map_err(|e| {
            tracing::error!("Drive client list_files decode error: {:?}", e);
            ApiError::internal("Invalid response from drive service")
        })?;
        Ok(body.files)
    }

    pub async fn create_file(
        &self,
        token: &str,
        id: &str,
        name: &str,
        mime_type: &str,
        folder_id: Option<&str>,
    ) -> Result<DriveFileRecord, ApiError> {
        let body = CreateFileInfo {
            id: id.to_string(),
            name: name.to_string(),
            mime_type: mime_type.to_string(),
            folder_id: folder_id.map(|s| s.to_string()),
        };
        let url = format!("{}/api/v1/drive/files", self.base_url);

        let resp = self
            .http
            .post(url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Drive client create_file error: {:?}", e);
                ApiError::internal("Failed to reach drive service")
            })?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            tracing::error!("Drive service create_file returned {}", status);
            return Err(ApiError::internal("Drive service error"));
        }
        resp.json::<DriveFileRecord>().await.map_err(|e| {
            tracing::error!("Drive client create_file decode error: {:?}", e);
            ApiError::internal("Invalid response from drive service")
        })
    }

    pub async fn get_file(
        &self,
        token: &str,
        file_id: &str,
        not_found_msg: &str,
    ) -> Result<DriveFileRecord, ApiError> {
        let resp = self
            .http
            .get(format!("{}/api/v1/drive/files/{}/info", self.base_url, file_id))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Drive client get_file error: {:?}", e);
                ApiError::internal("Failed to reach drive service")
            })?;
        match resp.status().as_u16() {
            403 => return Err(ApiError::new(403, "FORBIDDEN", "Access denied")),
            404 => return Err(ApiError::not_found(not_found_msg)),
            s if s >= 400 => {
                tracing::error!("Drive service get_file returned {}", s);
                return Err(ApiError::internal("Drive service error"));
            }
            _ => {}
        }
        resp.json::<DriveFileRecord>().await.map_err(|e| {
            tracing::error!("Drive client get_file decode error: {:?}", e);
            ApiError::internal("Invalid response from drive service")
        })
    }

    pub async fn get_content(
        &self,
        token: &str,
        file_id: &str,
        not_found_msg: &str,
    ) -> Result<String, ApiError> {
        let resp = self
            .http
            .get(format!("{}/api/v1/drive/files/{}", self.base_url, file_id))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Drive client get_content error: {:?}", e);
                ApiError::internal("Failed to reach drive service")
            })?;
        match resp.status().as_u16() {
            404 => return Err(ApiError::not_found(not_found_msg)),
            s if s >= 400 => {
                tracing::error!("Drive service get_content returned {}", s);
                return Err(ApiError::internal("Drive service error"));
            }
            _ => {}
        }
        resp.text().await.map_err(|e| {
            tracing::error!("Drive client get_content decode error: {:?}", e);
            ApiError::internal("Invalid response from drive service")
        })
    }

    pub async fn upload_content(
        &self,
        token: &str,
        file_id: &str,
        content: &str,
        label: &str,
    ) -> Result<(), ApiError> {
        let part = reqwest::multipart::Part::bytes(content.as_bytes().to_vec())
            .file_name("content.json")
            .mime_str("application/json")
            .map_err(|e| {
                tracing::error!("Drive client build multipart error: {:?}", e);
                ApiError::internal("Failed to build upload request")
            })?;
        let form = reqwest::multipart::Form::new().part("file", part);
        let resp = self
            .http
            .post(format!(
                "{}/api/v1/drive/files/{}/versions",
                self.base_url, file_id
            ))
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Drive client {} error: {:?}", label, e);
                ApiError::internal("Failed to reach drive service")
            })?;
        if !resp.status().is_success() {
            tracing::error!(
                "Drive service {} returned {}",
                label,
                resp.status()
            );
            return Err(ApiError::internal("Drive service error"));
        }
        Ok(())
    }

    pub async fn update_file_name(
        &self,
        token: &str,
        file_id: &str,
        name: &str,
    ) -> Result<(), ApiError> {
        let body = UpdateFileBody {
            name: Some(name.to_string()),
        };
        let resp = self
            .http
            .patch(format!("{}/api/v1/drive/files/{}", self.base_url, file_id))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Drive client update_file_name error: {:?}", e);
                ApiError::internal("Failed to reach drive service")
            })?;
        if !resp.status().is_success() {
            tracing::error!(
                "Drive service update_file_name returned {}",
                resp.status()
            );
            return Err(ApiError::internal("Drive service error"));
        }
        Ok(())
    }
}
