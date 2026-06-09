use crate::calendar::events::model::{EventRecord, NewEventRecord, UpdateEventRecord};
use crate::schema::events;
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct EventsRepository {
    pool: DbPool,
}

impl EventsRepository {
    pub fn new(pool: DbPool) -> Self {
        EventsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert(&self, record: NewEventRecord) -> Result<EventRecord, ApiError> {
        let id = record.id.clone();
        let mut conn = self.get_conn()?;
        diesel::insert_into(events::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert event error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        events::table
            .filter(events::id.eq(&id))
            .select(EventRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after event insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_user(
        &self,
        user_id: &str,
        from: Option<NaiveDateTime>,
        to: Option<NaiveDateTime>,
    ) -> Result<Vec<EventRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = events::table
            .filter(events::user_id.eq(user_id))
            .into_boxed();
        if let Some(f) = from {
            // Events that end at or after the range start, OR are recurring masters
            // (recurring masters have their start in the past but generate future occurrences)
            query = query.filter(
                events::end_time
                    .ge(f)
                    .or(events::recurrence_rule.is_not_null()),
            );
        }
        if let Some(t) = to {
            // Events that start at or before the range end
            query = query.filter(events::start_time.le(t));
        }
        query
            .order(events::start_time.asc())
            .select(EventRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list events error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_id(&self, id: &str, user_id: &str) -> Result<EventRecord, ApiError> {
        let mut conn = self.get_conn()?;
        events::table
            .filter(events::id.eq(id).and(events::user_id.eq(user_id)))
            .select(EventRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Event not found"),
                _ => {
                    tracing::error!("DB get event error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update(
        &self,
        id: &str,
        user_id: &str,
        changes: UpdateEventRecord,
    ) -> Result<EventRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::update(
            events::table.filter(events::id.eq(id).and(events::user_id.eq(user_id))),
        )
        .set(&changes)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update event error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Event not found"));
        }
        events::table
            .filter(events::id.eq(id))
            .select(EventRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get event after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            events::table.filter(events::id.eq(id).and(events::user_id.eq(user_id))),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete event error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Event not found"));
        }
        Ok(())
    }

    /// Insert-or-update an event coming from an external sync source.
    /// Lookup key is (user_id, source, external_id). If found, updates mutable fields;
    /// otherwise inserts a new row.
    pub fn upsert_from_sync(
        &self,
        user_id: &str,
        source: &str,
        record: NewEventRecord,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        let existing_id: Option<String> = events::table
            .filter(
                events::user_id
                    .eq(user_id)
                    .and(events::source.eq(source))
                    .and(events::external_id.eq(&record.external_id)),
            )
            .select(events::id)
            .first::<String>(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB upsert_from_sync lookup error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        if let Some(existing) = existing_id {
            let changes = UpdateEventRecord {
                title: Some(record.title),
                description: Some(record.description),
                start_time: Some(record.start_time),
                end_time: Some(record.end_time),
                all_day: Some(record.all_day),
                location: Some(record.location),
                recurrence_rule: Some(record.recurrence_rule),
                updated_at: record.updated_at,
                timezone: Some(record.timezone),
            };
            diesel::update(events::table.filter(events::id.eq(&existing)))
                .set(&changes)
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB upsert_from_sync update error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        } else {
            diesel::insert_into(events::table)
                .values(&record)
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB upsert_from_sync insert error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        }

        Ok(())
    }

    /// Delete an externally-sourced event by its external ID (used when the provider reports deletion).
    pub fn delete_by_external(
        &self,
        user_id: &str,
        source: &str,
        external_id: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            events::table.filter(
                events::user_id
                    .eq(user_id)
                    .and(events::source.eq(source))
                    .and(events::external_id.eq(external_id)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete_by_external error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }
}
