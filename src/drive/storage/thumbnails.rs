//! Moving the inline cover thumbnails out of `files` and into the file store.
//!
//! `files.cover_thumbnail` held a base64 JPEG in the row. On a real install
//! after a Google Takeout load that was 806 rows carrying 29MB of blob against
//! a 33MB database — ~88% of it — and it was paid for on every query that
//! returned a page of files, not just the listing that migration 00119 taught
//! to stop reading them (issue #175). A thumbnail now lives in the store as
//! `<user>/<file>/.thumb` and is fetched from its own cacheable endpoint.
//!
//! ## Why this runs in the app rather than in the migration
//!
//! The rows and the blobs have to move together and a `.sql` file can only do
//! half of it, so this pass takes the bytes out and migration 00132 drops the
//! column — the same split migration 00118 and [`super::layout`] use.
//!
//! That ordering is the whole reason this reads the column through raw SQL:
//! it runs *before* `run_pending_migrations`, so the column may or may not
//! exist, and `schema.rs` no longer names it either way. `PRAGMA table_info`
//! settles which, and an already-migrated database costs one pragma.
//!
//! ## Best-effort, on purpose
//!
//! A thumbnail is a nicety — a blank tile in the grid, never a lost file — so
//! nothing here is allowed to fail the boot. A row whose bytes cannot be
//! decoded or written is logged and left, and the column drop that follows
//! takes it. The alternative, refusing to start over an undecodable preview,
//! would be a far worse outcome than the icon it falls back to.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use diesel::prelude::*;
use diesel::sql_types::{Nullable, Text};

use super::repository::DbPool;
use super::store::LocalFileStore;

/// What one pass did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DrainReport {
    /// Thumbnails written to the store and cleared from their row.
    pub moved: u64,
    /// Rows whose thumbnail could not be decoded or written, and which the
    /// column drop will therefore discard.
    pub failed: u64,
}

/// One row still carrying an inline thumbnail.
#[derive(QueryableByName)]
struct InlineThumbnail {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    user_id: String,
    #[diesel(sql_type = Nullable<Text>)]
    cover_thumbnail: Option<String>,
}

/// A column of `files`, as `PRAGMA table_info` reports it.
#[derive(QueryableByName)]
struct TableColumn {
    #[diesel(sql_type = Text)]
    name: String,
}

/// How many rows to pull into memory at once.
///
/// Small because the point of the exercise is that these rows are enormous: at
/// ~37KB apiece a batch is a couple of megabytes, where loading all of them
/// would put the entire blob half of the database in the process at once —
/// which on the install that motivated this is 29MB.
const BATCH: i64 = 64;

/// Move every inline thumbnail into the store. Never fails the boot.
pub fn drain_inline_thumbnails(pool: &DbPool, store: &LocalFileStore) -> DrainReport {
    let mut report = DrainReport::default();

    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("thumbnail drain: could not get db connection: {e}");
            return report;
        }
    };

    if !has_inline_column(&mut conn) {
        return report;
    }

    loop {
        // Re-queried rather than paged with an offset: each pass nulls the
        // rows it moved, so the next batch is whatever is still inline. A row
        // that failed would otherwise be met again forever, so it is nulled
        // too — its bytes are already lost to the column drop either way.
        let batch: Vec<InlineThumbnail> = match diesel::sql_query(
            "SELECT id, user_id, cover_thumbnail FROM files \
             WHERE cover_thumbnail IS NOT NULL AND cover_thumbnail != '' LIMIT ?",
        )
        .bind::<diesel::sql_types::BigInt, _>(BATCH)
        .load(&mut conn)
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::error!("thumbnail drain: could not read thumbnails: {e}");
                return report;
            }
        };

        if batch.is_empty() {
            break;
        }

        if report.moved == 0 && report.failed == 0 {
            tracing::info!("thumbnail drain: moving inline thumbnails into the file store");
        }

        for row in batch {
            match move_one(store, &row) {
                Ok(()) => report.moved += 1,
                Err(e) => {
                    report.failed += 1;
                    tracing::error!(file = %row.id, "thumbnail drain: {e}");
                }
            }
            if let Err(e) = clear_inline(&mut conn, &row.id) {
                // Leaving the row set would loop this pass forever, so a write
                // failure here is the one thing that stops it.
                tracing::error!(file = %row.id, "thumbnail drain: {e}");
                return report;
            }
        }
    }

    if report.moved > 0 || report.failed > 0 {
        tracing::info!(
            moved = report.moved,
            failed = report.failed,
            "thumbnail drain: complete",
        );
    }

    report
}

