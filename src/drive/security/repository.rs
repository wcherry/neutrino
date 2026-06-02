#![allow(dead_code)]

use crate::shared::ApiError;
use crate::schema::{ransomware_events, siem_configs};
use crate::drive::security::model::{NewRansomwareEvent, NewSiemConfig, RansomwareEvent, SiemConfig};
use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct SecurityRepository {
    pool: DbPool,
}

impl SecurityRepository {
    pub fn new(pool: DbPool) -> Self {
        SecurityRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn create_ransomware_event(&self, event: NewRansomwareEvent) -> Result<RansomwareEvent, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(ransomware_events::table)
            .values(&event)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert ransomware event error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        ransomware_events::table
            .filter(ransomware_events::id.eq(event.id))
            .select(RansomwareEvent::as_select())
            .first(&mut conn)
            .map_err(|_| ApiError::internal("Database error"))
    }

    pub fn list_ransomware_events(&self) -> Result<Vec<RansomwareEvent>, ApiError> {
        let mut conn = self.get_conn()?;
        ransomware_events::table
            .order(ransomware_events::triggered_at.desc())
            .select(RansomwareEvent::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list ransomware events error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn resolve_ransomware_event(&self, id: &str, resolved_by: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();
        diesel::update(ransomware_events::table.filter(ransomware_events::id.eq(id)))
            .set((
                ransomware_events::reviewed_at.eq(now),
                ransomware_events::reviewed_by.eq(resolved_by),
                ransomware_events::status.eq("resolved"),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB resolve ransomware event error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn create_siem_config(&self, config: NewSiemConfig) -> Result<SiemConfig, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(siem_configs::table)
            .values(&config)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert siem config error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        siem_configs::table
            .filter(siem_configs::id.eq(config.id))
            .select(SiemConfig::as_select())
            .first(&mut conn)
            .map_err(|_| ApiError::internal("Database error"))
    }

    pub fn list_siem_configs(&self) -> Result<Vec<SiemConfig>, ApiError> {
        let mut conn = self.get_conn()?;
        siem_configs::table
            .order(siem_configs::created_at.desc())
            .select(SiemConfig::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list siem configs error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_siem_config(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(siem_configs::table.filter(siem_configs::id.eq(id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete siem config error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
