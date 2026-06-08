use crate::shared::{ApiError, AuthenticatedUser};
use crate::diagrams::diagrams::{
    dto::{
        CreateCommentRequest, CreateDiagramRequest, DiagramCommentResponse, DiagramMetaResponse,
        DiagramResponse, ListCommentsResponse, ListDiagramsResponse, SaveDiagramRequest,
        UpdateCommentRequest,
    },
    model::{NewDiagramCommentRecord, NewDiagramRecord, UpdateDiagramCommentRecord, UpdateDiagramRecord},
    repository::DiagramsRepository,
};
use crate::shared::drive_client::DriveClient;
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// MIME type that identifies Neutrino diagram files in drive.
pub const MIME_TYPE: &str = "application/x-neutrino-diagram";

/// Default empty diagram: one blank page.
pub const EMPTY_DIAGRAM_CONTENT: &str = r#"{"version":1,"pages":[{"id":"page-1","name":"Page 1","shapes":[],"connectors":[]}],"viewport":{"x":0,"y":0,"zoom":1}}"#;

fn content_urls(file_id: &str) -> (String, String) {
    (
        format!("/api/v1/drive/files/{}", file_id),
        format!("/api/v1/drive/files/{}/versions", file_id),
    )
}

pub struct DiagramsService {
    repo: Arc<DiagramsRepository>,
    drive: Arc<DriveClient>,
}

impl DiagramsService {
    pub fn new(repo: Arc<DiagramsRepository>, drive: Arc<DriveClient>) -> Self {
        DiagramsService { repo, drive }
    }

    pub async fn list_diagrams(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListDiagramsResponse, ApiError> {
        let items = self.drive.list_files(user, MIME_TYPE).await?;
        let diagrams = items
            .into_iter()
            .map(|item| DiagramMetaResponse {
                id: item.id,
                title: item.name,
                folder_id: item.folder_id,
                created_at: item.created_at.and_utc().to_rfc3339(),
                updated_at: item.updated_at.and_utc().to_rfc3339(),
            })
            .collect();
        Ok(ListDiagramsResponse { diagrams })
    }

    pub async fn create_diagram(
        &self,
        user: &AuthenticatedUser,
        req: CreateDiagramRequest,
    ) -> Result<DiagramResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Diagram title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let file = self
            .drive
            .create_file(user, &id, &title, MIME_TYPE, req.folder_id.as_deref())
            .await?;
        let new_diagram = NewDiagramRecord { file_id: &id };
        self.repo.insert_diagram(new_diagram)?;

        self.drive
            .upload_content(&id, EMPTY_DIAGRAM_CONTENT, "upload_diagram_content")
            .await?;

        let (content_url, content_write_url) = content_urls(&id);
        Ok(DiagramResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn get_diagram(
        &self,
        user: &AuthenticatedUser,
        diagram_id: &str,
    ) -> Result<DiagramResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, diagram_id, "Diagram not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Diagram is in trash"));
        }
        let (content_url, content_write_url) = content_urls(diagram_id);
        Ok(DiagramResponse {
            id: file.id,
            title: file.name,
            content_url,
            content_write_url,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: file.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub async fn save_diagram(
        &self,
        user: &AuthenticatedUser,
        diagram_id: &str,
        req: SaveDiagramRequest,
    ) -> Result<DiagramMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, diagram_id, "Diagram not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Diagram is in trash"));
        }

        let new_title = if let Some(ref title) = req.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, diagram_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateDiagramRecord { updated_at: now };
        self.repo.update_diagram(diagram_id, changes)?;

        Ok(DiagramMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    pub async fn autosave(
        &self,
        user: &AuthenticatedUser,
        diagram_id: &str,
        bytes: &[u8],
        title: Option<&str>,
    ) -> Result<DiagramMetaResponse, ApiError> {
        let file = self
            .drive
            .get_file(user, diagram_id, "Diagram not found")
            .await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Diagram is in trash"));
        }

        self.drive.upload_content_bytes(diagram_id, bytes)?;

        let new_title = if let Some(t) = title {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                self.drive.update_file_name(user, diagram_id, &trimmed).await?;
                trimmed
            } else {
                file.name.clone()
            }
        } else {
            file.name.clone()
        };

        let now = Utc::now().naive_utc();
        let changes = UpdateDiagramRecord { updated_at: now };
        self.repo.update_diagram(diagram_id, changes)?;

        Ok(DiagramMetaResponse {
            id: file.id,
            title: new_title,
            folder_id: file.folder_id,
            created_at: file.created_at.and_utc().to_rfc3339(),
            updated_at: now.and_utc().to_rfc3339(),
        })
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    pub async fn create_comment(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        req: CreateCommentRequest,
    ) -> Result<DiagramCommentResponse, ApiError> {
        // Verify access to the diagram
        let file = self.drive.get_file(user, file_id, "Diagram not found").await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Diagram is in trash"));
        }
        let content = req.content.trim().to_string();
        if content.is_empty() {
            return Err(ApiError::bad_request("Comment content cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let new_comment = NewDiagramCommentRecord {
            id: &id,
            file_id,
            user_id: &user.user_id,
            content: &content,
            parent_id: req.parent_id.as_deref(),
            shape_id: req.shape_id.as_deref(),
            resolved: false,
        };
        let record = self.repo.insert_comment(new_comment)?;
        Ok(comment_record_to_response(record))
    }

    pub async fn list_comments(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
    ) -> Result<ListCommentsResponse, ApiError> {
        // Verify access to the diagram
        let file = self.drive.get_file(user, file_id, "Diagram not found").await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Diagram is in trash"));
        }
        let records = self.repo.list_comments(file_id)?;
        let comments = records.into_iter().map(comment_record_to_response).collect();
        Ok(ListCommentsResponse { comments })
    }

    pub async fn update_comment(
        &self,
        user: &AuthenticatedUser,
        comment_id: &str,
        req: UpdateCommentRequest,
    ) -> Result<DiagramCommentResponse, ApiError> {
        if req.content.is_none() && req.resolved.is_none() {
            return Err(ApiError::bad_request("No fields to update"));
        }
        if let Some(ref c) = req.content {
            if c.trim().is_empty() {
                return Err(ApiError::bad_request("Comment content cannot be empty"));
            }
        }
        let changes = UpdateDiagramCommentRecord {
            content: req.content,
            resolved: req.resolved,
            updated_at: Utc::now().naive_utc(),
        };
        let record = self.repo.update_comment(comment_id, &user.user_id, changes)?;
        Ok(comment_record_to_response(record))
    }

    pub async fn delete_comment(
        &self,
        user: &AuthenticatedUser,
        comment_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.delete_comment(comment_id, &user.user_id)
    }
}

