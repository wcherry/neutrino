use std::path::{Path, PathBuf};

/// Reasons a storage key cannot be safely resolved into a servable file path.
#[derive(Debug, PartialEq, Eq)]
pub enum ServeResolveError {
    /// The key is empty (e.g. a placeholder record with no uploaded content).
    EmptyKey,
    /// The key resolves to a directory rather than a file.
    IsDirectory,
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

    /// Absolute path to the file on disk — use for filesystem operations.
    pub fn file_path(&self, user_id: &str, file_id: &str) -> PathBuf {
        self.base_path.join(user_id).join(file_id)
    }

    /// Relative key stored in the database (independent of STORAGE_PATH).
    pub fn file_key(&self, user_id: &str, file_id: &str) -> String {
        format!("{}/{}", user_id, file_id)
    }

    /// Absolute path to a version snapshot on disk — use for filesystem operations.
    pub fn version_path(&self, user_id: &str, file_id: &str, version_id: &str) -> PathBuf {
        self.base_path
            .join(user_id)
            .join("versions")
            .join(file_id)
            .join(version_id)
    }

    /// Relative key for a version snapshot stored in the database.
    pub fn version_key(&self, user_id: &str, file_id: &str, version_id: &str) -> String {
        format!("{}/versions/{}/{}", user_id, file_id, version_id)
    }

    /// Resolve a relative DB key to its absolute path using STORAGE_PATH.
    pub fn resolve(&self, key: &str) -> PathBuf {
        self.base_path.join(key)
    }

    /// Resolve a relative DB key to a path safe to hand to a file streamer.
    ///
    /// Guards against two hazards that otherwise crash the response stream
    /// with `IsADirectory (Os code 21)`:
    /// 1. An empty `key` (placeholder records created before content upload)
    ///    would resolve to the storage root directory via `join("")`.
    /// 2. Any key that resolves to a directory rather than a file.
    ///
    /// Returns `Err` if the resolved path would be a directory or the key is
    /// empty, so callers can surface a meaningful client error.
    pub fn resolve_for_serving(&self, key: &str) -> Result<PathBuf, ServeResolveError> {
        if key.is_empty() {
            return Err(ServeResolveError::EmptyKey);
        }
        let path = self.base_path.join(key);
        if path.is_dir() {
            return Err(ServeResolveError::IsDirectory);
        }
        Ok(path)
    }

    pub fn temp_path(&self, user_id: &str, temp_id: &str) -> PathBuf {
        self.base_path
            .join(user_id)
            .join(format!("tmp_{}", temp_id))
    }

    pub fn ensure_user_dir(&self, user_id: &str) -> Result<(), String> {
        std::fs::create_dir_all(self.base_path.join(user_id))
            .map_err(|e| format!("Failed to create user directory: {}", e))
    }

    pub fn ensure_versions_dir(&self, user_id: &str, file_id: &str) -> Result<(), String> {
        std::fs::create_dir_all(self.base_path.join(user_id).join("versions").join(file_id))
            .map_err(|e| format!("Failed to create versions directory: {}", e))
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
