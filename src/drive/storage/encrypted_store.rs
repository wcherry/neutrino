#![allow(dead_code)]

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use aes_gcm::aead::rand_core::RngCore;
use std::path::PathBuf;

use crate::drive::storage::store::LocalFileStore;
use crate::shared::ApiError;

const NONCE_SIZE: usize = 12; // 96-bit nonce for AES-256-GCM

pub struct EncryptedFileStore {
    inner: LocalFileStore,
    key: Key<Aes256Gcm>,
}

impl EncryptedFileStore {
    pub fn new(inner: LocalFileStore, key_bytes: [u8; 32]) -> Self {
        let key = Key::<Aes256Gcm>::from(key_bytes);
        EncryptedFileStore { inner, key }
    }

    /// Load the encryption key from `STORAGE_ENCRYPTION_KEY` env var (base64-encoded 32 bytes).
    pub fn load_key() -> Option<[u8; 32]> {
        let encoded = std::env::var("STORAGE_ENCRYPTION_KEY").ok()?;
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &encoded).ok()?;
        if bytes.len() != 32 {
            tracing::warn!("STORAGE_ENCRYPTION_KEY must be exactly 32 bytes (base64-encoded)");
            return None;
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Some(key)
    }

    /// Encrypt `plaintext` and write `nonce || ciphertext` to `path`.
    pub fn encrypt_to_file(&self, path: &PathBuf, plaintext: &[u8]) -> Result<(), ApiError> {
        let cipher = Aes256Gcm::new(&self.key);
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| {
            tracing::error!("Encryption error: {:?}", e);
            ApiError::internal("Failed to encrypt file data")
        })?;

        let mut out = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        std::fs::write(path, out).map_err(|e| {
            tracing::error!("File write error: {:?}", e);
            ApiError::internal("Failed to write encrypted file")
        })
    }

    /// Read `nonce || ciphertext` from `path` and return decrypted plaintext.
    pub fn decrypt_from_file(&self, path: &PathBuf) -> Result<Vec<u8>, ApiError> {
        let data = std::fs::read(path).map_err(|e| {
            tracing::error!("File read error: {:?}", e);
            ApiError::internal("Failed to read encrypted file")
        })?;

        if data.len() < NONCE_SIZE {
            return Err(ApiError::internal("Encrypted file is too short"));
        }

        let (nonce_bytes, ciphertext) = data.split_at(NONCE_SIZE);
        let nonce = Nonce::from_slice(nonce_bytes);
        let cipher = Aes256Gcm::new(&self.key);

        cipher.decrypt(nonce, ciphertext).map_err(|e| {
            tracing::error!("Decryption error: {:?}", e);
            ApiError::internal("Failed to decrypt file data")
        })
    }

    pub fn inner(&self) -> &LocalFileStore {
        &self.inner
    }
}
