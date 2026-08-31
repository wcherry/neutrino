//! Pruning file version history.
//!
//! Every version of a file — the live one included — is a full blob in that
//! file's directory, so history is the part of the store that grows without
//! anybody asking it to. This sweep is what bounds it, and the rules it
//! applies are not compiled in: they are read from
//! `version_retention_settings`, which an admin edits from the console.
//!
//! ## The two numbers
//!
//! `retention_days` (*d*) and `min_versions` (*n*) are read together and
//! neither wins outright. The newest *n* versions of a file are set aside
//! whatever their age; age then decides among what is left, and anything older
//! than *d* days goes. So a file edited constantly for a week keeps a week of
//! history, and a file last touched two years ago still has its last *n*
//! versions to go back to instead of nothing at all.
//!
//! Two kinds of version are never candidates, whatever the numbers say:
//!
//! - **The live version.** Its bytes are the file's current content, not a
//!   spare copy of them — `files.storage_path` points straight at it — so
//!   deleting it would empty the file. Under the old layout this could not
//!   arise, because the current content lived outside the history entirely.
//! - **Named versions.** Somebody deliberately marked those, which is the
//!   whole difference between them and an autosave; a retention window is
//!   about clearing what accumulated on its own.
//!
//! ## Why a sweep rather than pruning on write
//!
//! Same reasoning as the account purge next door: the work is re-derived from
//! the rows every pass, so a policy change applies to history that already
//! exists, and there is no queue entry to lose or to cancel. It also means the
//! console's numbers are the only copy of the rules.

use std::path::{Path, PathBuf};
use std::time::Duration;

use diesel::prelude::*;

use crate::{Conn, DbPool};

/// How often the sweep runs. The window is in days, so an hour of slack is
/// invisible, and a pass with nothing to do is three indexed queries.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(3600);

/// What the sweep falls back to if the settings row is missing — the same
/// numbers migration 118 seeds, so a lost row does not quietly mean "keep
/// nothing" or "keep everything".
const DEFAULT_RETENTION_DAYS: i32 = 30;
const DEFAULT_MIN_VERSIONS: i32 = 10;

diesel::table! {
    version_retention_settings (id) {
        id -> Text,
        enabled -> Bool,
        retention_days -> Integer,
        min_versions -> Integer,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    file_versions (id) {
        id -> Text,
        file_id -> Text,
        user_id -> Text,
        version_number -> Integer,
        size_bytes -> BigInt,
        storage_path -> Text,
        label -> Nullable<Text>,
        created_at -> Timestamp,
        is_named -> Bool,
    }
}

diesel::table! {
    files (id) {
        id -> Text,
        storage_path -> Text,
    }
}

/// The policy in force for one pass.
#[derive(Debug, Queryable)]
struct Policy {
    enabled: bool,
    retention_days: i32,
    min_versions: i32,
}

/// One candidate row, with everything needed to decide and to delete.
#[derive(Debug, Queryable)]
struct Version {
    id: String,
    file_id: String,
    version_number: i32,
    storage_path: String,
    created_at: chrono::NaiveDateTime,
    is_named: bool,
}

/// What one pass did, for logging and for the tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SweepReport {
    pub deleted: u64,
    pub bytes_freed: u64,
}

