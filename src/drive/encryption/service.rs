use crate::shared::ApiError;
use crate::drive::encryption::{
    model::{FileKeyRef, NewFileKeyRef},
    repository::EncryptionRepository,
};
use crate::drive::permissions::service::PermissionsService;
use std::sync::Arc;
use uuid::Uuid;

pub struct EncryptionService {
    repo: Arc<EncryptionRepository>,
    permissions: Arc<PermissionsService>,
}

impl EncryptionService {
    pub fn new(repo: Arc<EncryptionRepository>, permissions: Arc<PermissionsService>) -> Self {
        EncryptionService { repo, permissions }
    }

    /// Store or update the caller's encrypted file key.
    /// The caller must have at least viewer-level access to the file.
    pub fn set_file_key(
        &self,
        caller_id: &str,
        file_id: &str,
        encrypted_file_key: &str,
    ) -> Result<FileKeyRef, ApiError> {
        // Caller must have access to the file.
        self.permissions
            .get_effective_role(caller_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;

        let id = Uuid::new_v4().to_string();
        self.repo.upsert_file_key(NewFileKeyRef {
            id: &id,
            file_id,
            user_id: caller_id,
            encrypted_file_key,
        })
    }

    /// Retrieve the caller's encrypted file key.
    pub fn get_file_key(&self, caller_id: &str, file_id: &str) -> Result<Option<FileKeyRef>, ApiError> {
        // Caller must have access to the file.
        self.permissions
            .get_effective_role(caller_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;

        self.repo.get_file_key(file_id, caller_id)
    }

    /// Share a file key with another user.
    /// `caller` must be owner or editor; the `encrypted_file_key` is the DEK
    /// already re-sealed by the client with `recipient_id`'s public key.
    pub fn share_file_key(
        &self,
        caller_id: &str,
        file_id: &str,
        recipient_id: &str,
        encrypted_file_key: &str,
    ) -> Result<FileKeyRef, ApiError> {
        let role = self.permissions
            .get_effective_role(caller_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;

        if role != "owner" && role != "editor" {
            return Err(ApiError::new(403, "FORBIDDEN", "Only owners and editors can share file keys"));
        }

        // The recipient must also have been granted permission to the file.
        self.permissions
            .get_effective_role(recipient_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(400, "RECIPIENT_NO_ACCESS", "Recipient does not have access to this file"))?;

        let id = Uuid::new_v4().to_string();
        self.repo.upsert_file_key(NewFileKeyRef {
            id: &id,
            file_id,
            user_id: recipient_id,
            encrypted_file_key,
        })
    }

    /// Delete the key ref for a user (called when permission is revoked).
    pub fn delete_file_key(&self, file_id: &str, user_id: &str) -> Result<(), ApiError> {
        self.repo.delete_file_key(file_id, user_id)
    }
}
