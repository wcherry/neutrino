use crate::drive::activity::service::ActivityService;
use crate::drive::comments::{
    dto::{
        CommentListResponse, CommentReplyResponse, CommentResponse, CreateCommentRequest,
        CreateReplyRequest, UpdateCommentRequest,
    },
    model::{NewComment, NewCommentReply},
    repository::CommentsRepository,
};
use crate::drive::notifications::service::NotificationService;
use crate::drive::permissions::service::PermissionsService;
use crate::shared::{ApiError, AuthenticatedUser};
use regex::Regex;
use std::sync::Arc;
use uuid::Uuid;

pub struct CommentsService {
    repo: Arc<CommentsRepository>,
    notification_service: Arc<NotificationService>,
    activity_service: Arc<ActivityService>,
    permissions_service: Arc<PermissionsService>,
}

impl CommentsService {
    pub fn new(
        repo: Arc<CommentsRepository>,
        notification_service: Arc<NotificationService>,
        activity_service: Arc<ActivityService>,
        permissions_service: Arc<PermissionsService>,
    ) -> Self {
        CommentsService {
            repo,
            notification_service,
            activity_service,
            permissions_service,
        }
    }

    pub async fn create_comment(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        req: CreateCommentRequest,
    ) -> Result<CommentResponse, ApiError> {
        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        match role.as_deref() {
            None => return Err(ApiError::new(403, "FORBIDDEN", "Access denied")),
            Some("viewer") => {
                return Err(ApiError::new(403, "FORBIDDEN", "Viewers cannot comment"))
            }
            _ => {}
        }

        let now = chrono::Local::now().naive_local();
        let id = Uuid::new_v4().to_string();
        let user_name = user
            .email
            .split('@')
            .next()
            .unwrap_or(&user.email)
            .to_string();

        let new_comment = NewComment {
            id: id.clone(),
            file_id: file_id.to_string(),
            user_id: user.user_id.clone(),
            user_name: user_name.clone(),
            anchor_json: req.anchor_json,
            body: req.body.clone(),
            status: "open".to_string(),
            assignee_id: req.assignee_id.clone(),
            created_at: now,
            updated_at: now,
        };

        let comment = self.repo.insert_comment(&new_comment)?;

        // Log activity
        self.activity_service.log(
            file_id,
            &user.user_id,
            &user_name,
            "comment_added",
            Some(serde_json::json!({"commentId": id})),
        )?;

        // Extract @mentions and notify
        let mentions = extract_mentions(&req.body);
        for mention_id in mentions {
            if mention_id != user.user_id {
                let _ = self
                    .notification_service
                    .notify(
                        vec![mention_id],
                        "mention",
                        serde_json::json!({
                            "fileId": file_id,
                            "actorName": user_name,
                            "commentId": id,
                        }),
                    )
                    .await;
            }
        }

        // Notify assignee if set
        if let Some(ref assignee_id) = req.assignee_id {
            if assignee_id != &user.user_id {
                let _ = self
                    .notification_service
                    .notify(
                        vec![assignee_id.clone()],
                        "action_item_assigned",
                        serde_json::json!({
                            "fileId": file_id,
                            "actorName": user_name,
                            "commentId": id,
                        }),
                    )
                    .await;
            }
        }

        let replies = self.repo.list_replies_for_comment(&comment.id)?;
        Ok(CommentResponse::from_comment_with_replies(comment, replies))
    }

    pub fn list_comments(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        status_filter: Option<&str>,
    ) -> Result<CommentListResponse, ApiError> {
        // Check user has at least viewer access
        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        if role.is_none() {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }

        let status = status_filter.unwrap_or("open");
        let comments = self.repo.list_comments_for_file(file_id, Some(status))?;
        let total = self.repo.count_comments_for_file(file_id, Some(status))?;

        let mut responses = Vec::new();
        for comment in comments {
            let replies = self.repo.list_replies_for_comment(&comment.id)?;
            responses.push(CommentResponse::from_comment_with_replies(comment, replies));
        }

        Ok(CommentListResponse {
            comments: responses,
            total,
        })
    }

