use crate::photos::suggestions::model::{NewSuggestionRecord, SuggestionRecord};
use crate::schema::{face_suggestions, faces, photos};
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

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

    /// Insert a suggestion only if no prior rejected suggestion exists for this (face, person) pair.
    /// Silently ignores duplicates (pending already exists).
    pub fn insert_if_not_rejected(
        &self,
        id: &str,
        face_id: &str,
        person_id: &str,
        confidence: f32,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let already_rejected = face_suggestions::table
            .filter(face_suggestions::face_id.eq(face_id))
            .filter(face_suggestions::person_id.eq(person_id))
            .filter(face_suggestions::status.eq("rejected"))
            .count()
            .get_result::<i64>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB check rejected suggestion error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        if already_rejected > 0 {
            return Ok(());
        }

        let record = NewSuggestionRecord {
            id,
            face_id,
            person_id,
            confidence,
            status: "pending",
            created_at: now,
            updated_at: now,
        };
        diesel::insert_or_ignore_into(face_suggestions::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert suggestion error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    /// List all pending suggestions for photos owned by a given user.
    pub fn list_pending_for_user(&self, user_id: &str) -> Result<Vec<SuggestionRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        face_suggestions::table
            .inner_join(faces::table.on(face_suggestions::face_id.eq(faces::id)))
            .inner_join(photos::table.on(faces::photo_id.eq(photos::id)))
            .filter(photos::user_id.eq(user_id))
            .filter(face_suggestions::status.eq("pending"))
            .select(SuggestionRecord::as_select())
            .order(face_suggestions::created_at.desc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list suggestions error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_suggestion(&self, id: &str) -> Result<SuggestionRecord, ApiError> {
        let mut conn = self.get_conn()?;
        face_suggestions::table
            .filter(face_suggestions::id.eq(id))
            .select(SuggestionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Suggestion not found"),
                _ => {
                    tracing::error!("DB get suggestion error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_status(
        &self,
        id: &str,
        status: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(face_suggestions::table.filter(face_suggestions::id.eq(id)))
            .set((
                face_suggestions::status.eq(status),
                face_suggestions::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update suggestion status error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    /// Delete all pending suggestions for a face (called when face is assigned to a person).
    pub fn delete_pending_for_face(&self, face_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            face_suggestions::table
                .filter(face_suggestions::face_id.eq(face_id))
                .filter(face_suggestions::status.eq("pending")),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete suggestions for face error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }
}