// ── Free helpers ──────────────────────────────────────────────────────────────

fn comment_record_to_response(r: crate::diagrams::diagrams::model::DiagramCommentRecord) -> DiagramCommentResponse {
    DiagramCommentResponse {
        id: r.id,
        file_id: r.file_id,
        user_id: r.user_id,
        content: r.content,
        parent_id: r.parent_id,
        shape_id: r.shape_id,
        resolved: r.resolved,
        created_at: r.created_at.and_utc().to_rfc3339(),
        updated_at: r.updated_at.and_utc().to_rfc3339(),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_urls_returns_correct_paths() {
        let (content_url, versions_url) = content_urls("diag-xyz");
        assert_eq!(content_url, "/api/v1/drive/files/diag-xyz");
        assert_eq!(versions_url, "/api/v1/drive/files/diag-xyz/versions");
    }

    #[test]
    fn mime_type_constant_is_correct() {
        assert_eq!(MIME_TYPE, "application/x-neutrino-diagram");
    }

    #[test]
    fn empty_diagram_content_is_valid_json_with_pages_key() {
        let parsed: serde_json::Value =
            serde_json::from_str(EMPTY_DIAGRAM_CONTENT).expect("should be valid JSON");
        assert!(parsed.get("pages").is_some(), "should have 'pages' key");
        let pages = parsed["pages"].as_array().expect("pages should be array");
        assert_eq!(pages.len(), 1, "should have one page");
    }

    #[test]
    fn empty_diagram_content_has_version_field() {
        let parsed: serde_json::Value =
            serde_json::from_str(EMPTY_DIAGRAM_CONTENT).expect("should be valid JSON");
        assert_eq!(parsed["version"].as_u64(), Some(1));
    }
}
