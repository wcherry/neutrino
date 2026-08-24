#![allow(dead_code)]

use crate::drive::activity::model::NewActivityEntry;
use crate::schema::file_activity_log;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct ActivityRepository {
    pool: DbPool,
}

impl ActivityRepository {
    pub fn new(pool: DbPool) -> Self {
        ActivityRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_entry(&self, entry: &NewActivityEntry) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(file_activity_log::table)
            .values(entry)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert activity entry error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
