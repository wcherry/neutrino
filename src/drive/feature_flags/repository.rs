use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use crate::schema::feature_flags;
use crate::shared::ApiError;
use super::model::FeatureFlagRecord;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct FeatureFlagsRepository {
    pool: DbPool,
}

impl FeatureFlagsRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn list(&self) -> Result<Vec<FeatureFlagRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        feature_flags::table
            .select(FeatureFlagRecord::as_select())
            .order(feature_flags::key.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB feature_flags list error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update(&self, key: &str, enabled: bool) -> Result<FeatureFlagRecord, ApiError> {
        let mut conn = self.get_conn()?;

        let exists = feature_flags::table
            .filter(feature_flags::key.eq(key))
            .count()
            .get_result::<i64>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB feature_flags count error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        if exists == 0 {
            return Err(ApiError::not_found("Feature flag not found"));
        }

        let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        diesel::update(feature_flags::table.filter(feature_flags::key.eq(key)))
            .set((
                feature_flags::enabled.eq(enabled as i32),
                feature_flags::updated_at.eq(&now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB feature_flags update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        feature_flags::table
            .filter(feature_flags::key.eq(key))
            .select(FeatureFlagRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB feature_flags fetch after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })
    }
}
