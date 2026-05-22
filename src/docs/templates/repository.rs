use crate::shared::ApiError;
use crate::schema::doc_templates;
use crate::docs::templates::model::{DocTemplate, NewDocTemplate, UpdateDocTemplate};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct TemplatesRepository {
    pool: DbPool,
}

impl TemplatesRepository {
    pub fn new(pool: DbPool) -> Self {
        TemplatesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn list_all(&self) -> Result<Vec<DocTemplate>, ApiError> {
        let mut conn = self.get_conn()?;
        doc_templates::table
            .select(DocTemplate::as_select())
            .order(doc_templates::name.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list templates error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<DocTemplate>, ApiError> {
        let mut conn = self.get_conn()?;
        doc_templates::table
            .filter(doc_templates::id.eq(id))
            .select(DocTemplate::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get template error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn insert(&self, new_template: NewDocTemplate) -> Result<DocTemplate, ApiError> {
        let mut conn = self.get_conn()?;
        let id = new_template.id.clone();
        diesel::insert_into(doc_templates::table)
            .values(&new_template)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert template error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        doc_templates::table
            .filter(doc_templates::id.eq(&id))
            .select(DocTemplate::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update(
        &self,
        id: &str,
        changes: UpdateDocTemplate,
    ) -> Result<DocTemplate, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(doc_templates::table.filter(doc_templates::id.eq(id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update template error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        doc_templates::table
            .filter(doc_templates::id.eq(id))
            .select(DocTemplate::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn clear_all_defaults(&self) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(doc_templates::table.filter(doc_templates::is_default.eq(1)))
            .set(doc_templates::is_default.eq(0))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB clear defaults error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(doc_templates::table.filter(doc_templates::id.eq(id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete template error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn count_by_name(&self, name: &str) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;
        doc_templates::table
            .filter(doc_templates::name.eq(name))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count by name error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
