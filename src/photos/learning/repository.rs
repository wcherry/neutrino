use crate::photos::learning::model::{
    NewTrainingSignalRecord, NewUserThresholdRecord, TrainingSignalRecord, UserThresholdRecord,
};
use crate::schema::{training_signals, user_recognition_thresholds};
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct LearningRepository {
    pool: DbPool,
}

impl LearningRepository {
    pub fn new(pool: DbPool) -> Self {
        LearningRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    /// Store a feedback signal from a suggestion accept or reject.
    pub fn insert_signal(
        &self,
        id: &str,
        user_id: &str,
        face_id: &str,
        person_id: &str,
        action: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let record = NewTrainingSignalRecord {
            id,
            user_id,
            face_id,
            person_id,
            action,
            processed: false,
            created_at: now,
        };
        diesel::insert_into(training_signals::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert training signal error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    /// Return distinct user_ids that have unprocessed training signals.
    pub fn list_users_with_pending_signals(&self) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        training_signals::table
            .filter(training_signals::processed.eq(false))
            .select(training_signals::user_id)
            .distinct()
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list users with pending signals error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return all unprocessed signals for a user.
    pub fn list_unprocessed_signals_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<TrainingSignalRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        training_signals::table
            .filter(training_signals::user_id.eq(user_id))
            .filter(training_signals::processed.eq(false))
            .select(TrainingSignalRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list unprocessed signals error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Mark all unprocessed signals for a user as processed.
    pub fn mark_signals_processed(&self, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(
            training_signals::table
                .filter(training_signals::user_id.eq(user_id))
                .filter(training_signals::processed.eq(false)),
        )
        .set(training_signals::processed.eq(true))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB mark signals processed error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }

    /// Get per-user recognition thresholds. Returns None if not yet set (use defaults).
    pub fn get_thresholds(&self, user_id: &str) -> Result<Option<UserThresholdRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        user_recognition_thresholds::table
            .filter(user_recognition_thresholds::user_id.eq(user_id))
            .select(UserThresholdRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get thresholds error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Insert or replace threshold record for a user.
    pub fn upsert_thresholds(
        &self,
        user_id: &str,
        auto_tag_threshold: f32,
        suggest_threshold: f32,
        total_accepts: i32,
        total_rejects: i32,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let record = NewUserThresholdRecord {
            user_id,
            auto_tag_threshold,
            suggest_threshold,
            total_accepts,
            total_rejects,
            updated_at: now,
        };
        diesel::insert_into(user_recognition_thresholds::table)
            .values(&record)
            .on_conflict(user_recognition_thresholds::user_id)
            .do_update()
            .set((
                user_recognition_thresholds::auto_tag_threshold.eq(auto_tag_threshold),
                user_recognition_thresholds::suggest_threshold.eq(suggest_threshold),
                user_recognition_thresholds::total_accepts.eq(total_accepts),
                user_recognition_thresholds::total_rejects.eq(total_rejects),
                user_recognition_thresholds::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB upsert thresholds error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
