use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Filename prefix for in-progress upload staging files. Uploads stream the
/// request body to `<user_dir>/tmp_<uuid>` and commit by renaming it into
/// place, so anything still carrying this prefix is by definition uncommitted.
pub const TEMP_PREFIX: &str = "tmp_";

/// A staging file that deletes itself unless the upload commits.
///
/// The commit is the `rename` at the end of `StorageService::finalize_upload`
/// / `autosave` / `save_named_version`. Everything between creating the file
/// and that rename can fail, and most of those failures used to leak: a `?` on
/// a chunk read/write error skipped the hand-written cleanup on the finalize
/// branch, and a client that disconnected mid-upload had its handler future
/// dropped, which runs no error path at all. Both left the staged bytes on
/// disk forever.
///
/// Holding the staging path in this guard makes the cleanup unconditional —
/// `?`, an early return, a panic, and a cancelled future all run `Drop`. Call
/// [`TempUpload::commit`] once the rename has succeeded so the guard stops
/// owning a path that is no longer its file.
#[must_use = "dropping the guard immediately deletes the staging file"]
pub struct TempUpload {
    path: PathBuf,
    committed: bool,
}

impl TempUpload {
    pub fn new(path: PathBuf) -> Self {
        TempUpload {
            path,
            committed: false,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Release ownership after the staged bytes have been renamed into their
    /// final home. Without this the guard would still fire on drop; the
    /// `remove_file` would simply miss (the name no longer exists), but it
    /// would also delete a same-named file if one were ever recreated, and it
    /// makes the failure logging below lie about a successful upload.
    pub fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for TempUpload {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        match std::fs::remove_file(&self.path) {
            Ok(()) => tracing::debug!("Removed staging file for aborted upload: {:?}", self.path),
            // Already gone — the upload committed through a path that consumed
            // the file, or a sweep beat us to it. Not worth a log line.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("Failed to remove staging file {:?}: {:?}", self.path, e),
        }
    }
}

/// What a [`LocalFileStore::sweep_temp_files`] pass did, for logging.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct TempSweepReport {
    pub removed: u64,
    pub bytes_freed: u64,
    /// Staging files younger than the age threshold — most likely uploads in
    /// flight right now.
    pub skipped: u64,
    pub failed: u64,
}

/// Reasons a storage key cannot be safely resolved into a servable file path.
#[derive(Debug, PartialEq, Eq)]
pub enum ServeResolveError {
    /// The key is empty (e.g. a placeholder record with no uploaded content).
    EmptyKey,
    /// The key resolves to a directory rather than a file.
    IsDirectory,
    /// The key resolves to a path with nothing on disk — the file row outlived
    /// its blob (content never landed, or was removed out from under the DB).
    Missing,
}

pub struct LocalFileStore {
    base_path: PathBuf,
}

impl LocalFileStore {
    pub fn new(base_path: impl Into<PathBuf>) -> Result<Self, String> {
        let base_path = base_path.into();
        std::fs::create_dir_all(&base_path)
            .map_err(|e| format!("Failed to create storage directory: {}", e))?;
        Ok(LocalFileStore { base_path })
    }

    /// Absolute path to a flat blob in a partition — use for filesystem operations.
    ///
    /// Drive files are **not** stored this way: they live in a directory of
    /// their own (see [`Self::file_dir`]). This is for the partitions that hold
    /// one unversioned blob per name, which today means `fonts`.
    pub fn file_path(&self, partition: &str, name: &str) -> PathBuf {
        self.base_path.join(partition).join(name)
    }

    /// Relative key stored in the database (independent of STORAGE_PATH).
    pub fn file_key(&self, partition: &str, name: &str) -> String {
        format!("{}/{}", partition, name)
    }

    /// Absolute path to the directory holding every version of one file.
    ///
    /// One directory per file, containing the current content *and* its
    /// history: each entry is named for a `file_versions.id`, and the row the
    /// file's `storage_path` points at is the live one. Nothing is stored
    /// twice — the file's current bytes are a version, not a copy of one —
    /// which is what the older `<user>/<file>` plus `<user>/versions/<file>/`
    /// layout could not express (every upload wrote its content out twice, and
    /// a store of freshly uploaded files occupied double what it reported).
    pub fn file_dir(&self, user_id: &str, file_id: &str) -> PathBuf {
        self.base_path.join(user_id).join(file_id)
    }

