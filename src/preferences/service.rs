// ── preferences::service ─────────────────────────────────────────────────────

use std::sync::Arc;

use chrono::Utc;
use serde_json::{Map, Value};

use super::catalog;
use super::dto::{PatchPreferencesRequest, PreferencesResponse, PutVaultRequest, VaultResponse};
use super::repository::{PreferencesRepository, VaultWrite};
use crate::shared::{ApiError, AuthenticatedUser};

/// More keys than the registry declares in one PATCH is not a client this app wrote.
const MAX_KEYS_PER_PATCH: usize = 64;

/// The sealed vault holds an API key and personal libraries. 1 MiB of base64 is far beyond what
/// those reach and still small enough that one user cannot fill the database with it.
const MAX_VAULT_CHARS: usize = 1024 * 1024;

pub struct PreferencesService {
    repo: Arc<PreferencesRepository>,
}

/// Microseconds, not seconds: `updated_at` is the vault's version, and two writes inside one
/// second sharing a version is how a conflict would go unnoticed.
fn now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string()
}

fn is_base64url(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

impl PreferencesService {
    pub fn new(repo: Arc<PreferencesRepository>) -> Self {
        PreferencesService { repo }
    }

    pub fn get(&self, user: &AuthenticatedUser) -> Result<PreferencesResponse, ApiError> {
        let mut values = Map::new();
        for record in self.repo.list(&user.user_id)? {
            // A row for a key the catalog no longer declares is left where it is but not served:
            // the client would only drop it, and serving it would make it look supported.
            if catalog::spec(&record.key).is_none() {
                continue;
            }
            match serde_json::from_str::<Value>(&record.value) {
                Ok(value) => {
                    values.insert(record.key, value);
                }
                Err(e) => tracing::warn!("unreadable preference {} for {}: {e}", record.key, user.user_id),
            }
        }
        let vault = self.repo.get_vault(&user.user_id)?.map(|v| VaultResponse {
            blob: v.blob,
            updated_at: v.updated_at,
        });
        Ok(PreferencesResponse { values, vault })
    }

    pub fn patch(
        &self,
        user: &AuthenticatedUser,
        req: PatchPreferencesRequest,
    ) -> Result<PreferencesResponse, ApiError> {
        if req.values.len() > MAX_KEYS_PER_PATCH {
            return Err(ApiError::bad_request("Too many preferences in one request"));
        }
        let mut changes = Vec::with_capacity(req.values.len());
        for (key, value) in req.values {
            // Unknown keys are refused rather than dropped: a client writing one has a registry
            // the server does not, and saying so is the only way that gets noticed.
            let spec = catalog::spec(&key).ok_or_else(|| {
                ApiError::new(400, "UNKNOWN_PREFERENCE", format!("{key} is not a synced preference"))
            })?;
            if value.is_null() {
                changes.push((key, None));
                continue;
            }
            catalog::validate(spec, &value)
                .map_err(|why| ApiError::new(400, "INVALID_PREFERENCE", format!("{key} {why}")))?;
            changes.push((key, Some(value.to_string())));
        }
        if !changes.is_empty() {
            self.repo.apply(&user.user_id, &changes, &now())?;
        }
        self.get(user)
    }

    pub fn put_vault(&self, user: &AuthenticatedUser, req: PutVaultRequest) -> Result<VaultResponse, ApiError> {
        if req.blob.is_empty() || req.blob.len() > MAX_VAULT_CHARS || !is_base64url(&req.blob) {
            return Err(ApiError::bad_request("The vault must be base64url ciphertext of at most 1 MiB"));
        }
        let at = now();
        match self.repo.put_vault(&user.user_id, &req.blob, req.base_updated_at.as_deref(), &at)? {
            VaultWrite::Written(updated_at) => Ok(VaultResponse { blob: req.blob, updated_at }),
            VaultWrite::Conflict(current) => Err(ApiError::new(
                409,
                "VAULT_CONFLICT",
                format!(
                    "The vault changed on another device (now {}); re-read it and merge",
                    current.as_deref().unwrap_or("absent")
                ),
            )),
        }
    }
}
