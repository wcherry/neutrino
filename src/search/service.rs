use crate::drive::private_store::PrivateStore;
use crate::search::dto::{SnapshotMetaResponse, UploadSnapshotParams};
use crate::search::repository::{SearchSnapshotRepository, SnapshotWrite, SnapshotWriteInput};
use crate::shared::ApiError;
use chrono::Utc;
use std::sync::Arc;

/// Outcome of an upload, so the API layer can answer 200 or 409 without a
/// second trip to the repository.
#[derive(Debug)]
pub enum UploadOutcome {
    Stored(SnapshotMetaResponse),
    Conflict { current_version: i32 },
}

pub struct SearchSnapshotService {
    repo: Arc<SearchSnapshotRepository>,
    store: Arc<PrivateStore>,
}

/// Where a user's snapshot lives inside the private store.
///
/// The leading dot follows `agent_docs/search.md`: the snapshot is machinery,
/// not a user document, and must never surface in a Drive listing. It is under
/// `.Private/` already, so this is belt and braces.
fn snapshot_path(user_id: &str) -> String {
    format!("search/{}/.search-index", user_id)
}

/// Staging path for an in-flight upload. The blob is written here first and
/// only moved into place once the version check passes, so a rejected upload
/// leaves the live snapshot untouched.
fn staging_path(user_id: &str) -> String {
    format!("search/{}/.search-index.incoming", user_id)
}

impl SearchSnapshotService {
    pub fn new(repo: Arc<SearchSnapshotRepository>, store: Arc<PrivateStore>) -> Self {
        Self { repo, store }
    }

    /// Snapshot metadata, or `None` when this user has never uploaded one.
    pub fn get_meta(&self, user_id: &str) -> Result<Option<SnapshotMetaResponse>, ApiError> {
        Ok(self.repo.find(user_id)?.map(SnapshotMetaResponse::from))
    }

    /// The raw ciphertext. The caller has already been authenticated as the
    /// owner; the server cannot decrypt this and does not try.
    pub fn download(&self, user_id: &str) -> Result<Vec<u8>, ApiError> {
        let record = self
            .repo
            .find(user_id)?
            .ok_or_else(|| ApiError::not_found("No search index snapshot stored"))?;

        let path = snapshot_path(user_id);
        if !self.store.exists(&path) {
            // Metadata without a blob: the row is useless, so drop it and let
            // the client upload afresh rather than retry a 500 forever.
            tracing::warn!(
                "search snapshot blob missing for user {} (version {}), dropping metadata",
                user_id,
                record.version
            );
            self.repo.delete(user_id)?;
            return Err(ApiError::not_found("No search index snapshot stored"));
        }

        self.store.read_bytes(&path)
    }

    /// Store a snapshot, rejecting the write when `expected_version` no longer
    /// matches what is stored.
    ///
    /// Order matters: the blob is staged, the metadata compare-and-swap runs,
    /// and only a winning swap publishes the blob. A loser's bytes are deleted
    /// and the live snapshot never moved.
    pub fn upload(
        &self,
        user_id: &str,
        params: &UploadSnapshotParams,
        ciphertext: &[u8],
    ) -> Result<UploadOutcome, ApiError> {
        if ciphertext.is_empty() {
            return Err(ApiError::bad_request("Snapshot body is empty"));
        }

        let staging = staging_path(user_id);
        self.store.write_bytes(&staging, ciphertext)?;

        let written = self.repo.upsert(
            user_id,
            SnapshotWriteInput {
                expected_version: params.expected_version,
                force: params.force,
                size_bytes: ciphertext.len() as i64,
                wrapped_key: &params.wrapped_key,
                device_id: params.device_id.as_deref(),
                updated_at: &Utc::now().to_rfc3339(),
            },
        );

        match written {
            Ok(SnapshotWrite::Stored(record)) => {
                self.store.rename(&staging, &snapshot_path(user_id))?;
                Ok(UploadOutcome::Stored(SnapshotMetaResponse::from(record)))
            }
            Ok(SnapshotWrite::Conflict { current_version }) => {
                let _ = self.store.delete(&staging);
                Ok(UploadOutcome::Conflict { current_version })
            }
            Err(e) => {
                let _ = self.store.delete(&staging);
                Err(e)
            }
        }
    }

