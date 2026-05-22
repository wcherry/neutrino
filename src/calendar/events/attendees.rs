use crate::shared::{ApiError, DbPool};
use crate::schema::event_attendees;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager};
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::event_attendees)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AttendeeRecord {
    pub id: String,
    pub event_id: String,
    pub email: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::event_attendees)]
pub struct NewAttendeeRecord {
    pub id: String,
    pub event_id: String,
    pub email: String,
}

pub struct AttendeesRepository {
    pool: DbPool,
}

impl AttendeesRepository {
    pub fn new(pool: DbPool) -> Self {
        AttendeesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn find_by_event(&self, event_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        event_attendees::table
            .filter(event_attendees::event_id.eq(event_id))
            .select(event_attendees::email)
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list attendees error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn replace_for_event(
        &self,
        event_id: &str,
        emails: &[String],
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(event_attendees::table.filter(event_attendees::event_id.eq(event_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete attendees error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        let records: Vec<NewAttendeeRecord> = emails
            .iter()
            .map(|email| NewAttendeeRecord {
                id: Uuid::new_v4().to_string(),
                event_id: event_id.to_string(),
                email: email.clone(),
            })
            .collect();
        if !records.is_empty() {
            diesel::insert_into(event_attendees::table)
                .values(&records)
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB insert attendees error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        }
        Ok(())
    }

    pub fn delete_for_event(&self, event_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(event_attendees::table.filter(event_attendees::event_id.eq(event_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete attendees for event error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
