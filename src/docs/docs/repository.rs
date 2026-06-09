use crate::docs::docs::model::{DocRecord, NewDocRecord, UpdateDocRecord};
use crate::schema::docs;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct DocsRepository {
    pool: DbPool,
}

impl DocsRepository {
    pub fn new(pool: DbPool) -> Self {
        DocsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_doc(&self, new_doc: NewDocRecord) -> Result<DocRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(docs::table)
            .values(&new_doc)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert doc error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        docs::table
            .filter(docs::file_id.eq(new_doc.file_id))
            .select(DocRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after doc insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_doc(&self, file_id: &str) -> Result<DocRecord, ApiError> {
        let mut conn = self.get_conn()?;
        docs::table
            .filter(docs::file_id.eq(file_id))
            .select(DocRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Document not found"),
                _ => {
                    tracing::error!("DB get doc error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_doc(
        &self,
        file_id: &str,
        changes: UpdateDocRecord,
    ) -> Result<DocRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(docs::table.filter(docs::file_id.eq(file_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update doc error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_doc(file_id)
    }
}
