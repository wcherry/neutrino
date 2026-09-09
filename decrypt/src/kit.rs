//! The recovery kit, read back.
//!
//! The printed kit is not a hint that unlocks a key held elsewhere — it *is*
//! the keyring: every Curve25519 secret key the account has ever held, packed
//! into a binary frame and rendered in Crockford base32. Holding it is holding
//! the keys, which is why this file is the whole of what the tool needs to
//! open a user's files and why a kit must be handled like the key material it
//! is.
//!
//! The frame is defined by `web/packages/e2e-crypto/src/recoveryKit.ts` and
//! this is a transcription of its decoder. It must stay a transcription: a
//! divergence here does not fail loudly, it produces a subtly wrong key and a
//! file that "will not decrypt".

use dryoc::classic::crypto_core::crypto_scalarmult_base;

/// Crockford base32 — no I, L, O or U.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const MAGIC: u8 = 0x4e; // 'N'
const FORMAT_VERSION: u8 = 1;
const SECRET_KEY_BYTES: usize = 32;
const ENTRY_BYTES: usize = 2 /* version */ + SECRET_KEY_BYTES + 1 /* flags */;
const FLAG_RETIRED: u8 = 0x01;

/// One identity keypair. The public half is derived rather than carried, for
/// the same reason `keyring.ts` derives it: a stored public key can disagree
/// with its secret, and nothing would catch that until a file failed to open.
#[derive(Clone)]
pub struct Entry {
    pub version: i32,
    pub public_key: [u8; 32],
    pub secret_key: [u8; 32],
    pub retired: bool,
}

pub struct Keyring {
    /// Ascending by version.
    pub entries: Vec<Entry>,
}

impl Keyring {
    /// The entry a DEK sealed at `version` needs, or `None` if the kit predates
    /// the rotation that minted it.
    pub fn entry_for_version(&self, version: i32) -> Option<&Entry> {
        self.entries.iter().find(|e| e.version == version)
    }

    /// The entry new work is sealed to — and the only one that can open the
    /// server-held key file.
    pub fn active(&self) -> Option<&Entry> {
        self.entries.iter().find(|e| !e.retired)
    }

    /// Adopt a key recovered from somewhere other than the kit, keeping the
    /// list ordered. A version already present wins: it came off paper, and the
    /// key file is the weaker source of the two.
    pub fn insert(&mut self, entry: Entry) {
        if self.entry_for_version(entry.version).is_some() {
            return;
        }
        self.entries.push(entry);
        self.entries.sort_by_key(|e| e.version);
    }

    pub fn versions(&self) -> Vec<i32> {
        self.entries.iter().map(|e| e.version).collect()
    }
}

/// Derive the public half of `secret_key`, the same operation that made the
/// pair.
pub fn public_from_secret(secret_key: &[u8; 32]) -> [u8; 32] {
    let mut public_key = [0u8; 32];
    crypto_scalarmult_base(&mut public_key, secret_key);
    public_key
}

/// Fold the common misreadings back before decoding.
///
/// Crockford's point is that these characters are unambiguous *if* you map
/// them: someone copying off paper writes O for 0 and l for 1 whatever the
/// alphabet says.
fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            'U' => 'V',
            other => other,
        })
        .collect()
}

fn decode_base32(text: &str) -> Result<Vec<u8>, String> {
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut out = Vec::with_capacity(text.len() * 5 / 8);
    for ch in text.chars() {
        let index = ALPHABET
            .iter()
            .position(|c| *c as char == ch)
            .ok_or_else(|| format!("recovery kit contains an unexpected character: {ch}"))?;
        value = (value << 5) | index as u32;
        bits += 5;
        if bits >= 8 {
            out.push(((value >> (bits - 8)) & 0xff) as u8);
            bits -= 8;
        }
    }
    Ok(out)
}

/// Rebuild a keyring from a printed kit.
///
/// The account it belongs to is not in the kit — it carries key material only
/// — so the caller supplies the user id, exactly as the web importer does.
pub fn parse_recovery_kit(text: &str) -> Result<Keyring, String> {
    let normalized = normalize(text);
    if normalized.is_empty() {
        return Err("the recovery kit is empty".to_string());
    }
    decode_frame(&decode_base32(&normalized)?)
}

