// ── preferences::dto ──────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

/// Everything synced for the caller: the plain values they have set, and their sealed vault.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesResponse {
    /// Only keys the user has set; anything absent resolves to the registry default on the client.
    #[schema(value_type = Object)]
    pub values: Map<String, Value>,
    pub vault: Option<VaultResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VaultResponse {
    pub blob: String,
    pub updated_at: String,
}

/// Set or clear plain preferences. A `null` value clears the key back to its default.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchPreferencesRequest {
    #[schema(value_type = Object)]
    pub values: Map<String, Value>,
}

/// Replace the sealed vault.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutVaultRequest {
    /// base64url ciphertext, sealed to the caller's public key in the browser.
    pub blob: String,
    /// The `updatedAt` this write was based on, or `null` when the client saw no vault. A mismatch
    /// is a 409: another device wrote in between, and the client must re-read and merge.
    pub base_updated_at: Option<String>,
}
