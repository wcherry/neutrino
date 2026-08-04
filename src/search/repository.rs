use crate::schema::search_index_snapshots;
use crate::search::model::{NewSearchSnapshotRecord, SearchSnapshotRecord};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// What an upload attempt did, so the service can turn it into a response or a
/// 409 without a second read.
#[derive(Debug)]
pub enum SnapshotWrite {
    Stored(SearchSnapshotRecord),
    /// The caller's `expected_version` no longer matches what is stored. Carries
    /// the current version so the client can re-pull and retry.
    Conflict {
        current_version: i32,
    },
}

/// One snapshot write. Grouped rather than passed as loose parameters because
/// half of them are `&str`/`Option` and transposing two at a call site would
/// compile.
pub struct SnapshotWriteInput<'a> {
    /// The version the caller believes is stored. `None` claims there is none.
    pub expected_version: Option<i32>,
    /// Skip the version check entirely.
    pub force: bool,
    pub size_bytes: i64,
    pub wrapped_key: &'a str,
    pub device_id: Option<&'a str>,
    pub updated_at: &'a str,
}

pub struct SearchSnapshotRepository {
    pool: DbPool,
}

impl SearchSnapshotRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool
            .get()
            .map_err(|_| ApiError::internal("DB connection unavailable"))
    }

    pub fn find(&self, user_id: &str) -> Result<Option<SearchSnapshotRecord>, ApiError> {
        let mut conn = self.conn()?;
        search_index_snapshots::table
            .filter(search_index_snapshots::user_id.eq(user_id))
            .select(SearchSnapshotRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("find search snapshot: {:?}", e);
                ApiError::internal("DB error")
            })
    }

    /// Store a snapshot's metadata, rejecting the write when the caller's
    /// `expected_version` is not what is currently stored.
    ///
    /// The version check is part of the `UPDATE`'s `WHERE` clause rather than a
    /// read followed by a write, so two devices uploading at the same moment
    /// cannot both see the same version and both win — SQLite serialises the
    /// statements and the loser matches zero rows.
    ///
    /// `expected_version` of `None` means "I believe nothing is stored yet", so
    /// it succeeds only when that is true. `force` skips the check entirely,
    /// which is the deliberate "my index is the good one, overwrite it" path.
    pub fn upsert(
        &self,
        user_id: &str,
        input: SnapshotWriteInput<'_>,
    ) -> Result<SnapshotWrite, ApiError> {
        let SnapshotWriteInput {
            expected_version,
            force,
            size_bytes,
            wrapped_key,
            device_id,
            updated_at,
        } = input;
        let mut conn = self.conn()?;

        let current: Option<i32> = search_index_snapshots::table
            .filter(search_index_snapshots::user_id.eq(user_id))
            .select(search_index_snapshots::version)
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("read search snapshot version: {:?}", e);
                ApiError::internal("DB error")
            })?;

        match current {
            None => {
                // Nothing stored. A caller that expected a version is working
                // from an index whose source snapshot has since been deleted.
                if !force && expected_version.is_some() {
                    return Err(ApiError::not_found("No snapshot stored"));
                }
                diesel::insert_into(search_index_snapshots::table)
                    .values(NewSearchSnapshotRecord {
                        user_id,
                        version: 1,
                        size_bytes,
                        wrapped_key,
                        device_id,
                        updated_at,
                    })
                    .execute(&mut conn)
                    .map_err(|e| {
                        tracing::error!("insert search snapshot: {:?}", e);
                        ApiError::internal("DB error")
                    })?;
            }
            Some(stored) => {
                // A first-upload claim against an existing row is as much a
                // conflict as a stale version: this device does not know about
                // the snapshot it is about to replace.
                if !force && expected_version != Some(stored) {
                    return Ok(SnapshotWrite::Conflict {
                        current_version: stored,
                    });
                }

                let mut update = diesel::update(search_index_snapshots::table)
                    .filter(search_index_snapshots::user_id.eq(user_id))
                    .into_boxed();
                if !force {
                    update = update.filter(search_index_snapshots::version.eq(stored));
                }

                let rows = update
                    .set((
                        search_index_snapshots::version.eq(stored + 1),
                        search_index_snapshots::size_bytes.eq(size_bytes),
                        search_index_snapshots::wrapped_key.eq(wrapped_key),
                        search_index_snapshots::device_id.eq(device_id),
                        search_index_snapshots::updated_at.eq(updated_at),
                    ))
                    .execute(&mut conn)
                    .map_err(|e| {
                        tracing::error!("update search snapshot: {:?}", e);
                        ApiError::internal("DB error")
                    })?;

                // Lost the race against a concurrent upload between the read
                // above and this statement.
                if rows == 0 {
                    let now = search_index_snapshots::table
                        .filter(search_index_snapshots::user_id.eq(user_id))
                        .select(search_index_snapshots::version)
                        .first(&mut conn)
                        .optional()
                        .map_err(|_| ApiError::internal("DB error"))?
                        .unwrap_or(stored);
                    return Ok(SnapshotWrite::Conflict {
                        current_version: now,
                    });
                }
            }
        }

        drop(conn);
        let stored = self
            .find(user_id)?
            .ok_or_else(|| ApiError::internal("Snapshot vanished after write"))?;
        Ok(SnapshotWrite::Stored(stored))
    }

    pub fn delete(&self, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::delete(
            search_index_snapshots::table.filter(search_index_snapshots::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("delete search snapshot: {:?}", e);
            ApiError::internal("DB error")
        })?;
        Ok(())
    }
}