    pub fn update_comment(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        comment_id: &str,
        req: UpdateCommentRequest,
    ) -> Result<CommentResponse, ApiError> {
        let comment = self
            .repo
            .find_comment(comment_id)?
            .ok_or_else(|| ApiError::not_found("Comment not found"))?;

        if comment.file_id != file_id {
            return Err(ApiError::not_found("Comment not found"));
        }

        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        let is_author = comment.user_id == user.user_id;
        let is_editor_or_owner = matches!(role.as_deref(), Some("owner") | Some("editor"));

        if !is_author && !is_editor_or_owner {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Cannot update this comment",
            ));
        }

        let now = chrono::Local::now().naive_local();

        let updated = if let Some(ref status) = req.status {
            if status == "resolved" {
                self.repo.resolve_comment(comment_id, &user.user_id, now)?
            } else {
                return Err(ApiError::bad_request("Invalid status"));
            }
        } else if let Some(ref body) = req.body {
            self.repo.update_comment_body(comment_id, body, now)?
        } else {
            comment
        };

        let replies = self.repo.list_replies_for_comment(&updated.id)?;
        Ok(CommentResponse::from_comment_with_replies(updated, replies))
    }

    pub fn delete_comment(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        comment_id: &str,
    ) -> Result<(), ApiError> {
        let comment = self
            .repo
            .find_comment(comment_id)?
            .ok_or_else(|| ApiError::not_found("Comment not found"))?;

        if comment.file_id != file_id {
            return Err(ApiError::not_found("Comment not found"));
        }

        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        let is_author = comment.user_id == user.user_id;
        let is_owner = role.as_deref() == Some("owner");

        if !is_author && !is_owner {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Cannot delete this comment",
            ));
        }

        self.repo.delete_comment(comment_id)?;
        Ok(())
    }

    pub async fn add_reply(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        comment_id: &str,
        req: CreateReplyRequest,
    ) -> Result<CommentReplyResponse, ApiError> {
        let comment = self
            .repo
            .find_comment(comment_id)?
            .ok_or_else(|| ApiError::not_found("Comment not found"))?;

        if comment.file_id != file_id {
            return Err(ApiError::not_found("Comment not found"));
        }

        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        match role.as_deref() {
            None => return Err(ApiError::new(403, "FORBIDDEN", "Access denied")),
            Some("viewer") => {
                return Err(ApiError::new(403, "FORBIDDEN", "Viewers cannot comment"))
            }
            _ => {}
        }

        let now = chrono::Local::now().naive_local();
        let id = Uuid::new_v4().to_string();
        let user_name = user
            .email
            .split('@')
            .next()
            .unwrap_or(&user.email)
            .to_string();

        let new_reply = NewCommentReply {
            id: id.clone(),
            comment_id: comment_id.to_string(),
            user_id: user.user_id.clone(),
            user_name: user_name.clone(),
            body: req.body.clone(),
            created_at: now,
            updated_at: now,
        };

        let reply = self.repo.insert_reply(&new_reply)?;

        // Notify original comment author
        if comment.user_id != user.user_id {
            let _ = self
                .notification_service
                .notify(
                    vec![comment.user_id.clone()],
                    "comment_reply",
                    serde_json::json!({
                        "fileId": file_id,
                        "actorName": user_name,
                        "commentId": comment_id,
                        "replyId": id,
                    }),
                )
                .await;
        }

        // Extract @mentions from reply
        let mentions = extract_mentions(&req.body);
        for mention_id in mentions {
            if mention_id != user.user_id && mention_id != comment.user_id {
                let _ = self
                    .notification_service
                    .notify(
                        vec![mention_id],
                        "mention",
                        serde_json::json!({
                            "fileId": file_id,
                            "actorName": user_name,
                            "commentId": comment_id,
                        }),
                    )
                    .await;
            }
        }

        Ok(CommentReplyResponse::from(reply))
    }

    pub fn delete_reply(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        comment_id: &str,
        reply_id: &str,
    ) -> Result<(), ApiError> {
        let comment = self
            .repo
            .find_comment(comment_id)?
            .ok_or_else(|| ApiError::not_found("Comment not found"))?;

        if comment.file_id != file_id {
            return Err(ApiError::not_found("Comment not found"));
        }

        let reply = self
            .repo
            .find_reply(reply_id)?
            .ok_or_else(|| ApiError::not_found("Reply not found"))?;

        if reply.comment_id != comment_id {
            return Err(ApiError::not_found("Reply not found"));
        }

        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        let is_author = reply.user_id == user.user_id;
        let is_owner = role.as_deref() == Some("owner");

        if !is_author && !is_owner {
            return Err(ApiError::new(403, "FORBIDDEN", "Cannot delete this reply"));
        }

        self.repo.delete_reply(reply_id)?;
        Ok(())
    }
}

fn extract_mentions(body: &str) -> Vec<String> {
    // Simple regex to extract user IDs from @mentions
    // In production, @mentions would reference user IDs stored in the body
    // For now, extract anything matching @word pattern as potential user ID
    let re = match Regex::new(r"@([a-zA-Z0-9_-]+)") {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    re.captures_iter(body)
        .filter_map(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
        .collect()
}
