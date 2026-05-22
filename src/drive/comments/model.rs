use diesel::prelude::*;
use serde::Serialize;
use crate::schema::{comments, comment_replies};

#[derive(Debug, Queryable, Selectable, Serialize, Clone)]
#[diesel(table_name = comments)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Comment {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub anchor_json: Option<String>,
    pub body: String,
    pub status: String,
    pub assignee_id: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
    pub resolved_at: Option<chrono::NaiveDateTime>,
    pub resolved_by: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = comments)]
pub struct NewComment {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub user_name: String,
    pub anchor_json: Option<String>,
    pub body: String,
    pub status: String,
    pub assignee_id: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

#[derive(Debug, Queryable, Selectable, Serialize, Clone)]
#[diesel(table_name = comment_replies)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct CommentReply {
    pub id: String,
    pub comment_id: String,
    pub user_id: String,
    pub user_name: String,
    pub body: String,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = comment_replies)]
pub struct NewCommentReply {
    pub id: String,
    pub comment_id: String,
    pub user_id: String,
    pub user_name: String,
    pub body: String,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}
