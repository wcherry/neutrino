use crate::diagrams::diagrams::model::{
    DiagramCommentRecord, DiagramRecord, NewDiagramCommentRecord, NewDiagramRecord,
    UpdateDiagramCommentRecord, UpdateDiagramRecord,
};
use crate::schema::{diagram_comments, diagrams};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct DiagramsRepository {
    pool: DbPool,
}

impl DiagramsRepository {
    pub fn new(pool: DbPool) -> Self {
        DiagramsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    // ── Diagrams ──────────────────────────────────────────────────────────────

    pub fn insert_diagram(&self, new: NewDiagramRecord) -> Result<DiagramRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(diagrams::table)
            .values(&new)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert diagram error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        diagrams::table
            .filter(diagrams::file_id.eq(new.file_id))
            .select(DiagramRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after diagram insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_diagram(&self, file_id: &str) -> Result<DiagramRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diagrams::table
            .filter(diagrams::file_id.eq(file_id))
            .select(DiagramRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Diagram not found"),
                _ => {
                    tracing::error!("DB get diagram error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_diagram(
        &self,
        file_id: &str,
        changes: UpdateDiagramRecord,
    ) -> Result<DiagramRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(diagrams::table.filter(diagrams::file_id.eq(file_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update diagram error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_diagram(file_id)
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    pub fn insert_comment(
        &self,
        new: NewDiagramCommentRecord,
    ) -> Result<DiagramCommentRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(diagram_comments::table)
            .values(&new)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert comment error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        diagram_comments::table
            .filter(diagram_comments::id.eq(new.id))
            .select(DiagramCommentRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after comment insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_comments(&self, file_id: &str) -> Result<Vec<DiagramCommentRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        diagram_comments::table
            .filter(diagram_comments::file_id.eq(file_id))
            .order(diagram_comments::created_at.asc())
            .select(DiagramCommentRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list comments error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_comment(&self, id: &str) -> Result<DiagramCommentRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diagram_comments::table
            .filter(diagram_comments::id.eq(id))
            .select(DiagramCommentRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Comment not found"),
                _ => {
                    tracing::error!("DB get comment error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_comment(
        &self,
        id: &str,
        user_id: &str,
        changes: UpdateDiagramCommentRecord,
    ) -> Result<DiagramCommentRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let rows = diesel::update(
            diagram_comments::table
                .filter(diagram_comments::id.eq(id))
                .filter(diagram_comments::user_id.eq(user_id)),
        )
        .set(&changes)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update comment error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if rows == 0 {
            return Err(ApiError::not_found(
                "Comment not found or permission denied",
            ));
        }
        self.get_comment(id)
    }

    pub fn delete_comment(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let rows = diesel::delete(
            diagram_comments::table
                .filter(diagram_comments::id.eq(id))
                .filter(diagram_comments::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete comment error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if rows == 0 {
            return Err(ApiError::not_found(
                "Comment not found or permission denied",
            ));
        }
        Ok(())
    }
}