/// Reclaim the pages the thumbnails were occupying.
///
/// Dropping the column frees them inside the file; only `VACUUM` gives them
/// back to the filesystem, and on the install in the issue that is 29MB of a
/// 33MB database. It cannot run inside a transaction, which is why it is here
/// and not in the migration, and it runs after the migration because the
/// column has to be gone before the space is worth reclaiming.
pub fn reclaim_space(pool: &DbPool) {
    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("thumbnail drain: could not get db connection to vacuum: {e}");
            return;
        }
    };
    match diesel::sql_query("VACUUM").execute(&mut conn) {
        Ok(_) => tracing::info!("thumbnail drain: vacuumed the database"),
        Err(e) => tracing::warn!("thumbnail drain: vacuum failed: {e}"),
    }
}

/// Whether `files` still has the pre-00132 blob column. False on a database
/// that has already migrated, and on one created from the current schema.
fn has_inline_column(conn: &mut SqliteConnection) -> bool {
    match diesel::sql_query("PRAGMA table_info(files)").load::<TableColumn>(conn) {
        Ok(columns) => columns.iter().any(|c| c.name == "cover_thumbnail"),
        Err(e) => {
            tracing::error!("thumbnail drain: could not inspect the files table: {e}");
            false
        }
    }
}

fn move_one(store: &LocalFileStore, row: &InlineThumbnail) -> Result<(), String> {
    let b64 = row.cover_thumbnail.as_deref().unwrap_or_default();
    let bytes = BASE64
        .decode(b64)
        .map_err(|e| format!("thumbnail is not valid base64, discarding it: {e}"))?;
    store.write_thumbnail(&row.user_id, &row.id, &bytes)
}

