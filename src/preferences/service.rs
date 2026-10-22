// ── preferences::service ─────────────────────────────────────────────────────

use std::sync::Arc;

use chrono::Utc;
use serde_json::{Map, Value};

use super::catalog::{self, Spec};
use super::dto::{
    OrgLayer, OrgPreferenceInput, PatchOrgPreferencesRequest, PatchPreferencesRequest, PreferencesResponse,
    PutVaultRequest, TeamPreferencesResponse, VaultResponse,
};
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

/// Unknown keys are refused rather than dropped: a client writing one has a registry the server
/// does not, and saying so is the only way that gets noticed.
fn known(key: &str) -> Result<&'static Spec, ApiError> {
    catalog::spec(key)
        .ok_or_else(|| ApiError::new(400, "UNKNOWN_PREFERENCE", format!("{key} is not a synced preference")))
}

/// The value as stored JSON text, or the 400 that says what is wrong with it.
fn checked(spec: &Spec, value: &Value) -> Result<String, ApiError> {
    catalog::validate(spec, value)
        .map_err(|why| ApiError::new(400, "INVALID_PREFERENCE", format!("{} {why}", spec.key)))?;
    Ok(value.to_string())
}

/// A stored row as served, or `None` if it should not be.
///
/// A row for a key the catalog no longer declares, or no longer allows at this layer, is left
/// where it is but not served: the client would only drop it, and serving it would make it look
/// supported. A row that no longer validates (the catalog narrowed) is not served either, so a
/// client never resolves to a value the server would now refuse.
fn served(key: &str, raw: &str, layer_allows: impl Fn(&Spec) -> bool) -> Option<Value> {
    let spec = catalog::spec(key).filter(|s| layer_allows(s))?;
    match serde_json::from_str::<Value>(raw) {
        Ok(value) if catalog::validate(spec, &value).is_ok() => Some(value),
        Ok(_) => None,
        Err(e) => {
            tracing::warn!("unreadable stored preference {key}: {e}");
            None
        }
    }
}

impl PreferencesService {
    pub fn new(repo: Arc<PreferencesRepository>) -> Self {
        PreferencesService { repo }
    }

    pub fn get(&self, user: &AuthenticatedUser) -> Result<PreferencesResponse, ApiError> {
        let mut values = Map::new();
        for record in self.repo.list(&user.user_id)? {
            if let Some(value) = served(&record.key, &record.value, |s| s.scopes.user) {
                values.insert(record.key, value);
            }
        }
        let vault = self.repo.get_vault(&user.user_id)?.map(|v| VaultResponse {
            blob: v.blob,
            updated_at: v.updated_at,
        });
        let mut teams: Map<String, Value> = Map::new();
        for record in self.repo.list_teams_for_member(&user.user_id)? {
            if let Some(value) = served(&record.key, &record.value, |s| s.scopes.team) {
                let team = teams.entry(record.team_id).or_insert_with(|| Value::Object(Map::new()));
                if let Value::Object(map) = team {
                    map.insert(record.key, value);
                }
            }
        }
        Ok(PreferencesResponse { values, vault, org: self.org_layer()?, teams })
    }

    /// The organisation's defaults and locks — part of every user's read, and the admin's view.
    pub fn org_layer(&self) -> Result<OrgLayer, ApiError> {
        let mut layer = OrgLayer::default();
        for record in self.repo.list_org()? {
            if let Some(value) = served(&record.key, &record.value, |s| s.scopes.org) {
                if record.locked {
                    layer.locked.push(record.key.clone());
                }
                layer.values.insert(record.key, value);
            }
        }
        Ok(layer)
    }

    /// Keys an administrator has locked: a user can neither set them nor see their own value win.
    fn locked_keys(&self) -> Result<Vec<String>, ApiError> {
        Ok(self.repo.list_org()?.into_iter().filter(|r| r.locked).map(|r| r.key).collect())
    }

