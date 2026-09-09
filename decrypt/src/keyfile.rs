//! The server-held key file, opened with the active key.
//!
//! A rotation mints a key the printed kit cannot contain — the entries are
//! independently random, so a kit predates every rotation after it. The key
//! file is the other half of that story: each retired secret sealed to the
//! *active* public key, parked in the private store so the server holds it
//! without being able to read it.
//!
//! Which makes it useful here in exactly one direction. A kit that carries the
//! current active key can recover older versions it never held, because they
//! are sealed to a key it does have. A kit printed before the last rotation
//! recovers nothing from it: the file is sealed to a key that kit does not
//! carry. There is no path back from a stale kit, by design.
//!
//! Written by `src/drive/key_files/service.rs`; the shape below is its
//! `StoredKeyFile`.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dryoc::classic::crypto_box::crypto_box_seal_open;
use dryoc::constants::CRYPTO_BOX_SEALBYTES;
use serde::Deserialize;

use crate::kit::{public_from_secret, Entry, Keyring};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredKeyFile {
    format: i32,
    keys: Vec<ArchivedKey>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchivedKey {
    key_version: i32,
    encrypted_key: String,
    #[serde(default)]
    public_key: Option<String>,
}

/// Where the key file sits under the storage root.
pub fn key_file_path(storage_root: &Path, user_id: &str) -> PathBuf {
    storage_root
        .join(".Private")
        .join("keys")
        .join(user_id)
        .join(".keyfile")
}

/// Fold every key the file yields into `keyring`.
///
/// Returns the versions actually recovered. An entry sealed to a version the
/// keyring does not hold is skipped rather than fatal: the file is a bundle,
/// and one unopenable member should not cost the caller the rest.
pub fn merge_key_file(
    keyring: &mut Keyring,
    storage_root: &Path,
    user_id: &str,
) -> Result<Vec<i32>, String> {
    let path = key_file_path(storage_root, user_id);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = std::fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let stored: StoredKeyFile = serde_json::from_slice(&raw)
        .map_err(|e| format!("{} is not a key file this tool understands: {e}", path.display()))?;
    if stored.format != 1 {
        return Err(format!(
            "{} is key file format {}, which this tool does not read",
            path.display(),
            stored.format
        ));
    }

    let active = keyring
        .active()
        .ok_or_else(|| "the keyring has no active key, so the key file cannot be opened".to_string())?
        .clone();

    let mut recovered = Vec::new();
    for key in stored.keys {
        if keyring.entry_for_version(key.key_version).is_some() {
            continue;
        }
        match open_archived_key(&key, &active) {
            Ok(entry) => {
                recovered.push(entry.version);
                keyring.insert(entry);
            }
            // Almost always a key file sealed to a version older than the one
            // in hand, which is the stale-kit case the header describes.
            Err(_) => continue,
        }
    }
    recovered.sort_unstable();
    Ok(recovered)
}

fn open_archived_key(key: &ArchivedKey, active: &Entry) -> Result<Entry, String> {
    let sealed = URL_SAFE_NO_PAD
        .decode(&key.encrypted_key)
        .map_err(|e| format!("key version {} is not valid base64url: {e}", key.key_version))?;
    if sealed.len() <= CRYPTO_BOX_SEALBYTES {
        return Err(format!("key version {} is too short", key.key_version));
    }

    let mut secret = vec![0u8; sealed.len() - CRYPTO_BOX_SEALBYTES];
    crypto_box_seal_open(&mut secret, &sealed, &active.public_key, &active.secret_key).map_err(
        |_| {
            format!(
                "key version {} was not sealed to key version {}",
                key.key_version, active.version
            )
        },
    )?;
    if secret.len() != 32 {
        return Err(format!("key version {} has the wrong length", key.key_version));
    }

    let mut secret_key = [0u8; 32];
    secret_key.copy_from_slice(&secret);
    let derived = public_from_secret(&secret_key);

    // The stored public half is a claim by whoever wrote the file. Checking it
    // against the secret is free and catches a swapped entry now rather than as
    // a file that mysteriously will not open.
    if let Some(claimed) = &key.public_key {
        if *claimed != URL_SAFE_NO_PAD.encode(derived) {
            return Err(format!(
                "key version {} does not match its stored public key",
                key.key_version
            ));
        }
    }

    Ok(Entry {
        version: key.key_version,
        public_key: derived,
        secret_key,
        retired: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kit::keyring_from_secret_key;
    use dryoc::classic::crypto_box::crypto_box_seal;

    fn seal(message: &[u8], recipient: &[u8; 32]) -> String {
        let mut ciphertext = vec![0u8; message.len() + CRYPTO_BOX_SEALBYTES];
        crypto_box_seal(&mut ciphertext, message, recipient).expect("seal");
        URL_SAFE_NO_PAD.encode(ciphertext)
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("neutrino-decrypt-{name}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write_key_file(root: &Path, user_id: &str, body: &str) {
        let path = key_file_path(root, user_id);
        std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
        std::fs::write(path, body).expect("write");
    }

    #[test]
    fn recovers_a_retired_key_sealed_to_the_active_one() {
        let dir = TempDir::new("recovers");
        let active_secret = [11u8; 32];
        let mut keyring = keyring_from_secret_key(active_secret, 2);
        let active_public = keyring.active().unwrap().public_key;

        let retired_secret = [4u8; 32];
        write_key_file(
            &dir.0,
            "user-1",
            &format!(
                r#"{{"format":1,"createdAt":"","updatedAt":"","keys":[{{"keyVersion":1,"encryptedKey":"{}"}}]}}"#,
                seal(&retired_secret, &active_public)
            ),
        );

        let recovered = merge_key_file(&mut keyring, &dir.0, "user-1").expect("merge");
        assert_eq!(recovered, vec![1]);
        assert_eq!(keyring.entry_for_version(1).unwrap().secret_key, retired_secret);
    }

    /// The stale-kit case: the file is sealed to a key this keyring never had,
    /// so nothing comes back — and that is not an error, it is the answer.
    #[test]
    fn recovers_nothing_when_the_kit_predates_the_rotation() {
        let dir = TempDir::new("stale");
        let mut keyring = keyring_from_secret_key([1u8; 32], 1);
        let someone_elses_public = public_from_secret(&[99u8; 32]);

        write_key_file(
            &dir.0,
            "user-1",
            &format!(
                r#"{{"format":1,"createdAt":"","updatedAt":"","keys":[{{"keyVersion":1,"encryptedKey":"{}"}}]}}"#,
                seal(&[4u8; 32], &someone_elses_public)
            ),
        );

        assert!(merge_key_file(&mut keyring, &dir.0, "user-1").expect("merge").is_empty());
    }

    #[test]
    fn a_missing_key_file_is_not_an_error() {
        let dir = TempDir::new("missing");
        let mut keyring = keyring_from_secret_key([1u8; 32], 1);
        assert!(merge_key_file(&mut keyring, &dir.0, "nobody").expect("merge").is_empty());
    }

    #[test]
    fn rejects_an_entry_whose_public_half_disagrees_with_its_secret() {
        let dir = TempDir::new("mismatch");
        let mut keyring = keyring_from_secret_key([11u8; 32], 2);
        let active_public = keyring.active().unwrap().public_key;

        write_key_file(
            &dir.0,
            "user-1",
            &format!(
                r#"{{"format":1,"createdAt":"","updatedAt":"","keys":[{{"keyVersion":1,"encryptedKey":"{}","publicKey":"{}"}}]}}"#,
                seal(&[4u8; 32], &active_public),
                URL_SAFE_NO_PAD.encode(public_from_secret(&[77u8; 32]))
            ),
        );

        assert!(merge_key_file(&mut keyring, &dir.0, "user-1").expect("merge").is_empty());
    }
}
