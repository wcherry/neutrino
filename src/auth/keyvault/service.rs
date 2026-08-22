use crate::auth::keyvault::model::{
    is_singleton_method, is_valid_method, NewUserKeyUnlock, NewUserKeyVault, UserKeyUnlock,
    UserKeyVault,
};
use crate::auth::keyvault::repository::KeyVaultRepository;
use crate::auth::repository::AuthRepository;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct KeyVaultService {
    repo: Arc<KeyVaultRepository>,
    auth_repo: Arc<AuthRepository>,
}

/// What the client needs to attempt an unlock: the wrapped identity plus every
/// enrolled method's wrapped master key.
pub struct VaultBundle {
    pub vault: UserKeyVault,
    pub unlocks: Vec<UserKeyUnlock>,
}

impl KeyVaultService {
    pub fn new(repo: Arc<KeyVaultRepository>, auth_repo: Arc<AuthRepository>) -> Self {
        KeyVaultService { repo, auth_repo }
    }

    pub fn get_bundle(&self, user_id: &str) -> Result<Option<VaultBundle>, ApiError> {
        let Some(vault) = self.repo.get_vault(user_id)? else {
            return Ok(None);
        };
        let unlocks = self.repo.list_unlocks(user_id)?;
        Ok(Some(VaultBundle { vault, unlocks }))
    }

    /// Create or replace a user's vault.
    ///
    /// Replacing means the identity key changed, so every previously enrolled
    /// method now wraps a master key that opens nothing. They are deleted here
    /// rather than left to fail confusingly at unlock time — the caller sends
    /// the replacement methods in the same request.
    pub fn put_vault(
        &self,
        user_id: &str,
        encrypted_identity: &str,
        public_key: &str,
        unlocks: Vec<(String, String, String, String)>,
    ) -> Result<VaultBundle, ApiError> {
        if encrypted_identity.is_empty() || public_key.is_empty() {
            return Err(ApiError::bad_request(
                "encryptedIdentity and publicKey are required",
            ));
        }
        if unlocks.is_empty() {
            return Err(ApiError::bad_request(
                "At least one unlock method is required — a vault with none can never be opened",
            ));
        }
        for (method, _, _, _) in &unlocks {
            if !is_valid_method(method) {
                return Err(ApiError::bad_request(format!(
                    "Unknown unlock method '{method}'"
                )));
            }
        }

        let vault = self.repo.upsert_vault(NewUserKeyVault {
            user_id,
            encrypted_identity,
            public_key,
            version: 1,
        })?;

        // The old methods wrap a master key for the previous identity.
        self.repo.delete_all_unlocks(user_id)?;

        let mut stored = Vec::with_capacity(unlocks.len());
        for (method, label, encrypted_master_key, params) in unlocks {
            let id = Uuid::new_v4().to_string();
            stored.push(self.repo.insert_unlock(NewUserKeyUnlock {
                id: &id,
                user_id,
                method: &method,
                label: &label,
                encrypted_master_key: &encrypted_master_key,
                params: &params,
            })?);
        }

        // Keep the published keyring in step so sharing and the vault never
        // disagree about which key a recipient should be sealed to.
        //
        // `publish_public_key` is append-only and idempotent: storing a vault
        // whose identity is unchanged returns the existing version, while
        // `replaceIdentity` — the one path that swaps the key underneath a live
        // vault — mints the next one and retires its predecessor, leaving files
        // sealed to the old key still resolvable by version.
        self.auth_repo.publish_public_key(user_id, public_key)?;

        Ok(VaultBundle {
            vault,
            unlocks: stored,
        })
    }

    /// Enrol an additional unlock method against the existing vault.
    pub fn add_unlock(
        &self,
        user_id: &str,
        method: &str,
        label: &str,
        encrypted_master_key: &str,
        params: &str,
    ) -> Result<UserKeyUnlock, ApiError> {
        if !is_valid_method(method) {
            return Err(ApiError::bad_request(format!(
                "Unknown unlock method '{method}'"
            )));
        }
        if encrypted_master_key.is_empty() {
            return Err(ApiError::bad_request("encryptedMasterKey is required"));
        }
        if self.repo.get_vault(user_id)?.is_none() {
            return Err(ApiError::not_found(
                "No key vault for this user — create one before adding unlock methods",
            ));
        }

        if is_singleton_method(method) {
            self.repo.delete_unlocks_by_method(user_id, method)?;
        }

        let id = Uuid::new_v4().to_string();
        self.repo.insert_unlock(NewUserKeyUnlock {
            id: &id,
            user_id,
            method,
            label,
            encrypted_master_key,
            params,
        })
    }

    /// Revoke an unlock method.
    ///
    /// Refuses to remove the last one: the master key exists only inside these
    /// rows, so deleting the final copy destroys every file the user has.
    pub fn remove_unlock(&self, user_id: &str, unlock_id: &str) -> Result<(), ApiError> {
        let unlocks = self.repo.list_unlocks(user_id)?;
        if !unlocks.iter().any(|u| u.id == unlock_id) {
            return Err(ApiError::not_found("Unlock method not found"));
        }
        if unlocks.len() <= 1 {
            return Err(ApiError::bad_request(
                "Cannot remove the only unlock method — add another one first, \
                 or you would permanently lose access to your files",
            ));
        }
        self.repo.delete_unlock(unlock_id, user_id)?;
        Ok(())
    }

    /// Record a successful unlock so settings can show "last used".
    pub fn touch_unlock(&self, user_id: &str, unlock_id: &str) -> Result<(), ApiError> {
        self.repo.touch_unlock(unlock_id, user_id)
    }
}
