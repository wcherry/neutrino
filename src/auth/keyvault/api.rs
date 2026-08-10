use crate::auth::keyvault::service::KeyVaultService;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, post, put, web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

pub struct KeyVaultApiState {
    pub key_vault_service: Arc<KeyVaultService>,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnlockMethodInput {
    /// One of `password`, `passkey`, `recovery`.
    pub method: String,
    /// User-facing name shown in settings, e.g. "MacBook passkey".
    #[serde(default)]
    pub label: String,
    /// base64url( nonce || ciphertext of the 32-byte master key ).
    pub encrypted_master_key: String,
    /// Method-specific JSON the client needs to redo the derivation:
    /// KDF salt and cost for password/recovery, credential ID and PRF salt for
    /// a passkey.
    pub params: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutVaultRequest {
    /// base64url( nonce || ciphertext of the Curve25519 secret key ), under the
    /// master key.
    pub encrypted_identity: String,
    /// base64url Curve25519 public key matching the wrapped secret.
    pub public_key: String,
    /// The unlock methods to enrol. Replaces any existing set.
    pub unlocks: Vec<UnlockMethodInput>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnlockMethodResponse {
    pub id: String,
    pub method: String,
    pub label: String,
    pub encrypted_master_key: String,
    pub params: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VaultResponse {
    pub encrypted_identity: String,
    pub public_key: String,
    pub version: i32,
    pub unlocks: Vec<UnlockMethodResponse>,
}

impl From<crate::auth::keyvault::model::UserKeyUnlock> for UnlockMethodResponse {
    fn from(u: crate::auth::keyvault::model::UserKeyUnlock) -> Self {
        UnlockMethodResponse {
            id: u.id,
            method: u.method,
            label: u.label,
            encrypted_master_key: u.encrypted_master_key,
            params: u.params,
            created_at: u.created_at.and_utc().to_rfc3339(),
            last_used_at: u.last_used_at.map(|t| t.and_utc().to_rfc3339()),
        }
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Fetch the caller's wrapped identity key and every enrolled unlock method.
#[utoipa::path(
    get,
    path = "/api/v1/auth/keyvault",
    responses(
        (status = 200, description = "The caller's key vault", body = VaultResponse),
        (status = 404, description = "No vault has been created yet"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth-keyvault"
)]
#[get("/keyvault")]
pub async fn get_vault(
    state: web::Data<KeyVaultApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<VaultResponse>, ApiError> {
    let bundle = state
        .key_vault_service
        .get_bundle(&user.user_id)?
        .ok_or_else(|| ApiError::not_found("No key vault for this user"))?;

    Ok(web::Json(VaultResponse {
        encrypted_identity: bundle.vault.encrypted_identity,
        public_key: bundle.vault.public_key,
        version: bundle.vault.version,
        unlocks: bundle.unlocks.into_iter().map(Into::into).collect(),
    }))
}

/// Create or replace the caller's vault along with its unlock methods.
#[utoipa::path(
    put,
    path = "/api/v1/auth/keyvault",
    request_body = PutVaultRequest,
    responses(
        (status = 200, description = "Vault stored", body = VaultResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth-keyvault"
)]
#[put("/keyvault")]
pub async fn put_vault(
    state: web::Data<KeyVaultApiState>,
    user: AuthenticatedUser,
    body: web::Json<PutVaultRequest>,
) -> Result<web::Json<VaultResponse>, ApiError> {
    let req = body.into_inner();
    let unlocks = req
        .unlocks
        .into_iter()
        .map(|u| (u.method, u.label, u.encrypted_master_key, u.params))
        .collect();

    let bundle = state.key_vault_service.put_vault(
        &user.user_id,
        &req.encrypted_identity,
        &req.public_key,
        unlocks,
    )?;

    Ok(web::Json(VaultResponse {
        encrypted_identity: bundle.vault.encrypted_identity,
        public_key: bundle.vault.public_key,
        version: bundle.vault.version,
        unlocks: bundle.unlocks.into_iter().map(Into::into).collect(),
    }))
}

/// Enrol an additional unlock method (a new passkey, say) against the vault.
#[utoipa::path(
    post,
    path = "/api/v1/auth/keyvault/unlocks",
    request_body = UnlockMethodInput,
    responses(
        (status = 200, description = "Unlock method enrolled", body = UnlockMethodResponse),
        (status = 400, description = "Invalid request"),
        (status = 404, description = "No vault has been created yet"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth-keyvault"
)]
#[post("/keyvault/unlocks")]
pub async fn add_unlock(
    state: web::Data<KeyVaultApiState>,
    user: AuthenticatedUser,
    body: web::Json<UnlockMethodInput>,
) -> Result<web::Json<UnlockMethodResponse>, ApiError> {
    let req = body.into_inner();
    let unlock = state.key_vault_service.add_unlock(
        &user.user_id,
        &req.method,
        &req.label,
        &req.encrypted_master_key,
        &req.params,
    )?;
    Ok(web::Json(unlock.into()))
}

/// Revoke an unlock method. Refused if it is the last one.
#[utoipa::path(
    delete,
    path = "/api/v1/auth/keyvault/unlocks/{id}",
    params(("id" = String, Path, description = "Unlock method ID")),
    responses(
        (status = 204, description = "Unlock method revoked"),
        (status = 400, description = "Cannot remove the only unlock method"),
        (status = 404, description = "Unlock method not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "auth-keyvault"
)]
#[delete("/keyvault/unlocks/{id}")]
pub async fn remove_unlock(
    state: web::Data<KeyVaultApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .key_vault_service
        .remove_unlock(&user.user_id, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Record that an unlock method was just used successfully.
#[utoipa::path(
    post,
    path = "/api/v1/auth/keyvault/unlocks/{id}/used",
    params(("id" = String, Path, description = "Unlock method ID")),
    responses((status = 204, description = "Recorded")),
    security(("bearer_auth" = [])),
    tag = "auth-keyvault"
)]
#[post("/keyvault/unlocks/{id}/used")]
pub async fn touch_unlock(
    state: web::Data<KeyVaultApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .key_vault_service
        .touch_unlock(&user.user_id, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(get_vault)
        .service(put_vault)
        .service(add_unlock)
        .service(remove_unlock)
        .service(touch_unlock);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(get_vault, put_vault, add_unlock, remove_unlock, touch_unlock),
    components(schemas(
        PutVaultRequest,
        UnlockMethodInput,
        UnlockMethodResponse,
        VaultResponse
    )),
    tags((name = "auth-keyvault", description = "Wrapped E2EE identity key storage")),
    security(("bearer_auth" = []))
)]
pub struct KeyVaultApiDoc;
