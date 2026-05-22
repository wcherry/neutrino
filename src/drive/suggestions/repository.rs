use crate::drive::suggestions::model::{DocSuggestion, NewDocSuggestion};
use crate::schema::doc_suggestions;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct SuggestionsRepository {
    pool: DbPool,
}

impl SuggestionsRepository {
    pub fn new(pool: DbPool) -> Self {
        SuggestionsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_suggestion(&self, new_sug: &NewDocSuggestion) -> Result<DocSuggestion, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(doc_suggestions::table)
            .values(new_sug)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert suggestion error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        doc_suggestions::table
            .filter(doc_suggestions::id.eq(&new_sug.id))
            .select(DocSuggestion::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find suggestion after insert: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_suggestion(&self, suggestion_id: &str) -> Result<Option<DocSuggestion>, ApiError> {
        let mut conn = self.get_conn()?;
        doc_suggestions::table
            .filter(doc_suggestions::id.eq(suggestion_id))
            .select(DocSuggestion::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find suggestion error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_suggestions_for_file(
        &self,
        file_id: &str,
        status_filter: Option<&str>,
    ) -> Result<Vec<DocSuggestion>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = doc_suggestions::table
            .filter(doc_suggestions::file_id.eq(file_id))
            .into_boxed();
        if let Some(status) = status_filter {
            if status != "all" {
                query = query.filter(doc_suggestions::status.eq(status));
            }
        }
        query
            .order(doc_suggestions::created_at.desc())
            .select(DocSuggestion::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list suggestions error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn resolve_suggestion(
        &self,
        suggestion_id: &str,
        status: &str,
        resolved_by: &str,
        now: chrono::NaiveDateTime,
    ) -> Result<DocSuggestion, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(doc_suggestions::table.filter(doc_suggestions::id.eq(suggestion_id)))
            .set((
                doc_suggestions::status.eq(status),
                doc_suggestions::resolved_at.eq(now),
                doc_suggestions::resolved_by.eq(resolved_by),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB resolve suggestion error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.find_suggestion(suggestion_id)?
            .ok_or_else(|| ApiError::internal("Suggestion not found after update"))
    }
}
