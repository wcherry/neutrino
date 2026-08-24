use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// One key inside the key file.
///
/// `encrypted_key` is opaque to the server: whatever the client wrapped the
/// secret with, base64url-encoded. It is stored and handed back verbatim.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedKey {
    /// The `user_public_keys.version` this entry unwraps to.
    pub key_version: i32,
    /// The wrapped secret key, base64url. Never plaintext — the server cannot
    /// read this and does not try.
    pub encrypted_key: String,
    /// Optional base64url public key of the pair, so a client can match an
    /// entry against a keyring without unwrapping it first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutKeyFileRequest {
    /// The full set of keys to store. This replaces the stored file rather
    /// than merging into it — a client that drops an entry here has dropped it
    /// from the key file, which is how a key is *meant* to be retired.
    pub keys: Vec<ArchivedKey>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyFileResponse {
    pub user_id: String,
    /// Ascending by `key_version`, whatever order they were sent in.
    pub keys: Vec<ArchivedKey>,
    pub created_at: String,
    pub updated_at: String,
}

/// How many of the caller's files one key version still holds open.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyVersionUsage {
    pub key_version: i32,
    pub count: i64,
    /// Empty when `countOnly` was set — the shape stays the same either way, so
    /// a client can parse one response type. `count` is authoritative; this
    /// list being empty does not mean the version is unused.
    pub file_ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyVersionUsageResponse {
    pub user_id: String,
    /// Echoes the request flag, so a caller handed this response second-hand
    /// can tell an omitted `fileIds` from an empty one.
    pub count_only: bool,
    pub total_files: i64,
    /// Ascending by `key_version`. A version with no files is absent, not zero.
    pub key_versions: Vec<KeyVersionUsage>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct KeyVersionUsageParams {
    /// Return counts only, leaving every `fileIds` empty. Accepts `count_only`
    /// as well, for callers written against the snake_case spelling.
    #[serde(default, alias = "count_only")]
    pub count_only: bool,
}
