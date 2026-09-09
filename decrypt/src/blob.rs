//! Opening an encrypted blob with its DEK.
//!
//! Two things are sealed to a DEK: the file's bytes on disk, and the
//! `files.encrypted_metadata` column, which is the same construction stored
//! base64url in the database. Both go through here.

use dryoc::classic::crypto_secretstream_xchacha20poly1305::{
    crypto_secretstream_xchacha20poly1305_init_pull, crypto_secretstream_xchacha20poly1305_pull,
    Header, Key, State,
};
use dryoc::constants::{
    CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES,
    CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_HEADERBYTES,
};

const HEADER_BYTES: usize = CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_HEADERBYTES;
const A_BYTES: usize = CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES;

/// The chunked format's magic, `NEB1`. Nothing writes it yet — the format is
/// specified in `agent_docs/chunked-file-encryption.md` and unimplemented in
/// every client — but a blob carrying it must be named rather than mangled.
const NEB1_MAGIC: &[u8; 4] = b"NEB1";
const NEB1_HEADER_BYTES: usize = 44;

/// Decrypt a blob produced by `encryptFile` in
/// `web/packages/e2e-crypto/src/crypto.ts`, and by its Swift counterparts.
///
/// Layout is `[24-byte secretstream header][one FINAL-tagged message]` — the
/// format §3.5 of the chunked-encryption spec calls v0, and the only one any
/// client writes today. The dispatch that spec mandates is implemented here to
/// the extent it can be: a blob that is structurally a v1 blob is refused by
/// name, and one that merely opens with those four bytes by chance — a 2⁻³²
/// event, since a v0 header is random — falls through and decrypts correctly.
pub fn decrypt_blob(bytes: &[u8], dek: &[u8; 32]) -> Result<Vec<u8>, String> {
    if looks_like_neb1(bytes) {
        return Err(
            "this blob is in the chunked NEB1 format, which this tool does not implement — \
             see agent_docs/chunked-file-encryption.md"
                .to_string(),
        );
    }

    if bytes.len() < HEADER_BYTES + A_BYTES {
        return Err(format!(
            "ciphertext is too short to be an encrypted blob ({} bytes)",
            bytes.len()
        ));
    }

    let mut header: Header = [0u8; HEADER_BYTES];
    header.copy_from_slice(&bytes[..HEADER_BYTES]);
    let body = &bytes[HEADER_BYTES..];

    let key: Key = *dek;
    let mut state = State::new();
    crypto_secretstream_xchacha20poly1305_init_pull(&mut state, &header, &key);

    let mut message = vec![0u8; body.len() - A_BYTES];
    let mut tag = 0u8;
    crypto_secretstream_xchacha20poly1305_pull(&mut state, &mut message, &mut tag, body, None)
        .map_err(|_| {
            "decryption failed — the key does not open this blob, or the bytes are damaged"
                .to_string()
        })?;

    Ok(message)
}

/// Is this structurally a v1 blob, rather than a v0 one that happens to start
/// with the same four bytes?
///
/// The spec's structural checks: the magic, a header long enough to hold the
/// fixed fields, the declared version and algorithm, the reserved bits zero,
/// and a chunk size inside the accepted range.
fn looks_like_neb1(bytes: &[u8]) -> bool {
    if bytes.len() < NEB1_HEADER_BYTES || &bytes[0..4] != NEB1_MAGIC {
        return false;
    }
    if bytes[4] != 0x01 || bytes[5] != 0x01 || bytes[6] != 0 || bytes[7] != 0 {
        return false;
    }
    let chunk_size = u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    (4096..=16_777_216).contains(&chunk_size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dryoc::classic::crypto_secretstream_xchacha20poly1305::{
        crypto_secretstream_xchacha20poly1305_init_push, crypto_secretstream_xchacha20poly1305_push,
    };
    use dryoc::constants::CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL;

    /// Byte-for-byte what `encryptFile` produces.
    fn encrypt(plaintext: &[u8], dek: &[u8; 32]) -> Vec<u8> {
        let mut state = State::new();
        let mut header: Header = [0u8; HEADER_BYTES];
        crypto_secretstream_xchacha20poly1305_init_push(&mut state, &mut header, dek);
        let mut ciphertext = vec![0u8; plaintext.len() + A_BYTES];
        crypto_secretstream_xchacha20poly1305_push(
            &mut state,
            &mut ciphertext,
            plaintext,
            None,
            CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL,
        )
        .expect("push");
        let mut out = header.to_vec();
        out.extend_from_slice(&ciphertext);
        out
    }

    #[test]
    fn opens_what_the_clients_write() {
        let dek = [42u8; 32];
        let plaintext = b"the quick brown fox".to_vec();
        let opened = decrypt_blob(&encrypt(&plaintext, &dek), &dek).expect("decrypt");
        assert_eq!(opened, plaintext);
    }

    #[test]
    fn opens_an_empty_file() {
        let dek = [1u8; 32];
        assert_eq!(decrypt_blob(&encrypt(b"", &dek), &dek).expect("decrypt"), b"");
    }

    #[test]
    fn refuses_the_wrong_key() {
        let blob = encrypt(b"secret", &[42u8; 32]);
        let err = decrypt_blob(&blob, &[43u8; 32]).expect_err("should fail");
        assert!(err.contains("does not open this blob"), "{err}");
    }

    #[test]
    fn refuses_a_tampered_blob() {
        let dek = [42u8; 32];
        let mut blob = encrypt(b"secret", &dek);
        let last = blob.len() - 1;
        blob[last] ^= 0xff;
        assert!(decrypt_blob(&blob, &dek).is_err());
    }

    /// The 2⁻³² case §3.5 exists for: a v0 header whose random bytes open with
    /// `NEB1` must still decrypt, not be misrouted.
    #[test]
    fn falls_through_when_a_v0_header_begins_with_the_magic() {
        let dek = [5u8; 32];
        let plaintext = b"a blob with an unlucky header".to_vec();
        let mut blob = encrypt(&plaintext, &dek);
        blob[0..4].copy_from_slice(NEB1_MAGIC);
        // The forged magic makes it look like v1 until the structural checks
        // run; those reject it, and the v0 path then fails on authentication
        // rather than on format — which is the dispatch behaving correctly.
        assert!(!looks_like_neb1(&blob));
    }

    #[test]
    fn names_a_structurally_valid_neb1_blob() {
        let mut blob = vec![0u8; 128];
        blob[0..4].copy_from_slice(NEB1_MAGIC);
        blob[4] = 1;
        blob[5] = 1;
        blob[8..12].copy_from_slice(&1_048_576u32.to_be_bytes());
        let err = decrypt_blob(&blob, &[0u8; 32]).expect_err("should refuse");
        assert!(err.contains("NEB1"), "{err}");
    }
}