/// Runs one sweep over every file's history.
///
/// A file that fails is logged and skipped rather than aborting the pass: the
/// next hourly run tries it again, and one wedged file must not keep the rest
/// of the store growing.
pub fn sweep(pool: &DbPool, storage_root: &Path) -> Result<SweepReport, diesel::result::Error> {
    let mut report = SweepReport::default();

    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("version retention: could not get db connection: {e}");
            return Ok(report);
        }
    };

    let policy = read_policy(&mut conn)?;
    if !policy.enabled {
        return Ok(report);
    }

    let cutoff =
        chrono::Utc::now().naive_utc() - chrono::Duration::days(policy.retention_days as i64);

    // Ordered by file, then newest first, so one pass over the rows can count
    // off the protected `min_versions` per file without a query each. Every
    // row is loaded rather than only the old ones: a version *inside* the
    // window still counts against the floor, so the recent history has to be
    // seen to know how much protection the old history has left. Six columns
    // per version is the same order of magnitude as the `live` set below, and
    // both are bounded by the store's size rather than by its history.
    let candidates: Vec<Version> = file_versions::table
        .order((
            file_versions::file_id.asc(),
            file_versions::version_number.desc(),
        ))
        .select((
            file_versions::id,
            file_versions::file_id,
            file_versions::version_number,
            file_versions::storage_path,
            file_versions::created_at,
            file_versions::is_named,
        ))
        .load(&mut conn)?;

    // The keys the file rows point at: the live version of each file, which is
    // the file's content and never a candidate. Read as a set rather than
    // per-row so the whole decision below is in memory.
    let live: std::collections::HashSet<String> = files::table
        .filter(files::storage_path.ne(""))
        .select(files::storage_path)
        .load::<String>(&mut conn)?
        .into_iter()
        .collect();

    let mut current_file: Option<String> = None;
    let mut kept_for_file = 0i32;

    for version in candidates {
        if current_file.as_deref() != Some(version.file_id.as_str()) {
            current_file = Some(version.file_id.clone());
            kept_for_file = 0;
        }

        // The live version is the file's content. It is protected without
        // being counted against `min_versions`, so `n` means "n versions of
        // history" rather than "n-1 plus the file itself".
        if live.contains(&version.storage_path) {
            continue;
        }

        // Named versions are exempt, and are not counted against the floor
        // either — a file with n named versions would otherwise have no
        // protection left for the autosaves that make up its recent history.
        if version.is_named {
            continue;
        }

        if kept_for_file < policy.min_versions {
            kept_for_file += 1;
            continue;
        }

        if version.created_at >= cutoff {
            continue;
        }

        match delete_version(&mut conn, storage_root, &version) {
            Ok(bytes) => {
                report.deleted += 1;
                report.bytes_freed += bytes;
            }
            Err(e) => tracing::error!(
                file = %version.file_id,
                version = version.version_number,
                "version retention: delete failed, will retry next sweep: {e}",
            ),
        }
    }

    Ok(report)
}

/// Reads the policy, falling back to the seeded defaults if the row is gone.
fn read_policy(conn: &mut Conn) -> Result<Policy, diesel::result::Error> {
    let row: Option<Policy> = version_retention_settings::table
        .select((
            version_retention_settings::enabled,
            version_retention_settings::retention_days,
            version_retention_settings::min_versions,
        ))
        .first(conn)
        .optional()?;

    Ok(row.unwrap_or(Policy {
        enabled: true,
        retention_days: DEFAULT_RETENTION_DAYS,
        min_versions: DEFAULT_MIN_VERSIONS,
    }))
}

/// Removes one version's blob and then its row, returning the bytes freed.
///
/// Blob first, for the same reason the account purge takes that order: a crash
/// in between leaves a row pointing at bytes that are gone, which the next
/// sweep finds and finishes (the remove simply misses). The reverse order
/// loses the only record of which blob to delete, leaving it on disk forever
/// with nothing referencing it.
fn delete_version(
    conn: &mut Conn,
    storage_root: &Path,
    version: &Version,
) -> Result<u64, diesel::result::Error> {
    let mut freed = 0;

    if let Some(path) = safe_path(storage_root, &version.storage_path) {
        freed = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            // Already gone — a previous pass got as far as the blob.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => freed = 0,
            Err(e) => {
                tracing::warn!(path = %path.display(), "version retention: could not remove blob: {e}");
                freed = 0;
            }
        }
    }

    diesel::delete(file_versions::table.filter(file_versions::id.eq(&version.id)))
        .execute(conn)?;

    Ok(freed)
}

