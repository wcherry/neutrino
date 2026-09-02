//! Stage two of account deletion.
//!
//! Deleting an account is deliberately not instant. The main app's
//! `DELETE /api/v1/auth/me` (and the admin console's delete) only stamps
//! `users.deleted_at`, which takes the account out of every lookup — it can no
//! longer sign in, be found, or be shared with — while leaving the rows in
//! place. That is the window in which an admin can undo the delete from
//! `/admin`, and it is the only window: this module is what closes it.
//!
//! Once [`PURGE_GRACE_DAYS`] have passed the account is erased for good — the
//! stored file blobs, every row keyed to the user, and finally the `users` row
//! itself. After that there is nothing left to restore.
//!
//! ## Why a sweep rather than a scheduled job
//!
//! The obvious shape is to enqueue a `worker_jobs` row at delete time with a
//! run-after date. It was not built that way for two reasons. A queued job
//! would have to be *cancelled* when an admin restores the account, and a
//! missed cancellation erases an account somebody deliberately brought back —
//! a failure with no recovery. And a queue row can be lost (a restore from an
//! older backup, a manual `deleted_at` set in SQL) leaving an account that
//! never purges. Re-deriving the work from `deleted_at` on every sweep has
//! neither problem: a restored account simply stops matching the query.

use std::path::{Path, PathBuf};
use std::time::Duration;

use diesel::prelude::*;
use diesel::sql_types::Text;

use crate::{Conn, DbPool};

/// How long a soft-deleted account is kept before it is erased.
///
/// The main app enforces the same number as `auth::service::PURGE_GRACE_DAYS`
/// — it is what the admin console counts down to, and what it tells a user
/// deleting their account. The worker is a separate crate and cannot import
/// it, so the two copies have to be changed together.
pub const PURGE_GRACE_DAYS: i64 = 30;

/// How often the sweep runs.
///
/// The window is measured in days, so an hour of slack is invisible, and a
/// sweep that finds nothing is one indexed query.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(3600);

// The main app's `users` table. Only the columns the sweep reads are mirrored
// here; the rest of the purge is raw SQL, since naming 60-odd tables in Diesel
// would mean mirroring 60-odd schemas that this crate never otherwise touches.
diesel::table! {
    users (id) {
        id -> Text,
        email -> Text,
        deleted_at -> Nullable<Timestamp>,
    }
}

/// Tables whose rows belong to one user, as `(table, user column)`.
///
/// Deliberately *not* here, because deleting them would destroy data belonging
/// to people who are still using the system:
///
/// - `shared_drives` / `legal_holds` (`created_by`) — team-owned resources that
///   happen to record who set them up. A drive does not go away because its
///   creator left, and a legal hold exists precisely to outlive the people
///   subject to it.
/// - `users` itself, which is deleted last and separately.
///
/// Everything else the user owns goes, including content they authored in
/// places other people can see (`comments`, `comment_replies`,
/// `doc_suggestions`, `diagram_comments`). That is the promise the delete
/// dialog makes, and leaving them behind would strand rows pointing at a user
/// id that no longer resolves.
const USER_OWNED_TABLES: &[(&str, &str)] = &[
    // Auth and identity
    ("refresh_tokens", "user_id"),
    ("totp_backup_codes", "user_id"),
    ("user_profiles", "user_id"),
    ("user_public_keys", "user_id"),
    ("user_key_vaults", "user_id"),
    ("user_key_unlocks", "user_id"),
    ("oauth_authorization_codes", "user_id"),
    // The password-reuse history. Hashes, but hashes of the account's real
    // passwords — leaving them behind would keep the one thing a purge is for
    // getting rid of, long after the account itself is gone.
    ("password_history", "user_id"),
    // Calendar
    ("events", "user_id"),
    ("reminders", "user_id"),
    ("calendar_connections", "user_id"),
    ("task_lists", "user_id"),
    ("tasks", "user_id"),
    // Photos
    ("photos", "user_id"),
    ("albums", "user_id"),
    ("persons", "user_id"),
    ("locked_folder_settings", "user_id"),
    ("training_signals", "user_id"),
    ("user_recognition_thresholds", "user_id"),
    // Drive and documents
    ("files", "user_id"),
    ("folders", "user_id"),
    ("shortcuts", "user_id"),
    ("file_versions", "user_id"),
    ("file_key_refs", "user_id"),
    ("permissions", "user_id"),
    ("share_links", "created_by"),
    ("shared_drive_members", "user_id"),
    ("comments", "user_id"),
    ("comment_replies", "user_id"),
    ("doc_suggestions", "user_id"),
    ("diagram_comments", "user_id"),
    ("file_activity_log", "user_id"),
    ("file_access_scores", "user_id"),
    ("ransomware_events", "user_id"),
    ("tags", "user_id"),
    ("user_quotas", "user_id"),
    ("search_index_snapshots", "user_id"),
    // Editors and personalisation
    ("slide_themes", "user_id"),
    ("custom_themes", "user_id"),
    ("custom_fonts", "uploaded_by"),
];

