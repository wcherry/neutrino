//! Server-side reads of a feature flag.
//!
//! The web client reads the public flag map and decides what to render, but a flag that only gates
//! rendering is not a kill switch — the routes are still there and still answer. Team Spaces
//! replaces a primary navigation entry and writes to four tables, so its gate has to hold on the
//! server too, and this is where the team module asks.
//!
//! A gated route that is off answers **404, not 403**. 403 says "this exists and you may not have
//! it", which is a different and wrong statement: with the flag off the feature does not exist on
//! this deployment at all, and saying otherwise leaks a roadmap to anyone who probes the routes.

use std::sync::Arc;

use super::repository::FeatureFlagsRepository;
use crate::shared::ApiError;

#[derive(Clone)]
pub struct FeatureGate {
    repo: Arc<FeatureFlagsRepository>,
}

impl FeatureGate {
    pub fn new(repo: Arc<FeatureFlagsRepository>) -> Self {
        Self { repo }
    }

    pub fn is_enabled(&self, key: &str) -> Result<bool, ApiError> {
        self.repo.is_enabled(key)
    }

    /// Pass when `key` is on; otherwise fail the request as though the route did not exist.
    ///
    /// Read on each call rather than cached at startup. That is the whole reason these flags are
    /// rows and not environment variables: an admin toggling one in the panel takes effect on the
    /// next request, with no redeploy. The read is a primary-key lookup on a table with single
    /// digits of rows.
    pub fn require(&self, key: &str) -> Result<(), ApiError> {
        if self.is_enabled(key)? {
            Ok(())
        } else {
            Err(ApiError::not_found("Not found"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive::feature_flags::repository::DbPool;
    use diesel::r2d2::ConnectionManager;
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;

    fn gate() -> (FeatureGate, Arc<FeatureFlagsRepository>) {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool: DbPool = diesel::r2d2::Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        let repo = Arc::new(FeatureFlagsRepository::new(pool));
        (FeatureGate::new(repo.clone()), repo)
    }

    #[test]
    fn seeded_team_spaces_flag_is_off_by_default() {
        assert!(!gate().0.is_enabled("teamSpaces").expect("read"));
    }

    #[test]
    fn require_on_a_disabled_flag_reads_as_not_found() {
        let err = gate().0.require("teamSpaces").expect_err("should be gated");
        assert_eq!(err.status, 404);
    }

    /// An unknown key is off, not an error — a gate's safe answer is "no".
    #[test]
    fn unknown_flag_is_off() {
        assert!(!gate().0.is_enabled("noSuchFlag").expect("read"));
    }

    #[test]
    fn require_passes_once_the_flag_is_on() {
        let (g, repo) = gate();
        repo.update("teamSpaces", true).expect("enable");
        assert!(g.require("teamSpaces").is_ok());
    }
}