fn clear_inline(conn: &mut SqliteConnection, file_id: &str) -> Result<(), String> {
    diesel::sql_query("UPDATE files SET cover_thumbnail = NULL WHERE id = ?")
        .bind::<Text, _>(file_id)
        .execute(conn)
        .map(|_| ())
        .map_err(|e| format!("could not clear the moved thumbnail: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::files;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;
    use std::path::PathBuf;
    use uuid::Uuid;

    /// A pool on the schema as it stood *before* 00132, which is the only state
    /// the drain has anything to do: migrations are run, then the column is put
    /// back and refilled, exactly as an un-upgraded database would have it.
    fn legacy_pool() -> DbPool {
        use crate::MIGRATIONS;
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        let mut conn = pool.get().expect("conn");
        conn.run_pending_migrations(MIGRATIONS).expect("migrations");
        diesel::sql_query("ALTER TABLE files ADD COLUMN cover_thumbnail TEXT")
            .execute(&mut conn)
            .expect("re-add the dropped column");
        drop(conn);
        pool
    }

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("neutrino_thumbs_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn insert_file(conn: &mut SqliteConnection, id: &str, user: &str, thumbnail: Option<&str>) {
        let now = chrono::Utc::now().naive_utc();
        diesel::insert_into(files::table)
            .values((
                files::id.eq(id),
                files::user_id.eq(user),
                files::name.eq("photo.jpg"),
                files::size_bytes.eq(10),
                files::mime_type.eq("image/jpeg"),
                files::storage_path.eq(format!("{user}/{id}/ver-1")),
                files::created_at.eq(now),
                files::updated_at.eq(now),
            ))
            .execute(conn)
            .expect("insert file");
        if let Some(b64) = thumbnail {
            diesel::sql_query("UPDATE files SET cover_thumbnail = ? WHERE id = ?")
                .bind::<Text, _>(b64)
                .bind::<Text, _>(id)
                .execute(conn)
                .expect("set thumbnail");
        }
    }

    fn still_inline(conn: &mut SqliteConnection) -> i64 {
        #[derive(QueryableByName)]
        struct Count {
            #[diesel(sql_type = diesel::sql_types::BigInt)]
            n: i64,
        }
        diesel::sql_query("SELECT COUNT(*) AS n FROM files WHERE cover_thumbnail IS NOT NULL")
            .get_result::<Count>(conn)
            .expect("count")
            .n
    }

    #[test]
    fn thumbnails_move_to_the_store_and_leave_the_row() {
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let pool = legacy_pool();
        let mut conn = pool.get().expect("conn");
        insert_file(&mut conn, "file-1", "user-1", Some(&BASE64.encode(b"jpeg one")));
        insert_file(&mut conn, "file-2", "user-1", Some(&BASE64.encode(b"jpeg two")));
        insert_file(&mut conn, "file-3", "user-1", None);
        drop(conn);

        let report = drain_inline_thumbnails(&pool, &store);

        assert_eq!(report, DrainReport { moved: 2, failed: 0 });
        assert_eq!(
            std::fs::read(store.thumbnail_path("user-1", "file-1")).expect("read"),
            b"jpeg one",
        );
        assert_eq!(
            std::fs::read(store.thumbnail_path("user-1", "file-2")).expect("read"),
            b"jpeg two",
        );
        assert!(!store.thumbnail_path("user-1", "file-3").exists());
        assert_eq!(still_inline(&mut pool.get().expect("conn")), 0);
        std::fs::remove_dir_all(base).ok();
    }

    /// The pass is re-derived from the column every boot, so a store that has
    /// already been drained costs one pragma and does nothing. The second run
    /// here still sees the column (the test schema keeps it) but no rows.
    #[test]
    fn a_drained_database_is_left_alone() {
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let pool = legacy_pool();
        let mut conn = pool.get().expect("conn");
        insert_file(&mut conn, "file-1", "user-1", Some(&BASE64.encode(b"jpeg")));
        drop(conn);

        drain_inline_thumbnails(&pool, &store);
        let second = drain_inline_thumbnails(&pool, &store);

        assert_eq!(second, DrainReport::default());
        std::fs::remove_dir_all(base).ok();
    }

    /// The post-00132 shape: no column, nothing to do, and no error either.
    #[test]
    fn a_migrated_database_has_nothing_to_drain() {
        use crate::MIGRATIONS;
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool: DbPool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");

        assert_eq!(drain_inline_thumbnails(&pool, &store), DrainReport::default());
        std::fs::remove_dir_all(base).ok();
    }

    /// An undecodable thumbnail must not stall the pass or the boot — it is
    /// counted, cleared, and the files after it still move.
    #[test]
    fn an_undecodable_thumbnail_is_discarded_rather_than_retried() {
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let pool = legacy_pool();
        let mut conn = pool.get().expect("conn");
        insert_file(&mut conn, "file-bad", "user-1", Some("not base64 !!!"));
        insert_file(&mut conn, "file-ok", "user-1", Some(&BASE64.encode(b"jpeg")));
        drop(conn);

        let report = drain_inline_thumbnails(&pool, &store);

        assert_eq!(report, DrainReport { moved: 1, failed: 1 });
        assert!(!store.thumbnail_path("user-1", "file-bad").exists());
        assert_eq!(
            std::fs::read(store.thumbnail_path("user-1", "file-ok")).expect("read"),
            b"jpeg",
        );
        assert_eq!(still_inline(&mut pool.get().expect("conn")), 0);
        std::fs::remove_dir_all(base).ok();
    }

    /// More rows than one batch, so the re-query loop is exercised rather than
    /// the single pass every other test takes.
    #[test]
    fn every_batch_is_drained() {
        let base = scratch();
        let store = LocalFileStore::new(&base).expect("store");
        let pool = legacy_pool();
        let mut conn = pool.get().expect("conn");
        let count = BATCH as usize + 5;
        for i in 0..count {
            insert_file(
                &mut conn,
                &format!("file-{i}"),
                "user-1",
                Some(&BASE64.encode(format!("jpeg {i}").as_bytes())),
            );
        }
        drop(conn);

        let report = drain_inline_thumbnails(&pool, &store);

        assert_eq!(report.moved, count as u64);
        assert_eq!(report.failed, 0);
        assert_eq!(
            std::fs::read(store.thumbnail_path("user-1", "file-68")).expect("read"),
            b"jpeg 68",
        );
        std::fs::remove_dir_all(base).ok();
    }
}