/// Rows that hang off one of the user's files rather than off the user.
///
/// These carry no `user_id` of their own, so deleting the `files` rows alone
/// would orphan them — including rows written by *other* users, such as a
/// colleague's comment on a document that is going away. Each is deleted by
/// subquery against the owner's files, and this has to run **before**
/// `USER_OWNED_TABLES` empties `files`, or the subquery matches nothing.
// A name here that no longer exists is not a no-op: the DELETE raises "no such
// table", `purge_account` returns the error, and `sweep` logs and skips the
// account — so one stale entry quietly stops *every* account being purged. That
// is what `docs` did between migration 00114 dropping the table and its removal
// from this list.
const FILE_SCOPED_TABLES: &[&str] = &[
    "doc_yjs_state",
    "notes",
    "diagram_yjs_state",
    "diagram_comments",
    "doc_suggestions",
    "comments",
    "file_versions",
    "file_key_refs",
    "file_tags",
    "file_summaries",
    "file_classifications",
    "file_activity_log",
    "file_access_scores",
    "event_attachments",
    // The join row only, never the `legal_holds` policy it points at. Note
    // that this does not *honour* the hold: a file under one is purged with
    // the rest of the account. Making deletion hold-aware is a compliance
    // decision that belongs with whoever sets the policy, not here.
    "file_legal_holds",
];

/// A soft-deleted account whose grace window has closed.
#[derive(Debug, Queryable)]
struct ExpiredAccount {
    id: String,
    email: String,
}

/// Runs one sweep: purges every account whose grace window has closed.
///
/// Returns how many accounts were erased. One failing account is logged and
/// skipped rather than aborting the sweep — the next hourly run will try it
/// again, and a single wedged account must not hold up the rest.
pub fn sweep(pool: &DbPool, storage_root: &Path) -> Result<usize, diesel::result::Error> {
    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("purge: could not get db connection: {e}");
            return Ok(0);
        }
    };

    let cutoff = chrono::Utc::now().naive_utc() - chrono::Duration::days(PURGE_GRACE_DAYS);
    let expired: Vec<ExpiredAccount> = users::table
        .filter(users::deleted_at.is_not_null())
        .filter(users::deleted_at.le(cutoff))
        .select((users::id, users::email))
        .load(&mut conn)?;

    if expired.is_empty() {
        return Ok(0);
    }

    let mut purged = 0;
    for account in expired {
        match purge_account(&mut conn, storage_root, &account.id) {
            Ok(rows) => {
                purged += 1;
                // The email is logged because after this it exists nowhere
                // else, and an operator asked "what happened to this account?"
                // has only the log to answer from.
                tracing::info!(
                    user = %account.id,
                    email = %account.email,
                    rows,
                    "purged account past its {PURGE_GRACE_DAYS}-day grace window",
                );
            }
            Err(e) => {
                tracing::error!(user = %account.id, "purge failed, will retry next sweep: {e}");
            }
        }
    }

    Ok(purged)
}

