//! Moving an existing store onto the one-directory-per-file layout.
//!
//! Before migration 118 a file's bytes lived at `<user>/<file>` and its
//! history under `<user>/versions/<file>/<version>`. Every upload wrote its
//! content out twice — once as the file, once as version 1 — and every named
//! save did the same, so a store cost roughly double what its file rows said.
//! The layout this converts to is a single directory per file,
//! `<user>/<file>/<version>`, holding the current version *and* the past ones,
//! with `files.storage_path` naming whichever is live.
//!
//! ## Why this runs in the app rather than in the migration
//!
//! The rows and the blobs have to move together, and a `.sql` file can only do
//! half of it. So the SQL migration creates the settings table and this pass —
//! run once at boot, before the server accepts a request — does the rest.
//!
//! It is **derived, not marked**: a file is on the old layout if its
//! `storage_path` is `<user>/<file>`, two segments where the new one has
//! three. Nothing records that the pass has run, so a database restored from
//! an older backup is converted the next time the app starts, and a store
//! already converted costs one indexed query. Every step is idempotent for the
//! same reason — a crash halfway is resumed rather than repaired.
//!
//! ## Duplicate content is reclaimed, not carried over
//!
//! For most files the newest snapshot is byte-for-byte the current content, so
//! moving both across would preserve the very duplication this exists to end.
//! Where the two match, the current content is dropped and the file is pointed
//! at the snapshot that already holds those bytes. Where they differ — a file
//! autosaved since its last snapshot — the live bytes become a new newest
//! version, because losing them is not an option and guessing they are stale
//! would silently roll the file back.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use diesel::prelude::*;
use uuid::Uuid;

use super::repository::DbPool;
use super::store::LocalFileStore;
use crate::schema::{file_versions, files};

/// Name the current content is parked under while its directory is created.
///
/// Deliberately not the `tmp_` staging prefix: the temp sweep deletes anything
/// carrying that, and this is the only copy of a file's content for the moment
/// it exists. A crash leaves the file here, and the next boot picks it up.
const PARKED_PREFIX: &str = ".migrating-";

/// What one pass did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct LayoutReport {
    /// Files moved onto the new layout.
    pub files: u64,
    /// Version blobs relocated into their file's directory.
    pub versions: u64,
    /// Bytes freed by dropping current content that a snapshot already held.
    pub bytes_reclaimed: u64,
    /// Files that could not be converted and were left as they were.
    pub failed: u64,
}

/// A file still on the pre-118 layout.
#[derive(Debug, Queryable)]
struct LegacyFile {
    id: String,
    user_id: String,
    storage_path: String,
    size_bytes: i64,
}

/// Convert every file still on the old layout. Never fails the boot: a file
/// that cannot be moved is logged and left exactly as it was, which keeps it
/// readable — `resolve` works off the stored key either way.
pub fn migrate_to_file_directories(pool: &DbPool, store: &LocalFileStore) -> LayoutReport {
    let mut report = LayoutReport::default();

    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("storage layout: could not get db connection: {e}");
            return report;
        }
    };

    // Two segments means `<user>/<file>`; the new keys have three. An empty
    // key is a record whose content never landed and has nothing to move.
    let legacy: Vec<LegacyFile> = match files::table
        .filter(files::storage_path.ne(""))
        .filter(files::storage_path.not_like("%/%/%"))
        .select((
            files::id,
            files::user_id,
            files::storage_path,
            files::size_bytes,
        ))
        .load(&mut conn)
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("storage layout: could not list files: {e}");
            return report;
        }
    };

    if legacy.is_empty() {
        return report;
    }

    tracing::info!(
        "storage layout: converting {} file(s) to the one-directory layout",
        legacy.len(),
    );

    for file in legacy {
        match migrate_one(&mut conn, store, &file) {
            Ok(one) => {
                report.files += 1;
                report.versions += one.versions;
                report.bytes_reclaimed += one.bytes_reclaimed;
            }
            Err(e) => {
                report.failed += 1;
                tracing::error!(file = %file.id, "storage layout: conversion failed: {e}");
            }
        }
    }

    prune_empty_version_dirs(store, &mut conn);

    tracing::info!(
        files = report.files,
        versions = report.versions,
        bytes_reclaimed = report.bytes_reclaimed,
        failed = report.failed,
        "storage layout: conversion complete",
    );

    report
}

