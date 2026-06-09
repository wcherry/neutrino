use crate::drive::comments::model::{Comment, CommentReply};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommentRequest {
    pub body: String,
    pub anchor_json: Option<String>,
    pub assignee_id: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCommentRequest {
    pub body: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateReplyRequest {
    pub body: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentReplyResponse {
    pub id: String,
    pub comment_id: String,
    pub user_id: String,
    pub user_name: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<CommentReply> for CommentReplyResponse {
    fn from(r: CommentReply) -> Self {
        CommentReplyResponse {
            id: r.id,
            comment_id: r.comment_id,
            user_id: r.user_id,
            user_name: r.user_name,
            body: r.body,
            created_at: r.created_at.to_string(),
            updated_at: r.updated_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentResponse {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub anchor_json: Option<String>,
    pub body: String,
    pub status: String,
    pub assignee_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub resolved_at: Option<String>,
    pub resolved_by: Option<String>,
    pub replies: Vec<CommentReplyResponse>,
}

impl CommentResponse {
    pub fn from_comment_with_replies(c: Comment, replies: Vec<CommentReply>) -> Self {
        CommentResponse {
            id: c.id,
            file_id: c.file_id,
            user_id: c.user_id,
            user_name: c.user_name,
            anchor_json: c.anchor_json,
            body: c.body,
            status: c.status,
            assignee_id: c.assignee_id,
            created_at: c.created_at.to_string(),
            updated_at: c.updated_at.to_string(),
            resolved_at: c.resolved_at.map(|d| d.to_string()),
            resolved_by: c.resolved_by,
            replies: replies
                .into_iter()
                .map(CommentReplyResponse::from)
                .collect(),
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentListResponse {
    pub comments: Vec<CommentResponse>,
    pub total: i64,
}
