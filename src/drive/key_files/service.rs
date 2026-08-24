use crate::drive::encryption::repository::EncryptionRepository;
use crate::drive::key_files::dto::{
    ArchivedKey, KeyFileResponse, KeyVersionUsage, KeyVersionUsageResponse,
};
use crate::drive::private_store::PrivateStore;
use crate::shared::ApiError;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

/// A key file with more entries than this is a client bug, not a long-lived
/// account: retiring a key is a deliberate act, and nobody performs it
/// hundreds of times. The cap keeps one bad client from parking an unbounded
/// blob in the private store.
const MAX_KEYS: usize = 256;

/// A wrapped Curve25519 secret is ~100 bytes base64url. A kilobyte of headroom
/// covers any envelope a client might wrap around it; a megabyte would be
/// somebody storing something else here.
const MAX_ENCRYPTED_KEY_CHARS: usize = 4096;

/// Bumped only if the on-disk document changes shape. Stored so a future
/// reader can tell an old file from a corrupt one.
const KEY_FILE_FORMAT: i32 = 1;

/// The document as it sits on disk.
///
/// Note what is *not* in it: the user id. The path already says whose file it
/// is, and duplicating that inside would create a second source of truth that
/// a copy could put out of step with the first.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredKeyFile {
    format: i32,
    created_at: String,
    updated_at: String,
    keys: Vec<ArchivedKey>,
}

pub struct KeyFileService {
    store: Arc<PrivateStore>,
    encryption_repo: Arc<EncryptionRepository>,
}

/// Where a user's key file lives inside the private store.
///
/// The leading dot follows the search snapshot's convention: this is
/// machinery, not a user document, and must never surface in a listing. It is
/// under `.Private/` already, so this is belt and braces.
fn key_file_path(user_id: &str) -> String {
    format!("keys/{}/.keyfile", user_id)
}

/// Staging path for an in-flight write. The document is written here and moved
/// into place only once it is whole, so a failed write cannot leave a
/// half-truncated key file where the good one was — losing an old key means
/// losing every file still sealed to it.
fn staging_path(user_id: &str) -> String {
    format!("keys/{}/.keyfile.incoming", user_id)
}

impl KeyFileService {
    pub fn new(store: Arc<PrivateStore>, encryption_repo: Arc<EncryptionRepository>) -> Self {
        Self {
            store,
            encryption_repo,
        }
    }

    /// The caller's key file, or `None` when they have never stored one.
    pub fn get(&self, user_id: &str) -> Result<Option<KeyFileResponse>, ApiError> {
        let path = key_file_path(user_id);
        if !self.store.exists(&path) {
            return Ok(None);
        }
        let raw = self.store.read(&path)?;
        let stored = Self::parse(user_id, &raw)?;
        Ok(Some(Self::to_response(user_id, stored)))
    }

    /// Store the caller's key file, replacing any existing one.
    ///
    /// The whole set is replaced rather than merged: the client holds the
    /// authoritative keyring, and a merge would make dropping a retired key
    /// impossible through this API.
    pub fn upsert(
        &self,
        user_id: &str,
        keys: Vec<ArchivedKey>,
    ) -> Result<KeyFileResponse, ApiError> {
        let keys = Self::validate(keys)?;

        let now = Utc::now().to_rfc3339();
        // A replacement keeps the original creation time — the key file is one
        // long-lived document per user, not a new one on every rotation.
        let created_at = match self.get(user_id) {
            Ok(Some(existing)) => existing.created_at,
            // An unreadable existing file must not block the write that would
            // replace it, or a corrupt key file could only ever be deleted.
            Ok(None) | Err(_) => now.clone(),
        };

        let stored = StoredKeyFile {
            format: KEY_FILE_FORMAT,
            created_at,
            updated_at: now,
            keys,
        };

        let document = serde_json::to_string(&stored).map_err(|e| {
            tracing::error!("serialize key file for {}: {:?}", user_id, e);
            ApiError::internal("Failed to store the key file")
        })?;

        let staging = staging_path(user_id);
        self.store.write(&staging, &document)?;
        if let Err(e) = self.store.rename(&staging, &key_file_path(user_id)) {
            // Leaving the staged copy behind would shadow the next write's
            // freshness check and waste the space either way.
            let _ = self.store.delete(&staging);
            return Err(e);
        }

        Ok(Self::to_response(user_id, stored))
    }

