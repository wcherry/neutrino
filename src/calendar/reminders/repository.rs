use crate::calendar::reminders::model::{NewReminderRecord, ReminderRecord, UpdateReminderRecord};
use crate::schema::reminders;
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct RemindersRepository {
    pool: DbPool,
}

impl RemindersRepository {
    pub fn new(pool: DbPool) -> Self {
        RemindersRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert(&self, record: NewReminderRecord) -> Result<ReminderRecord, ApiError> {
        let id = record.id.clone();
        let mut conn = self.get_conn()?;
        diesel::insert_into(reminders::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert reminder error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        reminders::table
            .filter(reminders::id.eq(&id))
            .select(ReminderRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after reminder insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_user(&self, user_id: &str) -> Result<Vec<ReminderRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        reminders::table
            .filter(reminders::user_id.eq(user_id))
            .order(reminders::due_time.asc())
            .select(ReminderRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list reminders error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_event(
        &self,
        user_id: &str,
        event_id: &str,
    ) -> Result<Vec<ReminderRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        reminders::table
            .filter(
                reminders::user_id
                    .eq(user_id)
                    .and(reminders::linked_event_id.eq(event_id)),
            )
            .order(reminders::due_time.asc())
            .select(ReminderRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list event reminders error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_id(&self, id: &str, user_id: &str) -> Result<ReminderRecord, ApiError> {
        let mut conn = self.get_conn()?;
        reminders::table
            .filter(reminders::id.eq(id).and(reminders::user_id.eq(user_id)))
            .select(ReminderRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Reminder not found"),
                _ => {
                    tracing::error!("DB get reminder error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update(
        &self,
        id: &str,
        user_id: &str,
        changes: UpdateReminderRecord,
    ) -> Result<ReminderRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::update(
            reminders::table.filter(reminders::id.eq(id).and(reminders::user_id.eq(user_id))),
        )
        .set(&changes)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update reminder error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Reminder not found"));
        }
        reminders::table
            .filter(reminders::id.eq(id))
            .select(ReminderRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get reminder after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            reminders::table.filter(reminders::id.eq(id).and(reminders::user_id.eq(user_id))),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete reminder error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Reminder not found"));
        }
        Ok(())
    }

    /// Returns all pending (non-completed, non-notified) reminders due on or before `cutoff`.
    /// Used by the reminder engine.
    pub fn find_due(&self, cutoff: NaiveDateTime) -> Result<Vec<ReminderRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        reminders::table
            .filter(
                reminders::due_time
                    .le(cutoff)
                    .and(reminders::completed.eq(false))
                    .and(reminders::notified_at.is_null()),
            )
            .select(ReminderRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB find due reminders error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Mark a reminder as notified (set notified_at).
    pub fn mark_notified(&self, id: &str, at: NaiveDateTime) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(reminders::table.filter(reminders::id.eq(id)))
            .set((
                reminders::notified_at.eq(Some(at)),
                reminders::updated_at.eq(at),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB mark reminder notified error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
