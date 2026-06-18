#![allow(dead_code)]

use crate::drive::notifications::model::{NewNotification, Notification};
use crate::schema::notifications;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct NotificationsRepository {
    pool: DbPool,
}

impl NotificationsRepository {
    pub fn new(pool: DbPool) -> Self {
        NotificationsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_notification(&self, new_notif: &NewNotification) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(notifications::table)
            .values(new_notif)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert notification error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn list_notifications(
        &self,
        recipient_id: &str,
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<Notification>, i64, i64), ApiError> {
        let mut conn = self.get_conn()?;
        let offset = (page - 1) * page_size;

        let items: Vec<Notification> = notifications::table
            .filter(notifications::recipient_id.eq(recipient_id))
            .order(notifications::created_at.desc())
            .limit(page_size)
            .offset(offset)
            .select(Notification::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list notifications error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let total: i64 = notifications::table
            .filter(notifications::recipient_id.eq(recipient_id))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count notifications error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let unread_count: i64 = notifications::table
            .filter(notifications::recipient_id.eq(recipient_id))
            .filter(notifications::is_read.eq(0))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count unread notifications error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok((items, total, unread_count))
    }

    pub fn mark_read(&self, id: &str, recipient_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(
            notifications::table
                .filter(notifications::id.eq(id))
                .filter(notifications::recipient_id.eq(recipient_id)),
        )
        .set(notifications::is_read.eq(1))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB mark notification read error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn mark_all_read(&self, recipient_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(
            notifications::table
                .filter(notifications::recipient_id.eq(recipient_id))
                .filter(notifications::is_read.eq(0)),
        )
        .set(notifications::is_read.eq(1))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB mark all notifications read error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn mark_email_sent(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(notifications::table.filter(notifications::id.eq(id)))
            .set(notifications::email_sent.eq(1))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB mark email sent error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