    /// Discard the caller's key file. Idempotent — deleting one that is not
    /// there is the state the caller asked for.
    pub fn delete(&self, user_id: &str) -> Result<(), ApiError> {
        self.store.delete(&key_file_path(user_id))?;
        // A crashed write can leave this behind; it holds the same secrets.
        self.store.delete(&staging_path(user_id))
    }

    /// Which of the caller's files are sealed to which key version.
    ///
    /// Only files that still exist are counted: a permanently deleted file
    /// leaves its key ref behind, and counting those would tell a client an
    /// old key is still load bearing when nothing can be re-sealed with it.
    /// Trashed files *are* counted — they are restorable, and a restore of a
    /// file whose key was dropped restores nothing readable.
    pub fn usage(
        &self,
        user_id: &str,
        count_only: bool,
    ) -> Result<KeyVersionUsageResponse, ApiError> {
        let key_versions = if count_only {
            let mut counts = self.encryption_repo.count_files_by_key_version(user_id)?;
            counts.sort_by_key(|(version, _)| *version);
            counts
                .into_iter()
                .map(|(key_version, count)| KeyVersionUsage {
                    key_version,
                    count,
                    file_ids: Vec::new(),
                })
                .collect::<Vec<_>>()
        } else {
            // BTreeMap so versions come out ascending without a second sort,
            // and the per-version file order stays as the query returned it.
            let mut grouped: BTreeMap<i32, Vec<String>> = BTreeMap::new();
            for (key_version, file_id) in
                self.encryption_repo.list_file_ids_by_key_version(user_id)?
            {
                grouped.entry(key_version).or_default().push(file_id);
            }
            grouped
                .into_iter()
                .map(|(key_version, file_ids)| KeyVersionUsage {
                    key_version,
                    count: file_ids.len() as i64,
                    file_ids,
                })
                .collect()
        };

        Ok(KeyVersionUsageResponse {
            user_id: user_id.to_string(),
            count_only,
            total_files: key_versions.iter().map(|v| v.count).sum(),
            key_versions,
        })
    }

    fn parse(user_id: &str, raw: &str) -> Result<StoredKeyFile, ApiError> {
        serde_json::from_str::<StoredKeyFile>(raw).map_err(|e| {
            tracing::error!("stored key file for {} is unreadable: {:?}", user_id, e);
            ApiError::new(
                500,
                "KEY_FILE_UNREADABLE",
                "The stored key file could not be read. Replace it with a fresh upload.",
            )
        })
    }

    fn to_response(user_id: &str, stored: StoredKeyFile) -> KeyFileResponse {
        KeyFileResponse {
            user_id: user_id.to_string(),
            keys: stored.keys,
            created_at: stored.created_at,
            updated_at: stored.updated_at,
        }
    }

    /// Reject anything that would store a key file nothing can use, and sort
    /// the survivors so the stored document is deterministic.
    fn validate(mut keys: Vec<ArchivedKey>) -> Result<Vec<ArchivedKey>, ApiError> {
        if keys.is_empty() {
            return Err(ApiError::bad_request(
                "keys cannot be empty — delete the key file instead of storing one with no keys",
            ));
        }
        if keys.len() > MAX_KEYS {
            return Err(ApiError::bad_request(format!(
                "A key file holds at most {MAX_KEYS} keys"
            )));
        }

        keys.sort_by_key(|k| k.key_version);

        let mut previous: Option<i32> = None;
        for key in &keys {
            if key.key_version < 1 {
                return Err(ApiError::bad_request("keyVersion must be 1 or greater"));
            }
            if previous == Some(key.key_version) {
                // Two entries for one version means one of them is wrong, and
                // the server has no way to tell which.
                return Err(ApiError::bad_request(format!(
                    "Duplicate entry for key version {}",
                    key.key_version
                )));
            }
            if key.encrypted_key.is_empty() {
                return Err(ApiError::bad_request(format!(
                    "encryptedKey cannot be empty (key version {})",
                    key.key_version
                )));
            }
            if key.encrypted_key.len() > MAX_ENCRYPTED_KEY_CHARS {
                return Err(ApiError::bad_request(format!(
                    "encryptedKey for key version {} exceeds {MAX_ENCRYPTED_KEY_CHARS} characters",
                    key.key_version
                )));
            }
            previous = Some(key.key_version);
        }

        Ok(keys)
    }
}
