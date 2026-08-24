'use client';

/**
 * The key file — every retired identity key, wrapped so the server can hold it.
 *
 * Before this, a rotation's retired keys lived in exactly one place: the
 * IndexedDB record on the browser that performed the rotation (`keystoreLocal`).
 * Lose that profile and every file sealed to a retired version is gone, because
 * the recovery kit printed *before* the rotation cannot contain a key minted
 * *by* it (see `recoveryKit.ts`) and the mobile QR carries the active entry only
 * (see `mobileKeyQr.ts`). The key file closes that gap without giving the server
 * anything it can read.
 *
 * ── What it is sealed to, and why that and not the local wrapping key ─────────
 * Each retired secret key is sealed with `crypto_box_seal` to the keyring's
 * **active public key**. So whoever holds the current identity can recover every
 * identity that came before it, and nobody else can — the server included.
 *
 * The obvious alternative, wrapping under the same key `keystoreLocal` uses, is
 * wrong here: for the `device` method that key is random per browser profile and
 * stored beside the blob it opens, so a second device could never unwrap the
 * result. That would file the backup under the one thing the backup exists to
 * survive.
 *
 * The consequence is that every rotation re-seals the *whole* retired set to the
 * new active key rather than appending to a chain. That costs one sealed box per
 * version per rotation — nothing beside the re-seal of the file keys themselves —
 * and it buys a flat structure: recovery needs the current key and one round
 * trip, not a walk back through every intermediate version in order.
 *
 * ── What it deliberately does not carry ──────────────────────────────────────
 * No `createdAt`/`retiredAt`. The file exists so a version can still be
 * *decrypted*, and timestamps are not needed for that; a keyring rebuilt from it
 * has to supply its own, which is why `openKeyFile` returns bare keys rather
 * than pretending to hand back `KeyringEntry`s.
 */

import sodium from 'libsodium-wrappers';
import { activeEntry, type Keyring, type KeyringEntry } from './keyring';

/**
 * One entry as it goes over the wire.
 *
 * Structurally identical to `ArchivedKey` in `@neutrino/api-drive` and to the
 * Rust DTO behind `PUT /api/v1/drive/key-file`. Declared here rather than
 * imported so this package keeps its rule of depending on no API client.
 */
export interface ArchivedKey {
  keyVersion: number;
  /** base64url sealed box over the retired secret key. */
  encryptedKey: string;
  /** base64url public half, so a reader can match an entry before unsealing. */
  publicKey?: string;
}

/** A key recovered from the file. Timestamps are not in it — see the header. */
export interface RecoveredKey {
  version: number;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

function b64u(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function unb64u(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

/**
 * Wrap every retired key in `keyring` for storage.
 *
 * Empty for a keyring that has never rotated, which is the caller's signal to
 * store nothing at all: the server rejects a key file with no keys, and rightly
 * so — an empty one is what DELETE is for.
 *
 * Membership is decided by version rather than by `retiredAt`, so a keyring that
 * somehow carries two active entries still archives everything that is not the
 * one being sealed to, instead of silently dropping a key.
 */
export function buildKeyFile(keyring: Keyring): ArchivedKey[] {
  const active = activeEntry(keyring);
  return keyring.entries
    .filter((entry) => entry.version !== active.version)
    .sort((a, b) => a.version - b.version)
    .map((entry) => ({
      keyVersion: entry.version,
      encryptedKey: b64u(sodium.crypto_box_seal(entry.secretKey, active.publicKey)),
      publicKey: b64u(entry.publicKey),
    }));
}

/**
 * Unwrap a stored key file with the active entry that sealed it.
 *
 * Everything here came back off the network, so none of it is trusted: a short
 * secret key or a declared public half that is not the secret's own is rejected
 * rather than installed, since either would surface later as files that
 * mysteriously will not open. Both checks mirror `deserializeKeyring`, which
 * guards the paper and QR paths for the same reason.
 */
export function openKeyFile(keys: ArchivedKey[], active: KeyringEntry): RecoveredKey[] {
  return keys.map((key) => {
    let secretKey: Uint8Array;
    try {
      secretKey = sodium.crypto_box_seal_open(
        unb64u(key.encryptedKey),
        active.publicKey,
        active.secretKey,
      );
    } catch {
      // Almost always a key file sealed to a version older than the one in hand,
      // which reads as a decryption failure but is really "this device's key is
      // not the newest one".
      throw new Error(
        `Key version ${key.keyVersion} was not sealed to key version ${active.version}`,
      );
    }
    if (secretKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
      throw new Error(`Key version ${key.keyVersion} has the wrong length`);
    }

    const publicKey = sodium.crypto_scalarmult_base(secretKey);
    if (key.publicKey && key.publicKey !== b64u(publicKey)) {
      throw new Error(`Key version ${key.keyVersion} does not match its stored public key`);
    }
    return { version: key.keyVersion, publicKey, secretKey };
  });
}