#[derive(Default)]
struct OneFile {
    versions: u64,
    bytes_reclaimed: u64,
}

fn migrate_one(
    conn: &mut SqliteConnection,
    store: &LocalFileStore,
    file: &LegacyFile,
) -> Result<OneFile, String> {
    let mut done = OneFile::default();

    let legacy_blob = store.resolve(&file.storage_path);
    let parked = parked_path(store, &file.user_id, &file.id);

    // Park the current content first: its path is about to become the
    // directory that holds it. A parked file already here is a previous run
    // that stopped partway, and is picked up from where it left off.
    if legacy_blob.is_file() {
        fs::rename(&legacy_blob, &parked).map_err(|e| format!("parking current content: {e}"))?;
    }

    store
        .ensure_file_dir(&file.user_id, &file.id)
        .map_err(|e| e.to_string())?;

    // Move the snapshots in, oldest first so the newest ends up as the one to
    // compare the live content against.
    let versions: Vec<(String, String, i64, i32)> = file_versions::table
        .filter(file_versions::file_id.eq(&file.id))
        .order(file_versions::version_number.asc())
        .select((
            file_versions::id,
            file_versions::storage_path,
            file_versions::size_bytes,
            file_versions::version_number,
        ))
        .load(conn)
        .map_err(|e| format!("listing versions: {e}"))?;

    let mut newest: Option<(String, i64)> = None;
    for (version_id, old_key, size_bytes, _) in versions {
        let new_key = store.version_key(&file.user_id, &file.id, &version_id);
        let new_path = store.resolve(&new_key);

        if old_key != new_key {
            let old_path = store.resolve(&old_key);
            if old_path.is_file() {
                fs::rename(&old_path, &new_path)
                    .map_err(|e| format!("moving version {version_id}: {e}"))?;
                done.versions += 1;
            }
            diesel::update(file_versions::table.filter(file_versions::id.eq(&version_id)))
                .set(file_versions::storage_path.eq(&new_key))
                .execute(conn)
                .map_err(|e| format!("repointing version {version_id}: {e}"))?;
        }

        // A row whose blob never made it is not a candidate to point the file
        // at — that would swap real content for a missing one.
        if new_path.is_file() {
            newest = Some((new_key, size_bytes));
        }
    }

    // Decide what becomes of the parked current content.
    if parked.is_file() {
        match &newest {
            // The common case: the newest snapshot is a copy of the live
            // content, so the copy is all that is kept.
            Some((key, _)) if same_bytes(&parked, &store.resolve(key)) => {
                let freed = fs::metadata(&parked).map(|m| m.len()).unwrap_or(0);
                fs::remove_file(&parked).map_err(|e| format!("dropping duplicate: {e}"))?;
                done.bytes_reclaimed += freed;
            }
            // Edited since the last snapshot, or never snapshotted at all:
            // the live bytes become the newest version.
            _ => {
                let version_id = Uuid::new_v4().to_string();
                let key = store.version_key(&file.user_id, &file.id, &version_id);
                let size = fs::metadata(&parked)
                    .map(|m| m.len() as i64)
                    .unwrap_or(file.size_bytes);
                fs::rename(&parked, store.resolve(&key))
                    .map_err(|e| format!("filing current content: {e}"))?;
                insert_version(conn, &version_id, file, &key, size)?;
                done.versions += 1;
                newest = Some((key, size));
            }
        }
    }

    if let Some((key, size)) = newest {
        diesel::update(files::table.filter(files::id.eq(&file.id)))
            .set((
                files::storage_path.eq(&key),
                files::size_bytes.eq(size),
            ))
            .execute(conn)
            .map_err(|e| format!("repointing file: {e}"))?;
    } else {
        // Nothing on disk under either layout. The key is left alone rather
        // than blanked, so the orphan stays visible to an operator.
        tracing::warn!(file = %file.id, "storage layout: no content found to convert");
    }

    // The file's own slot under the old `versions/` tree, if it had one.
    let _ = fs::remove_dir(
        store
            .resolve(&format!("{}/versions", file.user_id))
            .join(&file.id),
    );

    Ok(done)
}

