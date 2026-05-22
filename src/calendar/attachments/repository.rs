use crate::calendar::attachments::model::{AttachmentRecord, NewAttachmentRecord};
use crate::shared::{ApiError, DbPool};
use crate::schema::event_attachments;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager};

pub struct AttachmentsRepository {
    pool: DbPool,
}

impl AttachmentsRepository {
    pub fn new(pool: DbPool) -> Self {
        AttachmentsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn find_by_event(&self, event_id: &str) -> Result<Vec<AttachmentRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        event_attachments::table
            .filter(event_attachments::event_id.eq(event_id))
            .select(AttachmentRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list attachments error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn insert(&self, record: NewAttachmentRecord) -> Result<AttachmentRecord, ApiError> {
        let id = record.id.clone();
        let mut conn = self.get_conn()?;
        diesel::insert_into(event_attachments::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert attachment error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        event_attachments::table
            .filter(event_attachments::id.eq(&id))
            .select(AttachmentRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after attachment insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete(&self, attachment_id: &str, event_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            event_attachments::table.filter(
                event_attachments::id
                    .eq(attachment_id)
                    .and(event_attachments::event_id.eq(event_id)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete attachment error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Attachment not found"));
        }
        Ok(())
    }
}
