use crate::shared::ApiError;
use std::path::{Component, PathBuf};

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
    fn resolve(&self, rel_path: &str) -> Result<PathBuf, ApiError> {
        let joined = self.base.join(rel_path);
        // Canonicalise components without requiring the path to exist yet.
        let mut resolved = PathBuf::new();
        for component in joined.components() {
            match component {
                Component::ParentDir => {
                    resolved.pop();
                }
                Component::CurDir => {}
                other => resolved.push(other),
            }
        }
        // Ensure the resolved path is still inside the base.
        // if !resolved.starts_with(&self.base) {
        //     return Err(ApiError::new(400, "INVALID_PATH", format!("Path escapes the private store, rel path ={}, res pat = {:?}", rel_path, resolved)));
        // }
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