/// Add the version row for content that was only ever a file before.
///
/// `version_number` is assigned here rather than through
/// `StorageRepository::insert_version` because the number has to come out
/// above the snapshots just moved, and this runs before the server is
/// listening — there is no concurrent writer to race with.
fn insert_version(
    conn: &mut SqliteConnection,
    version_id: &str,
    file: &LegacyFile,
    key: &str,
    size_bytes: i64,
) -> Result<(), String> {
    let next: i32 = file_versions::table
        .filter(file_versions::file_id.eq(&file.id))
        .select(diesel::dsl::max(file_versions::version_number))
        .first::<Option<i32>>(conn)
        .map_err(|e| format!("reading version numbers: {e}"))?
        .unwrap_or(0)
        + 1;

    diesel::insert_into(file_versions::table)
        .values((
            file_versions::id.eq(version_id),
            file_versions::file_id.eq(&file.id),
            file_versions::user_id.eq(&file.user_id),
            file_versions::version_number.eq(next),
            file_versions::size_bytes.eq(size_bytes),
            file_versions::storage_path.eq(key),
            file_versions::is_named.eq(false),
        ))
        .execute(conn)
        .map_err(|e| format!("recording current content as a version: {e}"))?;

    Ok(())
}

fn parked_path(store: &LocalFileStore, user_id: &str, file_id: &str) -> PathBuf {
    store.file_path(user_id, &format!("{PARKED_PREFIX}{file_id}"))
}

/// Remove the now-empty `<user>/versions` directories.
///
/// `remove_dir` rather than `remove_dir_all`: anything still in there is a
/// blob the conversion did not account for, and it is worth leaving on disk
/// for an operator to look at rather than deleting on the way past.
fn prune_empty_version_dirs(store: &LocalFileStore, conn: &mut SqliteConnection) {
    let users: Vec<String> = match files::table
        .select(files::user_id)
        .distinct()
        .load(conn)
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!("storage layout: could not list users to tidy up: {e}");
            return;
        }
    };

    for user_id in users {
        let _ = fs::remove_dir(store.resolve(&format!("{user_id}/versions")));
    }
}

