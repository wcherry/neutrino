use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use super::catalog;
use super::model::FeatureFlagRecord;
use crate::schema::feature_flags;
use crate::shared::ApiError;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct FeatureFlagsRepository {
    pool: DbPool,
}

impl FeatureFlagsRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Every flag row, reconciled against [`catalog::DECLARED_FLAGS`].
    ///
    /// A declared key with no row is an error rather than an omission from the map. Returning the
    /// map without it is what made four keys permanently, untoggleably off last time: the client
    /// reads a missing key as `undefined`, `undefined` is falsy, and a feature nobody had disabled
    /// renders as disabled forever. Failing the request instead makes the gap loud on the first
    /// read after a deploy, and names the key that is missing so the fix is the missing migration
    /// rather than an investigation.
    pub fn list(&self) -> Result<Vec<FeatureFlagRecord>, ApiError> {
        let rows = self.list_unchecked()?;

        let present: Vec<String> = rows.iter().map(|r| r.key.clone()).collect();
        let missing = catalog::missing_keys(&present);
        if !missing.is_empty() {
            tracing::error!(
                "feature_flags is missing rows for declared keys: {}. \
                 Every key in src/drive/feature_flags/catalog.rs needs a row seeded by a migration.",
                missing.join(", ")
            );
            return Err(ApiError::internal(format!(
                "Feature flags are misconfigured: no row for {}",
                missing.join(", ")
            )));
        }

        Ok(rows)
    }

    /// The rows as they are, with no reconciliation.
    ///
    /// Only for the admin list, which is the surface an operator uses to *diagnose* a misconfigured
    /// table — refusing to show it because it is misconfigured would hide the evidence.
    pub fn list_unchecked(&self) -> Result<Vec<FeatureFlagRecord>, ApiError> {
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

    /// Whether one flag is on, for a server-side gate.
    ///
    /// A key with no row reads as off rather than as an error. This is the one place that
    /// distinction is deliberate: a gate's job is to keep a feature dark, and the safe answer to
    /// "is this on?" when the table cannot say is no. `list` is where the gap is reported.
    pub fn is_enabled(&self, key: &str) -> Result<bool, ApiError> {
        let mut conn = self.get_conn()?;
        let enabled: Option<i32> = feature_flags::table
            .filter(feature_flags::key.eq(key))
            .select(feature_flags::enabled)
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB feature_flags read error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(enabled.unwrap_or(0) != 0)
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
