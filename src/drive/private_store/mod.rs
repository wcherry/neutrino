use crate::shared::ApiError;
use std::path::{Component, Path, PathBuf};

/// A simple private file store rooted at `{storage_base}/.Private/`.
/// Apps store data by passing a relative sub-path (e.g. `diagrams/third_party/abc.xml`).
/// No drive files/folders table involvement — purely filesystem.
pub struct PrivateStore {
    base: PathBuf,
}

impl PrivateStore {
    pub fn new(storage_base: &std::path::Path) -> Result<Self, String> {
        let base = storage_base.join(".Private");
        std::fs::create_dir_all(&base)
            .map_err(|e| format!("Failed to create .Private directory: {}", e))?;
        Ok(Self { base })
    }

    /// Resolve `rel_path` under `.Private/`, rejecting any path traversal.
    ///
    /// Only the relative path's components are walked, and only plain names
    /// survive. `..` is rejected outright rather than popped: popping resolved
    /// `../../etc/passwd` to a path outside the store, so the containment the
    /// store is named for depended on no caller ever passing one. `/` and a
    /// Windows prefix are rejected for the same reason — `Path::join` discards
    /// the base entirely when the joined path is absolute.
    fn resolve(&self, rel_path: &str) -> Result<PathBuf, ApiError> {
        let mut resolved = self.base.clone();
        for component in Path::new(rel_path).components() {
            match component {
                Component::Normal(part) => resolved.push(part),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    tracing::warn!("private_store rejected path {:?}", rel_path);
                    return Err(ApiError::new(
                        400,
                        "INVALID_PATH",
                        "Path escapes the private store",
                    ));
                }
            }
        }
        // A path of nothing but `.` components resolves to the store root, and
        // every operation here is meant to address a file inside it.
        if resolved == self.base {
            tracing::warn!("private_store rejected empty path {:?}", rel_path);
            return Err(ApiError::new(
                400,
                "INVALID_PATH",
                "Path names no file in the private store",
            ));
        }
        Ok(resolved)
    }

    pub fn write(&self, rel_path: &str, content: &str) -> Result<(), ApiError> {
        let full = self.resolve(rel_path)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                tracing::error!("private_store create_dir_all {:?}: {:?}", parent, e);
                ApiError::internal("Failed to create private store directory")
            })?;
        }
        std::fs::write(&full, content.as_bytes()).map_err(|e| {
            tracing::error!("private_store write {:?}: {:?}", full, e);
            ApiError::internal("Failed to write to private store")
        })
    }

    pub fn read(&self, rel_path: &str) -> Result<String, ApiError> {
        let full = self.resolve(rel_path)?;
        std::fs::read_to_string(&full).map_err(|e| {
            tracing::error!("private_store read {:?}: {:?}", full, e);
            ApiError::internal("Failed to read from private store")
        })
    }

    pub fn delete(&self, rel_path: &str) -> Result<(), ApiError> {
        let full = self.resolve(rel_path)?;
        if full.exists() {
            std::fs::remove_file(&full).map_err(|e| {
                tracing::error!("private_store delete {:?}: {:?}", full, e);
                ApiError::internal("Failed to delete from private store")
            })?;
        }
        Ok(())
    }

    /// Byte-oriented counterpart to `write`, for callers holding ciphertext
    /// rather than text (search index snapshots).
    pub fn write_bytes(&self, rel_path: &str, content: &[u8]) -> Result<(), ApiError> {
        let full = self.resolve(rel_path)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                tracing::error!("private_store create_dir_all {:?}: {:?}", parent, e);
                ApiError::internal("Failed to create private store directory")
            })?;
        }
        std::fs::write(&full, content).map_err(|e| {
            tracing::error!("private_store write_bytes {:?}: {:?}", full, e);
            ApiError::internal("Failed to write to private store")
        })
    }

    pub fn read_bytes(&self, rel_path: &str) -> Result<Vec<u8>, ApiError> {
        let full = self.resolve(rel_path)?;
        std::fs::read(&full).map_err(|e| {
            tracing::error!("private_store read_bytes {:?}: {:?}", full, e);
            ApiError::internal("Failed to read from private store")
        })
    }

    pub fn exists(&self, rel_path: &str) -> bool {
        self.resolve(rel_path)
            .map(|full| full.exists())
            .unwrap_or(false)
    }

    /// Move a file within the store. Used to publish a staged upload only once
    /// the metadata write it belongs to has been accepted, so a rejected upload
    /// can never leave the live blob and its recorded version disagreeing.
    pub fn rename(&self, from_rel: &str, to_rel: &str) -> Result<(), ApiError> {
        let from = self.resolve(from_rel)?;
        let to = self.resolve(to_rel)?;
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                tracing::error!("private_store create_dir_all {:?}: {:?}", parent, e);
                ApiError::internal("Failed to create private store directory")
            })?;
        }
        std::fs::rename(&from, &to).map_err(|e| {
            tracing::error!("private_store rename {:?} -> {:?}: {:?}", from, to, e);
            ApiError::internal("Failed to move file in private store")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scratch directory that removes itself, so a failing assertion cannot
    /// leave a store behind in the system temp dir. The project has no
    /// `tempfile` dependency (see `search::service::tests` for the twin).
    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("neutrino-private-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("temp dir");
            TestDir(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn store() -> (PrivateStore, TestDir) {
        let dir = TestDir::new();
        let store = PrivateStore::new(&dir.0).expect("private store");
        (store, dir)
    }

    #[test]
    fn resolves_a_plain_relative_path_under_the_store_root() {
        let (store, dir) = store();

        let resolved = store
            .resolve("search/user-1/.search-index")
            .expect("resolve");

        assert_eq!(resolved, dir.0.join(".Private/search/user-1/.search-index"));
    }

    #[test]
    fn a_leading_dot_segment_is_ignored_rather_than_rejected() {
        let (store, dir) = store();

        let resolved = store.resolve("./diagrams/lib.xml").expect("resolve");

        assert_eq!(resolved, dir.0.join(".Private/diagrams/lib.xml"));
    }

    #[test]
    fn a_parent_segment_is_rejected_instead_of_escaping_the_store() {
        let (store, _dir) = store();

        for path in [
            "../escaped",
            "../../etc/passwd",
            "search/../../../etc/passwd",
            "search/user-1/../../../outside",
        ] {
            let err = store
                .resolve(path)
                .expect_err(&format!("{path} should be rejected"));
            assert_eq!(err.status, 400);
        }
    }

    #[test]
    fn an_absolute_path_is_rejected_instead_of_replacing_the_store_root() {
        let (store, _dir) = store();

        let err = store.resolve("/etc/passwd").expect_err("absolute rejected");

        assert_eq!(err.status, 400);
    }

    #[test]
    fn a_path_naming_no_file_is_rejected() {
        let (store, _dir) = store();

        for path in ["", ".", "./."] {
            let err = store
                .resolve(path)
                .expect_err(&format!("{path:?} should be rejected"));
            assert_eq!(err.status, 400);
        }
    }

    #[test]
    fn a_rejected_write_leaves_nothing_outside_the_store() {
        let (store, dir) = store();

        store
            .write("../escaped.txt", "payload")
            .expect_err("write rejected");

        assert!(!dir.0.join("escaped.txt").exists());
    }

    #[test]
    fn write_read_and_delete_round_trip_inside_the_store() {
        let (store, _dir) = store();

        store
            .write("diagrams/lib.xml", "<mxlibrary/>")
            .expect("write");
        assert!(store.exists("diagrams/lib.xml"));
        assert_eq!(
            store.read("diagrams/lib.xml").expect("read"),
            "<mxlibrary/>"
        );

        store.delete("diagrams/lib.xml").expect("delete");
        assert!(!store.exists("diagrams/lib.xml"));
    }
}