fn decode_frame(bytes: &[u8]) -> Result<Keyring, String> {
    if bytes.len() < 3 || bytes[0] != MAGIC {
        return Err("this does not look like a Neutrino recovery kit".to_string());
    }
    if bytes[1] != FORMAT_VERSION {
        return Err(format!("unsupported recovery kit version: {}", bytes[1]));
    }

    let count = bytes[2] as usize;
    let expected = 3 + count * ENTRY_BYTES;
    // A truncated kit is the likely outcome of copying by hand, so say that
    // rather than letting a short read produce a subtly wrong key.
    if bytes.len() < expected {
        return Err("recovery kit is incomplete — some characters are missing".to_string());
    }

    let mut entries = Vec::with_capacity(count);
    let mut offset = 3;
    for _ in 0..count {
        let version = ((bytes[offset] as i32) << 8) | bytes[offset + 1] as i32;
        let mut secret_key = [0u8; 32];
        secret_key.copy_from_slice(&bytes[offset + 2..offset + 2 + SECRET_KEY_BYTES]);
        let retired = bytes[offset + 2 + SECRET_KEY_BYTES] & FLAG_RETIRED != 0;
        entries.push(Entry {
            version,
            public_key: public_from_secret(&secret_key),
            secret_key,
            retired,
        });
        offset += ENTRY_BYTES;
    }

    let active = entries.iter().filter(|e| !e.retired).count();
    if active != 1 {
        return Err("recovery kit is damaged — it does not name exactly one active key".to_string());
    }

    entries.sort_by_key(|e| e.version);
    Ok(Keyring { entries })
}

/// A keyring holding one key, for `--secret-key`.
///
/// The version is whatever the caller says it is: a bare key carries no version
/// of its own, and the file's key ref is the only thing that knows which one it
/// wants.
pub fn keyring_from_secret_key(secret_key: [u8; 32], version: i32) -> Keyring {
    Keyring {
        entries: vec![Entry {
            version,
            public_key: public_from_secret(&secret_key),
            secret_key,
            retired: false,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frame a two-entry keyring encodes to, built the way
    /// `exportRecoveryKit` builds it, then rendered by the encoder below.
    fn encode_base32(bytes: &[u8]) -> String {
        let mut bits = 0u32;
        let mut value = 0u32;
        let mut out = String::new();
        for byte in bytes {
            value = (value << 8) | *byte as u32;
            bits += 8;
            while bits >= 5 {
                out.push(ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
                bits -= 5;
            }
        }
        if bits > 0 {
            out.push(ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
        }
        out
    }

    fn frame(entries: &[(i32, [u8; 32], bool)]) -> Vec<u8> {
        let mut out = vec![MAGIC, FORMAT_VERSION, entries.len() as u8];
        for (version, secret, retired) in entries {
            out.push((version >> 8) as u8);
            out.push(*version as u8);
            out.extend_from_slice(secret);
            out.push(if *retired { FLAG_RETIRED } else { 0 });
        }
        out
    }

    #[test]
    fn round_trips_a_two_version_keyring() {
        let v1 = [7u8; 32];
        let v2 = [9u8; 32];
        let text = encode_base32(&frame(&[(1, v1, true), (2, v2, false)]));

        let keyring = parse_recovery_kit(&text).expect("parse");
        assert_eq!(keyring.versions(), vec![1, 2]);
        assert_eq!(keyring.entry_for_version(1).unwrap().secret_key, v1);
        assert!(keyring.entry_for_version(1).unwrap().retired);
        assert_eq!(keyring.active().unwrap().version, 2);
    }

    /// The kit is copied by eye, so the decoder has to survive how people write
    /// it down: lowercase, regrouped, and with the letters Crockford excludes.
    #[test]
    fn tolerates_hand_transcription() {
        let text = encode_base32(&frame(&[(1, [3u8; 32], false)]));
        let mangled: String = text
            .chars()
            .map(|c| match c {
                '0' => 'o',
                '1' => 'l',
                other => other.to_ascii_lowercase(),
            })
            .collect();
        let spaced = mangled
            .as_bytes()
            .chunks(4)
            .map(|c| String::from_utf8_lossy(c).to_string())
            .collect::<Vec<_>>()
            .join("-\n");

        let keyring = parse_recovery_kit(&spaced).expect("parse");
        assert_eq!(keyring.entry_for_version(1).unwrap().secret_key, [3u8; 32]);
    }

    #[test]
    fn rejects_a_truncated_kit() {
        let full = encode_base32(&frame(&[(1, [3u8; 32], false)]));
        let short = &full[..full.len() - 8];
        let err = parse_recovery_kit(short).err().expect("should reject");
        assert!(err.contains("incomplete"), "{err}");
    }

    #[test]
    fn rejects_something_that_is_not_a_kit() {
        let err = parse_recovery_kit("ZZZZZZZZ").err().expect("should reject");
        assert!(err.contains("does not look like"), "{err}");
    }

    #[test]
    fn derives_the_public_half_from_the_secret() {
        // The all-nines scalar against the Curve25519 basepoint, as libsodium's
        // crypto_scalarmult_base computes it.
        let keyring = keyring_from_secret_key([9u8; 32], 1);
        let entry = keyring.active().unwrap();
        assert_eq!(entry.public_key, public_from_secret(&entry.secret_key));
        assert_ne!(entry.public_key, [0u8; 32]);
    }
}