/// Resolves a stored key under the storage root, refusing anything that could
/// climb out of it.
///
/// The keys are written by the app and are `<user>/<file>/<version>` of UUIDs,
/// but this deletes files: a key that has been tampered with in the database
/// is refused rather than resolved.
fn safe_path(storage_root: &Path, key: &str) -> Option<PathBuf> {
    if key.is_empty() || key.contains("..") || key.starts_with('/') || key.contains('\\') {
        tracing::error!(key, "version retention: refusing a suspicious storage key");
        return None;
    }
    Some(storage_root.join(key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::ConnectionManager;
    use diesel::sql_types::{BigInt, Bool, Integer, Text, Timestamp};
    use diesel::sqlite::SqliteConnection;
    use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

    const MIGRATIONS: EmbeddedMigrations = embed_migrations!("../migrations");

    struct TestDb {
        pool: DbPool,
        dir: PathBuf,
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.dir).ok();
        }
    }

    fn make_test_db() -> TestDb {
        let dir = std::env::temp_dir().join(format!("neutrino-versions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let url = dir.join("test.db");
        let pool = diesel::r2d2::Pool::builder()
            .max_size(2)
            .connection_timeout(Duration::from_secs(5))
            .build(ConnectionManager::<SqliteConnection>::new(
                url.to_str().unwrap(),
            ))
            .expect("build pool");
        pool.get()
            .unwrap()
            .run_pending_migrations(MIGRATIONS)
            .expect("run migrations");
        TestDb { pool, dir }
    }

    fn set_policy(conn: &mut Conn, enabled: bool, days: i32, min: i32) {
        diesel::sql_query(
            "UPDATE version_retention_settings \
             SET enabled = ?, retention_days = ?, min_versions = ? WHERE id = 'default'",
        )
        .bind::<Bool, _>(enabled)
        .bind::<Integer, _>(days)
        .bind::<Integer, _>(min)
        .execute(conn)
        .expect("set policy");
    }

    /// The file row, with no content yet — versions are added after it and the
    /// live one is named by `set_current`, the same order the app writes in.
    fn insert_file(conn: &mut Conn, id: &str, user: &str) {
        let now = chrono::Utc::now().naive_utc();
        diesel::sql_query(
            "INSERT INTO files (id, user_id, name, size_bytes, mime_type, storage_path, created_at, updated_at) \
             VALUES (?, ?, 'f.txt', 1, 'text/plain', '', ?, ?)",
        )
        .bind::<Text, _>(id)
        .bind::<Text, _>(user)
        .bind::<Timestamp, _>(now)
        .bind::<Timestamp, _>(now)
        .execute(conn)
        .expect("insert file");
    }

    /// Point the file at one of its versions — that key is what makes it live.
    fn set_current(conn: &mut Conn, file_id: &str, key: &str) {
        diesel::sql_query("UPDATE files SET storage_path = ? WHERE id = ?")
            .bind::<Text, _>(key)
            .bind::<Text, _>(file_id)
            .execute(conn)
            .expect("set current version");
    }

    /// Writes a version row and the blob it points at, aged by `days_old`.
    fn insert_version(
        db: &TestDb,
        conn: &mut Conn,
        file_id: &str,
        user: &str,
        version_id: &str,
        number: i32,
        days_old: i64,
        is_named: bool,
    ) -> String {
        let key = format!("{user}/{file_id}/{version_id}");
        let path = db.dir.join(&key);
        std::fs::create_dir_all(path.parent().unwrap()).expect("version dir");
        std::fs::write(&path, b"1234567890").expect("write blob");

        let created = chrono::Utc::now().naive_utc() - chrono::Duration::days(days_old);
        diesel::sql_query(
            "INSERT INTO file_versions (id, file_id, user_id, version_number, size_bytes, storage_path, created_at, is_named) \
             VALUES (?, ?, ?, ?, 10, ?, ?, ?)",
        )
        .bind::<Text, _>(version_id)
        .bind::<Text, _>(file_id)
        .bind::<Text, _>(user)
        .bind::<Integer, _>(number)
        .bind::<Text, _>(&key)
        .bind::<Timestamp, _>(created)
        .bind::<Bool, _>(is_named)
        .execute(conn)
        .expect("insert version");

        key
    }

    fn remaining(conn: &mut Conn, file_id: &str) -> Vec<i32> {
        #[derive(diesel::QueryableByName)]
        struct Row {
            #[diesel(sql_type = Integer)]
            version_number: i32,
        }
        diesel::sql_query(
            "SELECT version_number FROM file_versions WHERE file_id = ? ORDER BY version_number",
        )
        .bind::<Text, _>(file_id)
        .load::<Row>(conn)
        .expect("load")
        .into_iter()
        .map(|r| r.version_number)
        .collect()
    }

    fn count_all(conn: &mut Conn) -> i64 {
        #[derive(diesel::QueryableByName)]
        struct Count {
            #[diesel(sql_type = BigInt)]
            n: i64,
        }
        diesel::sql_query("SELECT COUNT(*) AS n FROM file_versions")
            .load::<Count>(conn)
            .expect("count")[0]
            .n
    }

    /// The rule in one test: old versions go, but the newest `n` stay however
    /// old they are.
    #[test]
    fn old_versions_go_but_the_newest_n_are_kept() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        set_policy(&mut conn, true, 30, 2);

        // Six versions, all a year old. v6 is the live one.
        insert_file(&mut conn, "f1", "u1");
        let mut live = String::new();
        for n in 1..=6 {
            live = insert_version(&db, &mut conn, "f1", "u1", &format!("v{n}"), n, 365, false);
        }
        set_current(&mut conn, "f1", &live);

        let report = sweep(&db.pool, &db.dir).expect("sweep");

        // v6 is live, v5 and v4 are the two the floor protects; v1-v3 go.
        assert_eq!(remaining(&mut conn, "f1"), vec![4, 5, 6]);
        assert_eq!(report.deleted, 3);
        assert_eq!(report.bytes_freed, 30);
        assert!(!db.dir.join("u1/f1/v1").exists(), "blob left on disk");
        assert!(db.dir.join("u1/f1/v4").exists(), "protected blob deleted");
    }

    /// Age is the other half of the rule: a file whose history is all recent
    /// keeps every version, floor or no floor.
    #[test]
    fn versions_inside_the_window_are_kept() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        set_policy(&mut conn, true, 30, 1);

        insert_file(&mut conn, "f2", "u1");
        let mut live = String::new();
        for n in 1..=5 {
            live = insert_version(&db, &mut conn, "f2", "u1", &format!("w{n}"), n, 3, false);
        }
        set_current(&mut conn, "f2", &live);

        assert_eq!(sweep(&db.pool, &db.dir).expect("sweep"), SweepReport::default());
        assert_eq!(remaining(&mut conn, "f2"), vec![1, 2, 3, 4, 5]);
    }

    /// The live version is the file's content, so it survives a policy that
    /// would otherwise take everything.
    #[test]
    fn the_current_version_is_never_deleted() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        set_policy(&mut conn, true, 0, 0);

        insert_file(&mut conn, "f3", "u1");
        let old = insert_version(&db, &mut conn, "f3", "u1", "x1", 1, 100, false);
        let live = insert_version(&db, &mut conn, "f3", "u1", "x2", 2, 100, false);
        set_current(&mut conn, "f3", &live);

        sweep(&db.pool, &db.dir).expect("sweep");

        assert_eq!(remaining(&mut conn, "f3"), vec![2]);
        assert!(db.dir.join(&live).exists(), "the file's own content was deleted");
        assert!(!db.dir.join(&old).exists());
    }

    /// Somebody marked these deliberately; a window meant for autosave churn
    /// must not clear them.
    #[test]
    fn named_versions_survive_the_window() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        set_policy(&mut conn, true, 1, 0);

        insert_file(&mut conn, "f4", "u1");
        insert_version(&db, &mut conn, "f4", "u1", "n1", 1, 400, true);
        insert_version(&db, &mut conn, "f4", "u1", "n2", 2, 400, false);
        let live = insert_version(&db, &mut conn, "f4", "u1", "n3", 3, 400, false);
        set_current(&mut conn, "f4", &live);

        sweep(&db.pool, &db.dir).expect("sweep");

        assert_eq!(remaining(&mut conn, "f4"), vec![1, 3]);
    }

    /// Turning the policy off has to stop the sweep dead, not merely widen it.
    #[test]
    fn a_disabled_policy_deletes_nothing() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        set_policy(&mut conn, false, 0, 0);

        insert_file(&mut conn, "f5", "u1");
        insert_version(&db, &mut conn, "f5", "u1", "d1", 1, 400, false);
        let live = insert_version(&db, &mut conn, "f5", "u1", "d2", 2, 400, false);
        set_current(&mut conn, "f5", &live);

        assert_eq!(sweep(&db.pool, &db.dir).expect("sweep"), SweepReport::default());
        assert_eq!(count_all(&mut conn), 2);
    }

    /// The floor is counted per file, so a file with a long history cannot
    /// consume the protection owed to the next one.
    #[test]
    fn the_floor_is_counted_per_file() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        set_policy(&mut conn, true, 30, 1);

        for (file, prefix) in [("f6", "a"), ("f7", "b")] {
            insert_file(&mut conn, file, "u1");
            let mut live = String::new();
            for n in 1..=3 {
                live = insert_version(
                    &db,
                    &mut conn,
                    file,
                    "u1",
                    &format!("{prefix}{n}"),
                    n,
                    365,
                    false,
                );
            }
            set_current(&mut conn, file, &live);
        }

        sweep(&db.pool, &db.dir).expect("sweep");

        assert_eq!(remaining(&mut conn, "f6"), vec![2, 3]);
        assert_eq!(remaining(&mut conn, "f7"), vec![2, 3]);
    }

    #[test]
    fn suspicious_storage_keys_do_not_escape_the_root() {
        let root = std::env::temp_dir().join("neutrino-versions-traversal");
        let canary = root.join("keep-me");
        std::fs::create_dir_all(&canary).expect("canary");

        for key in ["", "..", "../keep-me", "a/../..", "a\\b", "/etc/passwd"] {
            assert!(safe_path(&root, key).is_none(), "{key} was resolved");
        }

        assert!(canary.exists());
        std::fs::remove_dir_all(&root).ok();
    }
}