    pub fn patch(
        &self,
        user: &AuthenticatedUser,
        req: PatchPreferencesRequest,
    ) -> Result<PreferencesResponse, ApiError> {
        if req.values.len() > MAX_KEYS_PER_PATCH {
            return Err(ApiError::bad_request("Too many preferences in one request"));
        }
        let locked = self.locked_keys()?;
        let mut changes = Vec::with_capacity(req.values.len());
        for (key, value) in req.values {
            let spec = known(&key)?;
            if !spec.scopes.user {
                return Err(ApiError::new(
                    400,
                    "NOT_A_USER_PREFERENCE",
                    format!("{key} is set by an administrator, not per user"),
                ));
            }
            if value.is_null() {
                // Clearing a locked key is harmless — the lock wins either way — and lets a
                // client that cached an old value tidy up.
                changes.push((key, None));
                continue;
            }
            if locked.contains(&key) {
                return Err(ApiError::new(403, "PREFERENCE_LOCKED", format!("{key} is set by your organisation")));
            }
            changes.push((key, Some(checked(spec, &value)?)));
        }
        if !changes.is_empty() {
            self.repo.apply(&user.user_id, &changes, &now())?;
        }
        self.get(user)
    }

    /// An administrator sets, locks, unlocks or clears organisation defaults. All or nothing, as
    /// for a user PATCH; only keys whose scopes include `org` are accepted.
    pub fn patch_org(&self, admin_id: &str, req: PatchOrgPreferencesRequest) -> Result<OrgLayer, ApiError> {
        if req.values.len() > MAX_KEYS_PER_PATCH {
            return Err(ApiError::bad_request("Too many preferences in one request"));
        }
        let mut changes = Vec::with_capacity(req.values.len());
        for (key, entry) in req.values {
            let spec = known(&key)?;
            if !spec.scopes.org {
                return Err(ApiError::new(
                    400,
                    "NOT_AN_ORG_PREFERENCE",
                    format!("{key} cannot be given an organisation default"),
                ));
            }
            if entry.is_null() {
                changes.push((key, None));
                continue;
            }
            let input: OrgPreferenceInput = serde_json::from_value(entry)
                .map_err(|_| ApiError::bad_request(format!("{key} must be {{ \"value\": …, \"locked\": bool }} or null")))?;
            changes.push((key, Some((checked(spec, &input.value)?, input.locked))));
        }
        if !changes.is_empty() {
            self.repo.apply_org(&changes, admin_id, &now())?;
        }
        self.org_layer()
    }

    pub fn team_defaults(&self, team_id: &str) -> Result<TeamPreferencesResponse, ApiError> {
        let mut values = Map::new();
        for record in self.repo.list_team(team_id)? {
            if let Some(value) = served(&record.key, &record.value, |s| s.scopes.team) {
                values.insert(record.key, value);
            }
        }
        Ok(TeamPreferencesResponse { values })
    }

    /// A team's Owner or Admin sets or clears its defaults. The caller has already been authorised
    /// for `TeamAction::ManageSettings` by the teams service; this only validates and stores.
    pub fn patch_team(
        &self,
        team_id: &str,
        by: &str,
        req: PatchPreferencesRequest,
    ) -> Result<TeamPreferencesResponse, ApiError> {
        if req.values.len() > MAX_KEYS_PER_PATCH {
            return Err(ApiError::bad_request("Too many preferences in one request"));
        }
        let mut changes = Vec::with_capacity(req.values.len());
        for (key, value) in req.values {
            let spec = known(&key)?;
            if !spec.scopes.team {
                return Err(ApiError::new(
                    400,
                    "NOT_A_TEAM_PREFERENCE",
                    format!("{key} cannot be given a team default"),
                ));
            }
            if value.is_null() {
                changes.push((key, None));
            } else {
                changes.push((key, Some(checked(spec, &value)?)));
            }
        }
        if !changes.is_empty() {
            self.repo.apply_team(team_id, &changes, by, &now())?;
        }
        self.team_defaults(team_id)
    }

    /// Everyone a change to `team_id`'s defaults should reach.
    pub fn team_member_ids(&self, team_id: &str) -> Result<Vec<String>, ApiError> {
        self.repo.team_member_ids(team_id)
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
