//! Diagram comments — the one piece of diagram state that isn't a Drive file.
//!
//! Diagram CRUD used to live here as a pass-through to `DriveClient`; it now
//! goes straight to the generic drive file endpoints, with
//! `application/x-neutrino-diagram` (see `drive::storage::native_types`)
//! marking a file as a diagram.

use crate::diagrams::diagrams::{
    dto::{
        CreateCommentRequest, DiagramCommentResponse, ListCommentsResponse, UpdateCommentRequest,
    },
    model::{NewDiagramCommentRecord, UpdateDiagramCommentRecord},
    repository::DiagramsRepository,
};
use crate::shared::drive_client::DriveClient;
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

pub struct DiagramsService {
    repo: Arc<DiagramsRepository>,
    drive: Arc<DriveClient>,
}

impl DiagramsService {
    pub fn new(repo: Arc<DiagramsRepository>, drive: Arc<DriveClient>) -> Self {
        DiagramsService { repo, drive }
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    pub async fn create_comment(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        req: CreateCommentRequest,
    ) -> Result<DiagramCommentResponse, ApiError> {
        // Verify access to the diagram
        let file = self
            .drive
            .get_file(user, file_id, "Diagram not found")
            .await?;
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
        let file = self
            .drive
            .get_file(user, file_id, "Diagram not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Diagram is in trash"));
        }
        let records = self.repo.list_comments(file_id)?;
        let comments = records
            .into_iter()
            .map(comment_record_to_response)
            .collect();
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
        let record = self
            .repo
            .update_comment(comment_id, &user.user_id, changes)?;
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

fn comment_record_to_response(
    r: crate::diagrams::diagrams::model::DiagramCommentRecord,
) -> DiagramCommentResponse {
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
