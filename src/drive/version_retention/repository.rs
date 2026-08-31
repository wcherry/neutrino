use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use super::model::VersionRetentionRecord;
use crate::schema::version_retention_settings as settings;
use crate::shared::ApiError;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// The id of the one row. The policy is workspace-wide, so there is nothing to
/// look it up by; a fixed key keeps a second policy from being created by
/// accident and lets the row be recreated if it is ever lost.
pub const POLICY_ID: &str = "default";

/// The policy a store falls back to when the row is missing — the same
/// numbers migration 118 seeds it with.
pub const DEFAULT_RETENTION_DAYS: i32 = 30;
pub const DEFAULT_MIN_VERSIONS: i32 = 10;

/// The bounds the API accepts. A negative window would make every version
/// eligible the moment it was written; `min_versions` of zero is allowed and
/// means "age alone decides", but the live version is never a candidate
/// whatever these say.
pub const MAX_RETENTION_DAYS: i32 = 36_500;
pub const MAX_MIN_VERSIONS: i32 = 1_000;

pub struct VersionRetentionRepository {
    pool: DbPool,
}

impl VersionRetentionRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Read the policy, seeding the row if it has gone missing.
    ///
    /// A store with no row would otherwise fail the admin page rather than
    /// showing the defaults the worker is already applying.
    pub fn get(&self) -> Result<VersionRetentionRecord, ApiError> {
        let mut conn = self.get_conn()?;

        let existing = settings::table
            .filter(settings::id.eq(POLICY_ID))
            .select(VersionRetentionRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB version retention read error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        if let Some(record) = existing {
            return Ok(record);
        }

        diesel::insert_into(settings::table)
            .values((
                settings::id.eq(POLICY_ID),
                settings::enabled.eq(true),
                settings::retention_days.eq(DEFAULT_RETENTION_DAYS),
                settings::min_versions.eq(DEFAULT_MIN_VERSIONS),
                settings::updated_at.eq(Utc::now().naive_utc()),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB version retention seed error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        settings::table
            .filter(settings::id.eq(POLICY_ID))
            .select(VersionRetentionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB version retention re-read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Write the policy. Fields left as `None` keep their current value, so
    /// the admin page can send only what changed.
    pub fn update(
        &self,
        enabled: Option<bool>,
        retention_days: Option<i32>,
        min_versions: Option<i32>,
    ) -> Result<VersionRetentionRecord, ApiError> {
        if let Some(days) = retention_days {
            if !(0..=MAX_RETENTION_DAYS).contains(&days) {
                return Err(ApiError::bad_request(format!(
                    "retentionDays must be between 0 and {MAX_RETENTION_DAYS}"
                )));
            }
        }
        if let Some(min) = min_versions {
            if !(0..=MAX_MIN_VERSIONS).contains(&min) {
                return Err(ApiError::bad_request(format!(
                    "minVersions must be between 0 and {MAX_MIN_VERSIONS}"
                )));
            }
        }

        // Seeds the row if it is missing, so an update never has nothing to
        // write to.
        let current = self.get()?;
        let mut conn = self.get_conn()?;

        diesel::update(settings::table.filter(settings::id.eq(POLICY_ID)))
            .set((
                settings::enabled.eq(enabled.unwrap_or(current.enabled)),
                settings::retention_days.eq(retention_days.unwrap_or(current.retention_days)),
                settings::min_versions.eq(min_versions.unwrap_or(current.min_versions)),
                settings::updated_at.eq(Utc::now().naive_utc()),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB version retention update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        settings::table
            .filter(settings::id.eq(POLICY_ID))
            .select(VersionRetentionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB version retention re-read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database error")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_repo() -> VersionRetentionRepository {
        use crate::MIGRATIONS;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        VersionRetentionRepository::new(pool)
    }

    #[test]
    fn the_seeded_policy_is_returned() {
        let policy = test_repo().get().expect("get");
        assert!(policy.enabled);
        assert_eq!(policy.retention_days, DEFAULT_RETENTION_DAYS);
        assert_eq!(policy.min_versions, DEFAULT_MIN_VERSIONS);
    }

    #[test]
    fn an_update_leaves_omitted_fields_alone() {
        let repo = test_repo();
        let updated = repo.update(None, Some(90), None).expect("update");
        assert_eq!(updated.retention_days, 90);
        assert_eq!(updated.min_versions, DEFAULT_MIN_VERSIONS);
        assert!(updated.enabled);
    }

    /// A negative window would make every version older than "now minus a
    /// negative number", i.e. eligible the instant it was written.
    #[test]
    fn out_of_range_values_are_refused() {
        let repo = test_repo();
        assert!(repo.update(None, Some(-1), None).is_err());
        assert!(repo.update(None, None, Some(-1)).is_err());
        assert!(repo.update(None, Some(MAX_RETENTION_DAYS + 1), None).is_err());
        assert_eq!(
            repo.get().expect("get").retention_days,
            DEFAULT_RETENTION_DAYS,
            "a refused update must not have written anything",
        );
    }
}