    /// Drop the snapshot entirely. Local indexes are unaffected — this only
    /// removes what other devices would restore from.
    pub fn delete(&self, user_id: &str) -> Result<(), ApiError> {
        self.repo.delete(user_id)?;
        self.store.delete(&snapshot_path(user_id))?;
        let _ = self.store.delete(&staging_path(user_id));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::repository::{insert_test_user, test_pool};

    /// Scratch directory that removes itself, so a failing assertion cannot
    /// leave snapshots behind in the system temp dir. The project has no
    /// `tempfile` dependency and this is the only place that wants one.
    struct TestDir(std::path::PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("neutrino-search-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("temp dir");
            TestDir(path)
        }

        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn service() -> (SearchSnapshotService, TestDir) {
        let dir = TestDir::new();
        let store = Arc::new(PrivateStore::new(dir.path()).expect("private store"));
        let pool = test_pool();
        insert_test_user(&pool, "user-1");
        insert_test_user(&pool, "user-2");
        let repo = Arc::new(SearchSnapshotRepository::new(pool));
        (SearchSnapshotService::new(repo, store), dir)
    }

    fn params(expected: Option<i32>, force: bool) -> UploadSnapshotParams {
        UploadSnapshotParams {
            expected_version: expected,
            force,
            wrapped_key: "wrapped".to_string(),
            device_id: Some("device-a".to_string()),
        }
    }

    #[test]
    fn upload_then_download_round_trips_the_ciphertext() {
        let (svc, _dir) = service();
        svc.upload("user-1", &params(None, false), b"encrypted-index")
            .expect("upload");

        let back = svc.download("user-1").expect("download");
        assert_eq!(back, b"encrypted-index");
    }

    #[test]
    fn meta_reports_the_uploaded_size_and_version() {
        let (svc, _dir) = service();
        svc.upload("user-1", &params(None, false), b"0123456789")
            .expect("upload");

        let meta = svc.get_meta("user-1").expect("meta").expect("stored");
        assert_eq!(meta.version, 1);
        assert_eq!(meta.size_bytes, 10);
        assert_eq!(meta.device_id.as_deref(), Some("device-a"));
    }

    #[test]
    fn a_rejected_upload_leaves_the_stored_ciphertext_untouched() {
        // The clobbering guarantee: a device uploading against a stale version
        // must not have replaced the blob by the time it learns it lost.
        let (svc, _dir) = service();
        svc.upload("user-1", &params(None, false), b"good-index")
            .expect("first upload");
        svc.upload("user-1", &params(Some(1), false), b"better-index")
            .expect("second upload");

        let outcome = svc
            .upload("user-1", &params(Some(1), false), b"stale-index")
            .expect("stale upload");
        match outcome {
            UploadOutcome::Conflict { current_version } => assert_eq!(current_version, 2),
            UploadOutcome::Stored(_) => panic!("stale upload must be rejected"),
        }

        assert_eq!(svc.download("user-1").expect("download"), b"better-index");
    }

    #[test]
    fn force_replaces_the_stored_ciphertext() {
        let (svc, _dir) = service();
        svc.upload("user-1", &params(None, false), b"good-index")
            .expect("first upload");

        let outcome = svc
            .upload("user-1", &params(Some(99), true), b"forced-index")
            .expect("forced upload");
        match outcome {
            UploadOutcome::Stored(meta) => assert_eq!(meta.version, 2),
            UploadOutcome::Conflict { .. } => panic!("force must win"),
        }
        assert_eq!(svc.download("user-1").expect("download"), b"forced-index");
    }

    #[test]
    fn snapshots_are_isolated_per_user() {
        let (svc, _dir) = service();
        svc.upload("user-1", &params(None, false), b"mine")
            .expect("upload");
        svc.upload("user-2", &params(None, false), b"theirs")
            .expect("upload");

        assert_eq!(svc.download("user-1").expect("download"), b"mine");
        assert_eq!(svc.download("user-2").expect("download"), b"theirs");
    }

    #[test]
    fn download_without_a_snapshot_is_not_found() {
        let (svc, _dir) = service();
        let err = svc.download("user-1").expect_err("nothing stored");
        assert_eq!(err.status, 404);
    }

    #[test]
    fn an_empty_body_is_rejected_before_anything_is_written() {
        let (svc, _dir) = service();
        let err = svc
            .upload("user-1", &params(None, false), b"")
            .expect_err("empty");
        assert_eq!(err.status, 400);
        assert!(svc.get_meta("user-1").expect("meta").is_none());
    }

    #[test]
    fn delete_removes_both_the_metadata_and_the_blob() {
        let (svc, _dir) = service();
        svc.upload("user-1", &params(None, false), b"index")
            .expect("upload");

        svc.delete("user-1").expect("delete");

        assert!(svc.get_meta("user-1").expect("meta").is_none());
        assert_eq!(svc.download("user-1").expect_err("gone").status, 404);
    }

    #[test]
    fn a_missing_blob_drops_the_orphaned_metadata() {
        // Metadata surviving a blob (a wiped disk, a partial restore) would
        // otherwise leave every download failing forever.
        let (svc, dir) = service();
        svc.upload("user-1", &params(None, false), b"index")
            .expect("upload");
        std::fs::remove_file(dir.path().join(".Private/search/user-1/.search-index"))
            .expect("remove blob");

        assert_eq!(svc.download("user-1").expect_err("gone").status, 404);
        assert!(
            svc.get_meta("user-1").expect("meta").is_none(),
            "the orphaned row should be cleared so the client re-uploads"
        );
    }
}