/// Whether two files hold identical bytes.
///
/// Streamed rather than read whole: this runs over every file in the store at
/// boot, and some of them are large. A read error answers "not the same",
/// which routes the caller down the keep-both branch — the safe direction,
/// since the alternative is deleting content on the strength of a comparison
/// that did not happen.
fn same_bytes(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (fs::metadata(a), fs::metadata(b)) else {
        return false;
    };
    if ma.len() != mb.len() {
        return false;
    }

    let (Ok(mut fa), Ok(mut fb)) = (fs::File::open(a), fs::File::open(b)) else {
        return false;
    };
    let mut buf_a = vec![0u8; 64 * 1024];
    let mut buf_b = vec![0u8; 64 * 1024];
    loop {
        let read_a = match fa.read(&mut buf_a) {
            Ok(n) => n,
            Err(_) => return false,
        };
        if read_a == 0 {
            return true;
        }
        let mut filled = 0;
        while filled < read_a {
            match fb.read(&mut buf_b[filled..read_a]) {
                Ok(0) => return false,
                Ok(n) => filled += n,
                Err(_) => return false,
            }
        }
        if buf_a[..read_a] != buf_b[..read_a] {
            return false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("neutrino_layout_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn insert_file(conn: &mut SqliteConnection, id: &str, user: &str, key: &str, size: i64) {
        let now = chrono::Utc::now().naive_utc();
        diesel::insert_into(files::table)
            .values((
                files::id.eq(id),
                files::user_id.eq(user),
                files::name.eq("f.txt"),
                files::size_bytes.eq(size),
                files::mime_type.eq("text/plain"),
                files::storage_path.eq(key),
                files::created_at.eq(now),
                files::updated_at.eq(now),
            ))
            .execute(conn)
            .expect("insert file");
    }

    fn insert_legacy_version(
        conn: &mut SqliteConnection,
        id: &str,
        file_id: &str,
        user: &str,
        number: i32,
        size: i64,
    ) {
        diesel::insert_into(file_versions::table)
            .values((
                file_versions::id.eq(id),
                file_versions::file_id.eq(file_id),
                file_versions::user_id.eq(user),
                file_versions::version_number.eq(number),
                file_versions::size_bytes.eq(size),
                file_versions::storage_path.eq(format!("{user}/versions/{file_id}/{id}")),
                file_versions::is_named.eq(false),
            ))
            .execute(conn)
            .expect("insert version");
    }

    fn key_of(conn: &mut SqliteConnection, file_id: &str) -> String {
        files::table
            .filter(files::id.eq(file_id))
            .select(files::storage_path)
            .first(conn)
            .expect("file key")
    }

    /// The case that motivates the whole change: content stored twice, once as
    /// the file and once as its identical v1 snapshot. One copy survives.
    #[test]
    fn duplicate_current_content_is_reclaimed() {
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let pool = test_pool();
        let mut conn = pool.get().expect("conn");

        insert_file(&mut conn, "file-1", "user-1", "user-1/file-1", 7);
        insert_legacy_version(&mut conn, "ver-1", "file-1", "user-1", 1, 7);
        fs::create_dir_all(base.join("user-1/versions/file-1")).expect("dirs");
        fs::write(base.join("user-1/file-1"), b"content").expect("write file");
        fs::write(base.join("user-1/versions/file-1/ver-1"), b"content").expect("write version");
        drop(conn);

        let report = migrate_to_file_directories(&pool, &store);

        assert_eq!(report.files, 1);
        assert_eq!(report.bytes_reclaimed, 7, "the duplicate copy was kept");

        let mut conn = pool.get().expect("conn");
        assert_eq!(key_of(&mut conn, "file-1"), "user-1/file-1/ver-1");
        assert_eq!(
            fs::read(base.join("user-1/file-1/ver-1")).expect("read"),
            b"content",
        );
        assert!(!base.join("user-1/versions").exists(), "old tree left behind");
        fs::remove_dir_all(base).ok();
    }

    /// Content autosaved since the last snapshot differs from it, and must
    /// survive as the newest version rather than being dropped as a duplicate.
    #[test]
    fn diverged_current_content_becomes_the_newest_version() {
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let pool = test_pool();
        let mut conn = pool.get().expect("conn");

        insert_file(&mut conn, "file-2", "user-1", "user-1/file-2", 5);
        insert_legacy_version(&mut conn, "ver-2", "file-2", "user-1", 1, 3);
        fs::create_dir_all(base.join("user-1/versions/file-2")).expect("dirs");
        fs::write(base.join("user-1/file-2"), b"newer").expect("write file");
        fs::write(base.join("user-1/versions/file-2/ver-2"), b"old").expect("write version");
        drop(conn);

        migrate_to_file_directories(&pool, &store);

        let mut conn = pool.get().expect("conn");
        let key = key_of(&mut conn, "file-2");
        assert_eq!(fs::read(base.join(&key)).expect("read"), b"newer");

        // Both versions are in the one directory, and the older one is intact.
        let count: i64 = file_versions::table
            .filter(file_versions::file_id.eq("file-2"))
            .count()
            .get_result(&mut conn)
            .expect("count");
        assert_eq!(count, 2);
        assert_eq!(
            fs::read(base.join("user-1/file-2/ver-2")).expect("read"),
            b"old",
        );
        fs::remove_dir_all(base).ok();
    }

    /// A second boot must be a no-op, not a second conversion — the pass has
    /// no marker and re-derives its work from the stored keys every time.
    #[test]
    fn a_converted_store_is_left_alone() {
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let pool = test_pool();
        let mut conn = pool.get().expect("conn");

        insert_file(&mut conn, "file-3", "user-1", "user-1/file-3", 7);
        insert_legacy_version(&mut conn, "ver-3", "file-3", "user-1", 1, 7);
        fs::create_dir_all(base.join("user-1/versions/file-3")).expect("dirs");
        fs::write(base.join("user-1/file-3"), b"content").expect("write");
        fs::write(base.join("user-1/versions/file-3/ver-3"), b"content").expect("write");
        drop(conn);

        migrate_to_file_directories(&pool, &store);
        let second = migrate_to_file_directories(&pool, &store);

        assert_eq!(second, LayoutReport::default());
        fs::remove_dir_all(base).ok();
    }

    #[test]
    fn same_bytes_distinguishes_equal_length_content() {
        let base = scratch();
        fs::write(base.join("a"), b"aaaa").expect("write");
        fs::write(base.join("b"), b"aaab").expect("write");
        fs::write(base.join("c"), b"aaaa").expect("write");

        assert!(!same_bytes(&base.join("a"), &base.join("b")));
        assert!(same_bytes(&base.join("a"), &base.join("c")));
        fs::remove_dir_all(base).ok();
    }
}