    /// Absolute path to one version's bytes — use for filesystem operations.
    pub fn version_path(&self, user_id: &str, file_id: &str, version_id: &str) -> PathBuf {
        self.file_dir(user_id, file_id).join(version_id)
    }

    /// Relative key for one version stored in the database.
    pub fn version_key(&self, user_id: &str, file_id: &str, version_id: &str) -> String {
        format!("{}/{}/{}", user_id, file_id, version_id)
    }

    /// Resolve a relative DB key to its absolute path using STORAGE_PATH.
    pub fn resolve(&self, key: &str) -> PathBuf {
        self.base_path.join(key)
    }

    /// Resolve a relative DB key to a path safe to hand to a file streamer.
    ///
    /// Guards against three hazards. The first two otherwise crash the response
    /// stream with `IsADirectory (Os code 21)`:
    /// 1. An empty `key` (placeholder records created before content upload)
    ///    would resolve to the storage root directory via `join("")`.
    /// 2. Any key that resolves to a directory rather than a file.
    /// 3. A key pointing at nothing on disk. Returning the path anyway left the
    ///    caller's `NamedFile::open` to fail, which surfaced as a bare HTTP 500
    ///    `INTERNAL_ERROR` — indistinguishable, to a client, from the server
    ///    being broken. A file row whose blob is gone is a data-integrity fact
    ///    worth reporting precisely, so it gets its own variant.
    ///
    /// Returns `Err` in all three cases so callers can surface a meaningful
    /// client error. A path that exists here can still fail to open (permissions,
    /// I/O, or a delete racing this check) — that remains a genuine 500.
    pub fn resolve_for_serving(&self, key: &str) -> Result<PathBuf, ServeResolveError> {
        if key.is_empty() {
            return Err(ServeResolveError::EmptyKey);
        }
        let path = self.base_path.join(key);
        if path.is_dir() {
            return Err(ServeResolveError::IsDirectory);
        }
        if !path.exists() {
            return Err(ServeResolveError::Missing);
        }
        Ok(path)
    }

    /// Stage an upload in the user's own directory, guarded so the bytes are
    /// removed unless the caller commits them.
    ///
    /// Staging lives beside the user's files rather than in a system temp dir
    /// so the commit is a same-filesystem `rename`, which is atomic; a cross-
    /// device copy would leave readers able to observe a half-written file.
    pub fn temp_upload(&self, user_id: &str, temp_id: &str) -> TempUpload {
        TempUpload::new(self.temp_path(user_id, temp_id))
    }

    fn temp_path(&self, user_id: &str, temp_id: &str) -> PathBuf {
        self.base_path
            .join(user_id)
            .join(format!("{}{}", TEMP_PREFIX, temp_id))
    }

