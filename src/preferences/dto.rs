// ── preferences::dto ──────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

/// Everything synced for the caller: the plain values they have set, their sealed vault, and the
/// layers under their own choices — the organisation's defaults and locks, and the defaults of
/// each team they belong to. The client resolves a key from these (`@neutrino/preferences`).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesResponse {
    /// Only keys the user has set; anything absent resolves to the registry default on the client.
    #[schema(value_type = Object)]
    pub values: Map<String, Value>,
    pub vault: Option<VaultResponse>,
    pub org: OrgLayer,
    /// Team id → that team's defaults, for every team the caller is a member of. They apply only
    /// inside the team's space.
    #[schema(value_type = Object)]
    pub teams: Map<String, Value>,
}

/// The organisation's layer: an administrator's defaults, and which of them are locked.
#[derive(Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrgLayer {
    #[schema(value_type = Object)]
    pub values: Map<String, Value>,
    /// Keys whose org value overrides any user or device value, and that users cannot set.
    pub locked: Vec<String>,
}

/// One org default as an administrator writes it.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrgPreferenceInput {
    #[schema(value_type = Object)]
    pub value: Value,
    #[serde(default)]
    pub locked: bool,
}

/// Set, lock, unlock or clear organisation defaults. `null` removes the default (and its lock).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchOrgPreferencesRequest {
    #[schema(value_type = Object)]
    pub values: Map<String, Value>,
}

/// A team's defaults.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamPreferencesResponse {
    #[schema(value_type = Object)]
    pub values: Map<String, Value>,
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