/// In-memory pool with the schema applied. Shared with `service`'s tests so the
/// two suites cannot drift apart on how a test database is built.
#[cfg(test)]
pub(crate) fn test_pool() -> DbPool {
    use crate::MIGRATIONS;
    use diesel_migrations::MigrationHarness;

    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder()
        .max_size(1)
        .build(manager)
        .expect("test pool");
    pool.get()
        .expect("conn")
        .run_pending_migrations(MIGRATIONS)
        .expect("migrations");
    pool
}

/// `search_index_snapshots.user_id` is a real foreign key and SQLite enforces
/// it here, so a snapshot needs an owner before it can be inserted.
#[cfg(test)]
pub(crate) fn insert_test_user(pool: &DbPool, user_id: &str) {
    let mut conn = pool.get().expect("conn");
    diesel::sql_query(format!(
        "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
         VALUES ('{user_id}', '{user_id}@example.test', 'Test User', 'hash', \
         '2026-08-03 00:00:00', 'user', 0)"
    ))
    .execute(&mut conn)
    .expect("insert test user");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_with_user(user_id: &str) -> SearchSnapshotRepository {
        let pool = test_pool();
        insert_test_user(&pool, user_id);
        SearchSnapshotRepository::new(pool)
    }

    fn store(
        repo: &SearchSnapshotRepository,
        expected: Option<i32>,
        force: bool,
    ) -> Result<SnapshotWrite, ApiError> {
        repo.upsert(
            "user-1",
            SnapshotWriteInput {
                expected_version: expected,
                force,
                size_bytes: 128,
                wrapped_key: "wrapped",
                device_id: Some("device-a"),
                updated_at: "2026-08-03T00:00:00Z",
            },
        )
    }

    #[test]
    fn first_upload_starts_at_version_one() {
        let repo = repo_with_user("user-1");
        let written = store(&repo, None, false).expect("first upload");
        match written {
            SnapshotWrite::Stored(rec) => assert_eq!(rec.version, 1),
            SnapshotWrite::Conflict { .. } => panic!("first upload must not conflict"),
        }
    }

    #[test]
    fn matching_expected_version_bumps_by_one() {
        let repo = repo_with_user("user-1");
        store(&repo, None, false).expect("first upload");

        match store(&repo, Some(1), false).expect("second upload") {
            SnapshotWrite::Stored(rec) => assert_eq!(rec.version, 2),
            SnapshotWrite::Conflict { .. } => panic!("matching version must be accepted"),
        }
    }

    #[test]
    fn stale_expected_version_is_a_conflict_and_leaves_the_row_alone() {
        // The whole point of the token: a device that indexed against version 1
        // must not overwrite the version 2 another device has since uploaded.
        let repo = repo_with_user("user-1");
        store(&repo, None, false).expect("first upload");
        store(&repo, Some(1), false).expect("second upload");

        match store(&repo, Some(1), false).expect("stale upload") {
            SnapshotWrite::Conflict { current_version } => assert_eq!(current_version, 2),
            SnapshotWrite::Stored(_) => panic!("stale version must be rejected"),
        }

        let stored = repo.find("user-1").expect("find").expect("row");
        assert_eq!(stored.version, 2, "a rejected upload must not bump");
    }

    #[test]
    fn first_upload_claim_against_an_existing_row_is_a_conflict() {
        // `expected_version: None` means "I think there is nothing there". A
        // fresh device that skipped the pull would otherwise wipe the snapshot.
        let repo = repo_with_user("user-1");
        store(&repo, None, false).expect("first upload");

        match store(&repo, None, false).expect("second first-upload") {
            SnapshotWrite::Conflict { current_version } => assert_eq!(current_version, 1),
            SnapshotWrite::Stored(_) => panic!("must not clobber an existing snapshot"),
        }
    }

    #[test]
    fn force_overrides_a_stale_version() {
        let repo = repo_with_user("user-1");
        store(&repo, None, false).expect("first upload");
        store(&repo, Some(1), false).expect("second upload");

        match store(&repo, Some(1), true).expect("forced upload") {
            SnapshotWrite::Stored(rec) => assert_eq!(rec.version, 3),
            SnapshotWrite::Conflict { .. } => panic!("force must override the check"),
        }
    }

    #[test]
    fn expecting_a_version_when_nothing_is_stored_is_not_found() {
        let repo = repo_with_user("user-1");
        let err = store(&repo, Some(4), false).expect_err("no snapshot");
        assert_eq!(err.status, 404);
    }

    #[test]
    fn delete_removes_the_row_and_lets_the_next_upload_restart_at_one() {
        let repo = repo_with_user("user-1");
        store(&repo, None, false).expect("first upload");
        repo.delete("user-1").expect("delete");
        assert!(repo.find("user-1").expect("find").is_none());

        match store(&repo, None, false).expect("upload after delete") {
            SnapshotWrite::Stored(rec) => assert_eq!(rec.version, 1),
            SnapshotWrite::Conflict { .. } => panic!("row was deleted"),
        }
    }
}