    /// Delete staging files left behind by uploads that never committed.
    ///
    /// [`TempUpload`] handles every abort the process itself survives; this is
    /// the backstop for the ones it cannot — a kill -9, an OOM, a power loss —
    /// plus the accumulated leaks from before the guard existed.
    ///
    /// `min_age` is what keeps this from deleting live uploads: each buffered
    /// write pushes the staging file's mtime forward, so an upload in progress
    /// always looks young. A *stalled* upload (client gone, socket not yet
    /// timed out) can age past the threshold and be swept from under its
    /// writer; on Unix the writer keeps its handle to the now-unlinked inode
    /// and simply fails at the rename, which is the right outcome for an
    /// upload that was never going to finish.
    pub fn sweep_temp_files(&self, min_age: Duration) -> TempSweepReport {
        let mut report = TempSweepReport::default();

        // One level down only: staging files are always created directly in a
        // user (or `fonts`) partition, never inside a file's own directory.
        let partitions = match std::fs::read_dir(&self.base_path) {
            Ok(entries) => entries,
            Err(e) => {
                tracing::warn!("Temp sweep could not read {:?}: {:?}", self.base_path, e);
                return report;
            }
        };

        let now = SystemTime::now();
        for partition in partitions.flatten() {
            if !partition.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let entries = match std::fs::read_dir(partition.path()) {
                Ok(entries) => entries,
                Err(e) => {
                    tracing::warn!("Temp sweep skipped {:?}: {:?}", partition.path(), e);
                    continue;
                }
            };

            for entry in entries.flatten() {
                let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                if !name.starts_with(TEMP_PREFIX) {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_file() {
                    continue;
                }

                // A modified time we can't read, or one in the future (clock
                // skew), counts as too young — the sweep never guesses in the
                // direction of deleting something.
                let old_enough = meta
                    .modified()
                    .ok()
                    .and_then(|m| now.duration_since(m).ok())
                    .is_some_and(|age| age >= min_age);
                if !old_enough {
                    report.skipped += 1;
                    continue;
                }

                match std::fs::remove_file(entry.path()) {
                    Ok(()) => {
                        report.removed += 1;
                        report.bytes_freed += meta.len();
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        report.failed += 1;
                        tracing::warn!("Temp sweep failed to remove {:?}: {:?}", entry.path(), e);
                    }
                }
            }
        }

        report
    }

    pub fn ensure_user_dir(&self, user_id: &str) -> Result<(), String> {
        std::fs::create_dir_all(self.base_path.join(user_id))
            .map_err(|e| format!("Failed to create user directory: {}", e))
    }

    pub fn ensure_file_dir(&self, user_id: &str, file_id: &str) -> Result<(), String> {
        std::fs::create_dir_all(self.file_dir(user_id, file_id))
            .map_err(|e| format!("Failed to create file directory: {}", e))
    }

    /// Remove a file's directory and every version in it.
    ///
    /// Called when the file itself is deleted for good. Best-effort and
    /// logged rather than raised: the rows are what make the file exist, and a
    /// busy handle must not keep a deleted file in the listing.
    pub fn remove_file_dir(&self, user_id: &str, file_id: &str) {
        let dir = self.file_dir(user_id, file_id);
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => {}
            // Never had content uploaded, or a previous delete got there first.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("Failed to remove file directory {:?}: {:?}", dir, e),
        }
    }