/// Erases one account: its stored files, then its rows.
///
/// Blobs go first and the rows follow in a transaction. Taking that order
/// means a crash in between leaves rows pointing at files that are gone —
/// recoverable, because the next sweep still finds the account and finishes
/// the job. The reverse order loses the only record of which directory to
/// delete, leaving the bytes on disk forever with nothing referencing them,
/// which is the one outcome a deletion feature must not produce.
fn purge_account(
    conn: &mut Conn,
    storage_root: &Path,
    user_id: &str,
) -> Result<usize, diesel::result::Error> {
    delete_stored_files(storage_root, user_id);

    conn.transaction(|conn| {
        let mut rows = 0;

        for table in FILE_SCOPED_TABLES {
            rows += diesel::sql_query(format!(
                "DELETE FROM {table} WHERE file_id IN (SELECT id FROM files WHERE user_id = ?)"
            ))
            .bind::<Text, _>(user_id)
            .execute(conn)?;
        }

        // Photo-scoped rows, same reasoning: they key off a photo, not a user.
        for (table, column) in [
            ("photo_edits", "photo_id"),
            ("album_photos", "photo_id"),
            ("faces", "photo_id"),
        ] {
            rows += diesel::sql_query(format!(
                "DELETE FROM {table} WHERE {column} IN (SELECT id FROM photos WHERE user_id = ?)"
            ))
            .bind::<Text, _>(user_id)
            .execute(conn)?;
        }
        rows += diesel::sql_query(
            "DELETE FROM album_photos WHERE album_id IN (SELECT id FROM albums WHERE user_id = ?)",
        )
        .bind::<Text, _>(user_id)
        .execute(conn)?;
        rows += diesel::sql_query(
            "DELETE FROM face_suggestions WHERE person_id IN (SELECT id FROM persons WHERE user_id = ?)",
        )
        .bind::<Text, _>(user_id)
        .execute(conn)?;

        // Replies to comments on the user's files. Their own replies elsewhere
        // are covered by `comment_replies.user_id` below.
        rows += diesel::sql_query(
            "DELETE FROM comment_replies WHERE comment_id IN \
             (SELECT id FROM comments WHERE file_id IN (SELECT id FROM files WHERE user_id = ?))",
        )
        .bind::<Text, _>(user_id)
        .execute(conn)?;

        rows += diesel::sql_query(
            "DELETE FROM file_tags WHERE tag_id IN (SELECT id FROM tags WHERE user_id = ?)",
        )
        .bind::<Text, _>(user_id)
        .execute(conn)?;

        for (table, column) in USER_OWNED_TABLES {
            rows += diesel::sql_query(format!("DELETE FROM {table} WHERE {column} = ?"))
                .bind::<Text, _>(user_id)
                .execute(conn)?;
        }

        // Last, so a failure anywhere above rolls back with the account still
        // marked deleted and still eligible for the next sweep.
        rows += diesel::delete(users::table.filter(users::id.eq(user_id))).execute(conn)?;

        Ok(rows)
    })
}

