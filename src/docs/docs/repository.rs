use crate::docs::docs::model::{DocRecord, NewDocRecord};
use crate::schema::docs;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// Page setup — the one piece of document state Drive has no notion of.
/// Everything else about a document (name, folder, content, versions,
/// permissions) lives on its `files` row.
///
/// A row here is optional: a document that has never had its page setup
/// changed simply has none, and reads fall back to the default. That means
/// nothing has to create a row at document-creation time, which is what lets
/// documents be created through the generic drive endpoint.
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

    /// `None` when the document has no stored page setup — the caller
    /// substitutes the default rather than treating it as a missing document.
    pub fn find_page_setup(&self, file_id: &str) -> Result<Option<DocRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        docs::table
            .filter(docs::file_id.eq(file_id))
            .select(DocRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get doc page setup error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn upsert_page_setup(&self, file_id: &str, page_setup: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let record = NewDocRecord {
            file_id,
            page_setup,
        };
        diesel::insert_into(docs::table)
            .values(&record)
            .on_conflict(docs::file_id)
            .do_update()
            .set(docs::page_setup.eq(page_setup))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB upsert doc page setup error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
