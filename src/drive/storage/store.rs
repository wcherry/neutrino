use std::path::{Path, PathBuf};

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

    pub fn temp_path(&self, user_id: &str, temp_id: &str) -> PathBuf {
        self.base_path.join(user_id).join(format!("tmp_{}", temp_id))
    }

    pub fn ensure_user_dir(&self, user_id: &str) -> Result<(), String> {
        std::fs::create_dir_all(self.base_path.join(user_id))
            .map_err(|e| format!("Failed to create user directory: {}", e))
    }

    pub fn ensure_versions_dir(&self, user_id: &str, file_id: &str) -> Result<(), String> {
        std::fs::create_dir_all(
            self.base_path
                .join(user_id)
                .join("versions")
                .join(file_id),
        )
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
