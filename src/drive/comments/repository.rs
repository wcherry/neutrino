use crate::drive::comments::model::{Comment, CommentReply, NewComment, NewCommentReply};
use crate::schema::{comment_replies, comments};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct CommentsRepository {
    pool: DbPool,
}

impl CommentsRepository {
    pub fn new(pool: DbPool) -> Self {
        CommentsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_comment(&self, new_comment: &NewComment) -> Result<Comment, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(comments::table)
            .values(new_comment)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert comment error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        comments::table
            .filter(comments::id.eq(&new_comment.id))
            .select(Comment::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find comment after insert: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_comment(&self, comment_id: &str) -> Result<Option<Comment>, ApiError> {
        let mut conn = self.get_conn()?;
        comments::table
            .filter(comments::id.eq(comment_id))
            .select(Comment::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find comment error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_comments_for_file(
        &self,
        file_id: &str,
        status_filter: Option<&str>,
    ) -> Result<Vec<Comment>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = comments::table
            .filter(comments::file_id.eq(file_id))
            .into_boxed();
        if let Some(status) = status_filter {
            if status != "all" {
                query = query.filter(comments::status.eq(status));
            }
        }
        query
            .order(comments::created_at.asc())
            .select(Comment::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list comments error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn count_comments_for_file(
        &self,
        file_id: &str,
        status_filter: Option<&str>,
    ) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = comments::table
            .filter(comments::file_id.eq(file_id))
            .into_boxed();
        if let Some(status) = status_filter {
            if status != "all" {
                query = query.filter(comments::status.eq(status));
            }
        }
        query
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count comments error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_comment_body(&self, comment_id: &str, body: &str, now: chrono::NaiveDateTime) -> Result<Comment, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(comments::table.filter(comments::id.eq(comment_id)))
            .set((
                comments::body.eq(body),
                comments::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update comment body error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.find_comment(comment_id)?
            .ok_or_else(|| ApiError::internal("Comment not found after update"))
    }

    pub fn resolve_comment(
        &self,
        comment_id: &str,
        resolved_by: &str,
        now: chrono::NaiveDateTime,
    ) -> Result<Comment, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(comments::table.filter(comments::id.eq(comment_id)))
            .set((
                comments::status.eq("resolved"),
                comments::resolved_at.eq(now),
                comments::resolved_by.eq(resolved_by),
                comments::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB resolve comment error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.find_comment(comment_id)?
            .ok_or_else(|| ApiError::internal("Comment not found after resolve"))
    }

    pub fn delete_comment(&self, comment_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        // Delete replies first
        diesel::delete(comment_replies::table.filter(comment_replies::comment_id.eq(comment_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete replies error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        diesel::delete(comments::table.filter(comments::id.eq(comment_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete comment error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_replies_for_comment(&self, comment_id: &str) -> Result<Vec<CommentReply>, ApiError> {
        let mut conn = self.get_conn()?;
        comment_replies::table
            .filter(comment_replies::comment_id.eq(comment_id))
            .order(comment_replies::created_at.asc())
            .select(CommentReply::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list replies error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn insert_reply(&self, new_reply: &NewCommentReply) -> Result<CommentReply, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(comment_replies::table)
            .values(new_reply)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert reply error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        comment_replies::table
            .filter(comment_replies::id.eq(&new_reply.id))
            .select(CommentReply::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find reply after insert: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_reply(&self, reply_id: &str) -> Result<Option<CommentReply>, ApiError> {
        let mut conn = self.get_conn()?;
        comment_replies::table
            .filter(comment_replies::id.eq(reply_id))
            .select(CommentReply::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find reply error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_reply(&self, reply_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(comment_replies::table.filter(comment_replies::id.eq(reply_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete reply error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
