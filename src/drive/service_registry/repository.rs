use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use crate::shared::ApiError;
use crate::schema::service_registrations;
use super::model::{NewServiceRegistration, ServiceRegistrationRecord};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct ServiceRegistrationRepository {
    pool: DbPool,
}

impl ServiceRegistrationRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Upsert a service registration. If the record already exists and
    /// `auto_update` is true, updates endpoint/version/health_check_url and
    /// registered_at. If `auto_update` is false, only refreshes registered_at
    /// so drive knows the service is still alive.
    pub fn upsert(
        &self,
        name: &str,
        endpoint: &str,
        version: &str,
        health_check_url: &str,
    ) -> Result<ServiceRegistrationRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        let existing = service_registrations::table
            .filter(service_registrations::name.eq(name))
            .select(ServiceRegistrationRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB service_registrations lookup error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        match existing {
            None => {
                let new_rec = NewServiceRegistration {
                    name,
                    endpoint,
                    version,
                    health_check_url,
                    registered_at: now,
                    enabled: 1,
                    auto_update: 1,
                };
                diesel::insert_into(service_registrations::table)
                    .values(&new_rec)
                    .execute(&mut conn)
                    .map_err(|e| {
                        tracing::error!("DB service_registrations insert error: {:?}", e);
                        ApiError::internal("Database error")
                    })?;
            }
            Some(ref rec) if rec.auto_update != 0 => {
                diesel::update(
                    service_registrations::table
                        .filter(service_registrations::name.eq(name)),
                )
                .set((
                    service_registrations::endpoint.eq(endpoint),
                    service_registrations::version.eq(version),
                    service_registrations::health_check_url.eq(health_check_url),
                    service_registrations::registered_at.eq(now),
                ))
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB service_registrations update error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
            }
            Some(_) => {
                // auto_update is disabled — only refresh the heartbeat timestamp.
                diesel::update(
                    service_registrations::table
                        .filter(service_registrations::name.eq(name)),
                )
                .set(service_registrations::registered_at.eq(now))
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB service_registrations heartbeat update error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
            }
        }

        service_registrations::table
            .filter(service_registrations::name.eq(name))
            .select(ServiceRegistrationRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB service_registrations fetch error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list(&self) -> Result<Vec<ServiceRegistrationRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        service_registrations::table
            .select(ServiceRegistrationRecord::as_select())
            .order(service_registrations::name.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB service_registrations list error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_flags(
        &self,
        name: &str,
        enabled: Option<bool>,
        auto_update: Option<bool>,
    ) -> Result<ServiceRegistrationRecord, ApiError> {
        let mut conn = self.get_conn()?;

        let exists = service_registrations::table
            .filter(service_registrations::name.eq(name))
            .count()
            .get_result::<i64>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB service_registrations count error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        if exists == 0 {
            return Err(ApiError::not_found("Service not found"));
        }

        if let Some(v) = enabled {
            diesel::update(
                service_registrations::table
                    .filter(service_registrations::name.eq(name)),
            )
            .set(service_registrations::enabled.eq(v as i32))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB service_registrations update enabled error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        }

        if let Some(v) = auto_update {
            diesel::update(
                service_registrations::table
                    .filter(service_registrations::name.eq(name)),
            )
            .set(service_registrations::auto_update.eq(v as i32))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB service_registrations update auto_update error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        }

        service_registrations::table
            .filter(service_registrations::name.eq(name))
            .select(ServiceRegistrationRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB service_registrations fetch after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError>
    {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })
    }
}
