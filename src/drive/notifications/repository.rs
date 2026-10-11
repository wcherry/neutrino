#![allow(dead_code)]

use crate::drive::notifications::model::{NewNotification, Notification};
use crate::schema::{files, notifications, user_profiles, users};
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

    /// Where to email `user_id`, or `None` when they should not get one: the
    /// account is gone or disabled, or they turned "General" email off in
    /// Settings → Notifications. A user who never saved preferences has no
    /// profile row and gets the default, which is on.
    pub fn email_recipient(&self, user_id: &str) -> Result<Option<EmailRecipient>, ApiError> {
        let mut conn = self.get_conn()?;
        let found: Option<(String, String, Option<i32>)> = users::table
            .left_join(user_profiles::table)
            .filter(users::id.eq(user_id))
            .filter(users::deleted_at.is_null())
            .filter(users::disabled_at.is_null())
            .select((users::email, users::name, user_profiles::email_general.nullable()))
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB email recipient lookup error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(found.and_then(|(email, name, general)| {
            (general.unwrap_or(1) != 0).then_some(EmailRecipient { email, name })
        }))
    }

    pub fn user_name(&self, user_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        users::table
            .filter(users::id.eq(user_id))
            .select(users::name)
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB user name lookup error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// A file's name and MIME type, for wording the email and linking it.
    pub fn file_summary(&self, file_id: &str) -> Result<Option<(String, String)>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::id.eq(file_id))
            .select((files::name, files::mime_type))
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB file summary lookup error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}

pub struct EmailRecipient {
    pub email: String,
    pub name: String,
}