    #[allow(dead_code)]
    pub fn delete_file(&self, path: &Path) -> std::io::Result<()> {
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Backdate a file's mtime so a sweep sees it as abandoned.
    fn age_file(path: &Path, by: Duration) {
        let file = std::fs::File::options()
            .write(true)
            .open(path)
            .expect("open for mtime");
        file.set_times(std::fs::FileTimes::new().set_modified(SystemTime::now() - by))
            .expect("set mtime");
    }

    fn temp_store() -> (LocalFileStore, PathBuf) {
        let base = std::env::temp_dir().join(format!("neutrino_store_test_{}", uuid::Uuid::new_v4()));
        let store = LocalFileStore::new(&base).expect("create store");
        (store, base)
    }

    #[test]
    fn resolve_for_serving_rejects_empty_key() {
        let (store, base) = temp_store();
        let err = store.resolve_for_serving("").unwrap_err();
        assert_eq!(err, ServeResolveError::EmptyKey);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn resolve_for_serving_rejects_directory() {
        let (store, base) = temp_store();
        std::fs::create_dir_all(base.join("user1/folder")).expect("mkdir");
        let err = store.resolve_for_serving("user1/folder").unwrap_err();
        assert_eq!(err, ServeResolveError::IsDirectory);
        let _ = std::fs::remove_dir_all(base);
    }

    /// A file row whose blob is gone must be reported as `Missing` here rather
    /// than handed on as a path — letting `NamedFile::open` fail turned it into
    /// an opaque HTTP 500.
    #[test]
    fn resolve_for_serving_rejects_missing_file() {
        let (store, base) = temp_store();
        std::fs::create_dir_all(base.join("user1")).expect("mkdir");
        let err = store.resolve_for_serving("user1/vanished").unwrap_err();
        assert_eq!(err, ServeResolveError::Missing);
        let _ = std::fs::remove_dir_all(base);
    }

    /// The leak this guard exists to close: an upload that streams bytes and
    /// then fails anywhere before the commit rename.
    #[test]
    fn temp_upload_is_removed_when_dropped_uncommitted() {
        let (store, base) = temp_store();
        store.ensure_user_dir("user1").expect("mkdir");
        let path = {
            let temp = store.temp_upload("user1", "abc");
            std::fs::write(temp.path(), b"partial upload").expect("write");
            assert!(temp.path().exists());
            temp.path().to_path_buf()
        };
        assert!(!path.exists(), "staging file outlived its guard");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn temp_upload_leaves_committed_file_alone() {
        let (store, base) = temp_store();
        store.ensure_user_dir("user1").expect("mkdir");
        let final_path = store.file_path("user1", "file1");
        {
            let temp = store.temp_upload("user1", "abc");
            std::fs::write(temp.path(), b"content").expect("write");
            std::fs::rename(temp.path(), &final_path).expect("rename");
            temp.commit();
        }
        assert_eq!(std::fs::read(&final_path).expect("read"), b"content");
        let _ = std::fs::remove_dir_all(base);
    }

    /// A panic between staging and commit unwinds through `Drop`, so the
    /// partial upload still goes away.
    #[test]
    fn temp_upload_is_removed_on_panic() {
        let (store, base) = temp_store();
        store.ensure_user_dir("user1").expect("mkdir");
        let path = store.temp_upload("user1", "abc").path().to_path_buf();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let temp = store.temp_upload("user1", "abc");
            std::fs::write(temp.path(), b"partial").expect("write");
            panic!("upload handler blew up");
        }));
        assert!(result.is_err());
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn sweep_removes_only_aged_temp_files() {
        let (store, base) = temp_store();
        store.ensure_user_dir("user1").expect("mkdir");
        store.ensure_user_dir("fonts").expect("mkdir");

        let stale = base.join("user1/tmp_stale");
        std::fs::write(&stale, b"orphaned by a crash").expect("write");
        let stale_font = base.join("fonts/tmp_stale_font");
        std::fs::write(&stale_font, b"orphan").expect("write");
        let fresh = base.join("user1/tmp_fresh");
        std::fs::write(&fresh, b"upload in flight").expect("write");
        // A real file whose name merely starts with the same letters.
        let real = base.join("user1/tmpfile-not-staging");
        std::fs::write(&real, b"keep me").expect("write");

        // Age the two orphans past the threshold.
        for p in [&stale, &stale_font] {
            age_file(p, Duration::from_secs(7200));
        }

        let report = store.sweep_temp_files(Duration::from_secs(3600));

        assert_eq!(report.removed, 2);
        assert_eq!(report.skipped, 1);
        assert_eq!(report.failed, 0);
        assert_eq!(report.bytes_freed, 25);
        assert!(!stale.exists());
        assert!(!stale_font.exists());
        assert!(fresh.exists(), "swept an upload that may still be in flight");
        assert!(real.exists(), "swept a committed file");
        let _ = std::fs::remove_dir_all(base);
    }

    /// Versions live in the file's own directory and are never staging files;
    /// the sweep must not descend into them.
    #[test]
    fn sweep_ignores_nested_directories() {
        let (store, base) = temp_store();
        store.ensure_file_dir("user1", "file1").expect("mkdir");
        let nested = base.join("user1/file1/tmp_looks_like_staging");
        std::fs::write(&nested, b"not a staging file").expect("write");
        age_file(&nested, Duration::from_secs(7200));

        let report = store.sweep_temp_files(Duration::from_secs(3600));

        assert_eq!(report, TempSweepReport::default());
        assert!(nested.exists());
        let _ = std::fs::remove_dir_all(base);
    }

    /// The disk half of #135: history shares the file's directory, so deleting
    /// the file for good has to take the directory, not the one blob
    /// `storage_path` names — otherwise every older version is stranded.
    #[test]
    fn remove_file_dir_takes_the_versions_with_it() {
        let (store, base) = temp_store();
        store.ensure_file_dir("user1", "file1").expect("mkdir");
        store.ensure_file_dir("user1", "file2").expect("mkdir");
        for version in ["v1", "v2", "v3"] {
            std::fs::write(store.version_path("user1", "file1", version), b"bytes").expect("write");
        }
        std::fs::write(store.version_path("user1", "file2", "v1"), b"bytes").expect("write");

        store.remove_file_dir("user1", "file1");

        assert!(!store.file_dir("user1", "file1").exists());
        assert!(store.version_path("user1", "file2", "v1").exists());
        // A second delete, and a file that never had content, are both no-ops.
        store.remove_file_dir("user1", "file1");
        store.remove_file_dir("user1", "never-uploaded");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn resolve_for_serving_accepts_file_key() {
        let (store, base) = temp_store();
        std::fs::create_dir_all(base.join("user1")).expect("mkdir");
        std::fs::write(base.join("user1/file1"), b"hi").expect("write");
        let path = store.resolve_for_serving("user1/file1").expect("resolve");
        assert_eq!(path, base.join("user1/file1"));
        let _ = std::fs::remove_dir_all(base);
    }
}
