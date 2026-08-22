use crate::drive::encryption::service::EncryptionService;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, post, put, web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

pub struct EncryptionApiState {
    pub encryption_service: Arc<EncryptionService>,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetFileKeyRequest {
    /// Base64url-encoded sealed-box ciphertext of the DEK,
    /// sealed to the caller's own Curve25519 public key.
    pub encrypted_file_key: String,
    /// Which version of the caller's keyring the DEK was sealed to. Omitted by
    /// clients that predate key rotation, which only ever had version 1.
    #[serde(default = "default_key_version")]
    pub key_version: i32,
}

/// Clients written before rotation existed send no version, and everything they
/// sealed used the single identity that is now version 1.
fn default_key_version() -> i32 {
    1
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileKeyResponse {
    pub file_id: String,
    pub user_id: String,
    pub encrypted_file_key: String,
    /// Which version of `user_id`'s keyring opens `encrypted_file_key`.
    pub key_version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShareFileKeyRequest {
    /// User ID of the recipient.
    pub recipient_id: String,
    /// DEK sealed to the recipient's Curve25519 public key (base64url).
    pub encrypted_file_key: String,
    /// Which version of *the recipient's* keyring the DEK was sealed to.
    #[serde(default = "default_key_version")]
    pub key_version: i32,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Get the caller's encrypted file key for a file.
#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/key",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "Encrypted file key for the caller", body = FileKeyResponse),
        (status = 404, description = "No encrypted key found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-encryption"
)]
#[get("/files/{id}/key")]
pub async fn get_file_key(
    state: web::Data<EncryptionApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<FileKeyResponse>, ApiError> {
    let file_id = path.into_inner();
    let key_ref = state
        .encryption_service
        .get_file_key(&user.user_id, &file_id)?
        .ok_or_else(|| ApiError::not_found("No encrypted key found for this file"))?;

    Ok(web::Json(FileKeyResponse {
        file_id: key_ref.file_id,
        user_id: key_ref.user_id,
        encrypted_file_key: key_ref.encrypted_file_key,
        key_version: key_ref.key_version,
    }))
}

/// Store or update the caller's encrypted file key.
#[utoipa::path(
    put,
    path = "/api/v1/drive/files/{id}/key",
    params(("id" = String, Path, description = "File ID")),
    request_body = SetFileKeyRequest,
    responses(
        (status = 200, description = "Encrypted file key stored", body = FileKeyResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-encryption"
)]
#[put("/files/{id}/key")]
pub async fn set_file_key(
    state: web::Data<EncryptionApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SetFileKeyRequest>,
) -> Result<web::Json<FileKeyResponse>, ApiError> {
    let file_id = path.into_inner();
    let req = body.into_inner();

    if req.encrypted_file_key.is_empty() {
        return Err(ApiError::bad_request("encrypted_file_key cannot be empty"));
    }

    if req.key_version < 1 {
        return Err(ApiError::bad_request("key_version must be 1 or greater"));
    }

    let key_ref = state.encryption_service.set_file_key(
        &user.user_id,
        &file_id,
        &req.encrypted_file_key,
        req.key_version,
    )?;

    Ok(web::Json(FileKeyResponse {
        file_id: key_ref.file_id,
        user_id: key_ref.user_id,
        encrypted_file_key: key_ref.encrypted_file_key,
        key_version: key_ref.key_version,
    }))
}

/// Share a file key with another user.
/// The client seals the DEK with the recipient's public key before calling this.
#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/key/share",
    params(("id" = String, Path, description = "File ID")),
    request_body = ShareFileKeyRequest,
    responses(
        (status = 200, description = "File key shared with recipient", body = FileKeyResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-encryption"
)]
#[post("/files/{id}/key/share")]
pub async fn share_file_key(
    state: web::Data<EncryptionApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<ShareFileKeyRequest>,
) -> Result<web::Json<FileKeyResponse>, ApiError> {
    let file_id = path.into_inner();
    let req = body.into_inner();

    if req.encrypted_file_key.is_empty() || req.recipient_id.is_empty() {
        return Err(ApiError::bad_request(
            "recipient_id and encrypted_file_key are required",
        ));
    }

    if req.key_version < 1 {
        return Err(ApiError::bad_request("key_version must be 1 or greater"));
    }

    let key_ref = state.encryption_service.share_file_key(
        &user.user_id,
        &file_id,
        &req.recipient_id,
        &req.encrypted_file_key,
        req.key_version,
    )?;

    Ok(web::Json(FileKeyResponse {
        file_id: key_ref.file_id,
        user_id: key_ref.user_id,
        encrypted_file_key: key_ref.encrypted_file_key,
        key_version: key_ref.key_version,
    }))
}

/// Delete the caller's own key ref (e.g. on leaving a shared file).
#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{id}/key",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 204, description = "Encrypted key deleted"),
        (status = 404, description = "Key not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-encryption"
)]
#[delete("/files/{id}/key")]
pub async fn delete_file_key(
    state: web::Data<EncryptionApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    state
        .encryption_service
        .delete_file_key(&file_id, &user.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(get_file_key)
        .service(set_file_key)
        .service(share_file_key)
        .service(delete_file_key);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(get_file_key, set_file_key, share_file_key, delete_file_key),
    components(schemas(SetFileKeyRequest, FileKeyResponse, ShareFileKeyRequest)),
    tags((name = "drive-encryption", description = "Drive client-side encryption endpoints")),
    security(("bearer_auth" = []))
)]
pub struct EncryptionApiDoc;
