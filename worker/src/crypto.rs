//! Reading encrypted job attachments.
//!
//! Files are stored by the main app as `nonce (12 bytes) || AES-256-GCM
//! ciphertext`. [`DecryptingStream`] exposes the decrypted plaintext as a
//! `std::io::Read` handle, and [`TempFileGuard`] guarantees the temp file is
//! removed once the worker is done with it.

use std::io::{self, Read};
use std::path::{Path, PathBuf};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};

const NONCE_SIZE: usize = 12;

/// A `Read` stream over an encrypted file. On construction it loads the file,
/// verifies and decrypts it, then serves the plaintext bytes.
pub struct DecryptingStream {
    plaintext: io::Cursor<Vec<u8>>,
}

impl DecryptingStream {
    /// Opens `path`, decrypts it with `key`, and returns a readable stream.
    pub fn open(path: &str, key: &[u8; 32]) -> Result<Self, String> {
        let data = std::fs::read(path).map_err(|e| format!("cannot read {path}: {e}"))?;
        if data.len() < NONCE_SIZE {
            return Err(format!("encrypted file {path} is too short"));
        }
        let (nonce_bytes, ciphertext) = data.split_at(NONCE_SIZE);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
        let plaintext = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| format!("failed to decrypt {path}"))?;
        Ok(Self {
            plaintext: io::Cursor::new(plaintext),
        })
    }
}

impl Read for DecryptingStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.plaintext.read(buf)
    }
}

/// Deletes the wrapped file when dropped, so a temp attachment is always removed
/// at the end of processing — on success, error, or panic.
pub struct TempFileGuard {
    path: PathBuf,
}

impl TempFileGuard {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if Path::new(&self.path).exists() {
            if let Err(e) = std::fs::remove_file(&self.path) {
                tracing::warn!("failed to delete temp file {}: {e}", self.path.display());
            }
        }
    }
}