/// Removes the user's blob directory.
///
/// The store lays every user's bytes out under `{storage_root}/{user_id}`,
/// versions included (`{user_id}/versions/{file_id}/{version_id}`), so one
/// recursive remove covers all of it without reading a single row.
///
/// A missing directory is the normal case for an account that never uploaded
/// anything, and any other failure is logged rather than raised: the rows are
/// what make the account exist, and refusing to delete them because a file
/// handle was busy would keep a deleted account alive indefinitely.
fn delete_stored_files(storage_root: &Path, user_id: &str) {
    // `user_id` comes from the database, but joining an attacker-chosen id
    // could still escape the root; ids are UUIDs, so anything with a separator
    // in it is a bug or tampering and is refused rather than resolved.
    if user_id.is_empty() || user_id.contains(['/', '\\']) || user_id.contains("..") {
        tracing::error!(user = %user_id, "purge: refusing to delete files for a suspicious user id");
        return;
    }

    let dir: PathBuf = storage_root.join(user_id);
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => tracing::info!(user = %user_id, path = %dir.display(), "purge: removed stored files"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => tracing::error!(
            user = %user_id,
            path = %dir.display(),
            "purge: could not remove stored files: {e}",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::ConnectionManager;
    use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

    const MIGRATIONS: EmbeddedMigrations = embed_migrations!("../migrations");

    /// A migrated database on disk. In-memory would give each pooled connection
    /// its own empty database, and the sweep takes a connection of its own.
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
        let dir = std::env::temp_dir().join(format!("neutrino-purge-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let url = dir.join("test.db");
        // Room for two: the tests hold a connection to assert against while
        // `sweep` takes one of its own. At `max_size(1)` — which is what the
        // worker itself runs with — the sweep would simply block on the test.
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

    fn insert_user(conn: &mut Conn, id: &str, deleted_days_ago: Option<i64>) {
        let now = chrono::Utc::now().naive_utc();
        let deleted = deleted_days_ago.map(|d| now - chrono::Duration::days(d));
        diesel::sql_query(
            "INSERT INTO users (id, email, name, password_hash, role, totp_enabled, created_at, deleted_at) \
             VALUES (?, ?, 'Test', 'x', 'user', 0, ?, ?)",
        )
        .bind::<Text, _>(id)
        .bind::<Text, _>(format!("{id}@test.com"))
        .bind::<diesel::sql_types::Timestamp, _>(now)
        .bind::<diesel::sql_types::Nullable<diesel::sql_types::Timestamp>, _>(deleted)
        .execute(conn)
        .expect("insert user");
    }

    fn count(conn: &mut Conn, sql: &str, id: &str) -> i64 {
        #[derive(diesel::QueryableByName)]
        struct Count {
            #[diesel(sql_type = diesel::sql_types::BigInt)]
            n: i64,
        }
        diesel::sql_query(sql)
            .bind::<Text, _>(id)
            .load::<Count>(conn)
            .expect("count")[0]
            .n
    }

    /// The load-bearing test: it runs every DELETE the purge issues against a
    /// database built from the real migrations. A table or column that has been
    /// renamed out from under this module fails here rather than in a sweep.
    #[test]
    fn purge_erases_the_account_and_its_rows() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        let now = chrono::Utc::now().naive_utc();

        insert_user(&mut conn, "gone", Some(PURGE_GRACE_DAYS + 1));
        insert_user(&mut conn, "stays", None);

        // A file with a child row hanging off it, to prove the file-scoped pass
        // runs before `files` is emptied.
        for owner in ["gone", "stays"] {
            diesel::sql_query(
                "INSERT INTO files (id, user_id, name, size_bytes, mime_type, storage_path, created_at, updated_at) \
                 VALUES (?, ?, 'f.txt', 1, 'text/plain', '', ?, ?)",
            )
            .bind::<Text, _>(format!("file-{owner}"))
            .bind::<Text, _>(owner)
            .bind::<diesel::sql_types::Timestamp, _>(now)
            .bind::<diesel::sql_types::Timestamp, _>(now)
            .execute(&mut conn)
            .expect("insert file");

            diesel::sql_query("INSERT INTO notes (file_id, created_at, updated_at) VALUES (?, ?, ?)")
                .bind::<Text, _>(format!("file-{owner}"))
                .bind::<diesel::sql_types::Timestamp, _>(now)
                .bind::<diesel::sql_types::Timestamp, _>(now)
                .execute(&mut conn)
                .expect("insert note");

            // Hashes of the account's real passwords, so the purge has to take
            // them with it.
            diesel::sql_query(
                "INSERT INTO password_history (id, user_id, password_hash, created_at) \
                 VALUES (?, ?, 'argon2-hash', ?)",
            )
            .bind::<Text, _>(format!("pw-{owner}"))
            .bind::<Text, _>(owner)
            .bind::<diesel::sql_types::Timestamp, _>(now)
            .execute(&mut conn)
            .expect("insert password history");
        }

        let purged = sweep(&db.pool, &db.dir).expect("sweep");
        assert_eq!(purged, 1, "only the expired account should be purged");

        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM users WHERE id = ?", "gone"), 0);
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM files WHERE user_id = ?", "gone"), 0);
        assert_eq!(
            count(&mut conn, "SELECT COUNT(*) AS n FROM notes WHERE file_id = ?", "file-gone"),
            0,
            "a row hanging off the purged user's file was orphaned",
        );
        assert_eq!(
            count(&mut conn, "SELECT COUNT(*) AS n FROM password_history WHERE user_id = ?", "gone"),
            0,
            "the purged account's password hashes outlived it",
        );

        // The live account is untouched, children included.
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM users WHERE id = ?", "stays"), 1);
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM files WHERE user_id = ?", "stays"), 1);
        assert_eq!(
            count(&mut conn, "SELECT COUNT(*) AS n FROM notes WHERE file_id = ?", "file-stays"),
            1,
        );
        assert_eq!(
            count(&mut conn, "SELECT COUNT(*) AS n FROM password_history WHERE user_id = ?", "stays"),
            1,
        );
    }

    #[test]
    fn an_account_inside_its_grace_window_is_left_alone() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();

        insert_user(&mut conn, "recent", Some(PURGE_GRACE_DAYS - 1));

        assert_eq!(sweep(&db.pool, &db.dir).expect("sweep"), 0);
        // Still restorable from /admin — that is the whole point of the window.
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM users WHERE id = ?", "recent"), 1);
    }

    #[test]
    fn the_users_stored_files_are_removed() {
        let db = make_test_db();
        let mut conn = db.pool.get().unwrap();
        insert_user(&mut conn, "blobby", Some(PURGE_GRACE_DAYS + 1));

        let blobs = db.dir.join("blobby");
        std::fs::create_dir_all(blobs.join("versions/file-1")).expect("make blob dirs");
        std::fs::write(blobs.join("file-1"), b"ciphertext").expect("write blob");

        sweep(&db.pool, &db.dir).expect("sweep");

        // Rows without bytes would leave the storage volume growing forever
        // with nothing left to say who the files belonged to.
        assert!(!blobs.exists(), "the purged account's blob directory survived");
    }

    #[test]
    fn grace_window_matches_the_main_app() {
        // `auth::service::PURGE_GRACE_DAYS` is the other half of this. The two
        // crates cannot share a constant, so this is the reminder that a change
        // to one is a change to both.
        assert_eq!(PURGE_GRACE_DAYS, 30);
    }

    #[test]
    fn file_scoped_tables_are_emptied_before_files() {
        // The file-scoped deletes are subqueries against `files`, so `files`
        // appearing in the earlier list would make every one of them a no-op.
        assert!(
            !FILE_SCOPED_TABLES.contains(&"files"),
            "files must be purged by USER_OWNED_TABLES, after its children",
        );
    }

    #[test]
    fn team_owned_tables_are_left_alone() {
        // Deleting these takes other people's data with the departing user.
        for table in ["shared_drives", "legal_holds", "users"] {
            assert!(
                !USER_OWNED_TABLES.iter().any(|(t, _)| *t == table),
                "{table} must not be purged by owner",
            );
        }
    }

    #[test]
    fn suspicious_user_ids_do_not_escape_the_storage_root() {
        let root = std::env::temp_dir().join("neutrino-purge-test");
        let canary = root.join("keep-me");
        std::fs::create_dir_all(&canary).expect("set up canary");

        for id in ["", "..", "../keep-me", "a/../..", "a\\b"] {
            delete_stored_files(&root, id);
        }

        assert!(canary.exists(), "a traversal id deleted outside its own directory");
        std::fs::remove_dir_all(&root).ok();
    }
}
