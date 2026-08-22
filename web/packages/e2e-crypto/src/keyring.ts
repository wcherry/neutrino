'use client';

/**
 * The identity keyring — every Curve25519 keypair this account has ever held.
 *
 * A single identity keypair cannot be rotated: the moment it changes, every DEK
 * in `file_key_refs` is sealed to a key nobody holds any more, and nothing on
 * the row says which key it wanted. So the identity becomes a list, each entry
 * numbered, and `file_key_refs.key_version` names the entry a given DEK needs.
 *
 *   read   resolve the file's `keyVersion` against this keyring, open with that
 *          entry's secret key
 *   write  seal to the *active* entry and record its version
 *
 * Content is never re-encrypted by a rotation. Only the sealed DEK moves, so
 * rotating costs one re-seal per key ref rather than a pass over every byte.
 *
 * What rotation does *not* buy, stated plainly because it is easy to assume
 * otherwise: re-sealing bounds future exposure, not past. An attacker who
 * already captured the old sealed DEK and later compromises the retired secret
 * key still recovers that DEK, and the content it opens has not changed.
 * Rotation defends against a key becoming exposed from now on — a stolen
 * device's keychain, a retired laptop — not against someone logging ciphertext.
 *
 * Entries are independently random rather than derived from one root seed. A
 * seed would make the recovery kit valid forever, but it would also make seed
 * compromise total across every past and future version, which is precisely the
 * thing rotation is supposed to bound. The cost of independent keys is that the
 * kit has to be re-exported after each rotation; see `recoveryKit.ts`.
 *
 * Nothing here is ever transmitted. See
 * `agent_docs/client-only-key-architecture.md`.
 */

import sodium from 'libsodium-wrappers';

export interface KeyringEntry {
  /** 1-based, matching `user_public_keys.version` on the server. */
  version: number;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp, or null while this is the active entry. */
  retiredAt: string | null;
}

export interface Keyring {
  userId: string;
  /** Ascending by version. Exactly one entry has `retiredAt === null`. */
  entries: KeyringEntry[];
}

/** Serialised form — what the recovery kit and the pairing QR carry. */
export interface SerializedKeyring {
  v: 1;
  userId: string;
  entries: {
    version: number;
    /** base64url */
    sk: string;
    createdAt: string;
    retiredAt: string | null;
  }[];
}

function b64u(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function unb64u(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

/**
 * Derive the public half rather than storing it.
 *
 * Keeping both halves in the serialised form would let them disagree — a
 * corrupted or hand-edited kit could carry a public key that is not the secret
 * key's, and every seal made with it would be unopenable. `crypto_scalarmult_base`
 * is the same operation that made the pair, so this cannot drift.
 */
function publicFromSecret(secretKey: Uint8Array): Uint8Array {
  return sodium.crypto_scalarmult_base(secretKey);
}

/** Mint a keyring holding a single fresh identity at version 1. */
export function createKeyring(userId: string, now = new Date().toISOString()): Keyring {
  const kp = sodium.crypto_box_keypair();
  return {
    userId,
    entries: [
      {
        version: 1,
        publicKey: kp.publicKey,
        secretKey: kp.privateKey,
        createdAt: now,
        retiredAt: null,
      },
    ],
  };
}

/**
 * Adopt an existing keypair as version 1.
 *
 * Used when a keypair arrives from somewhere that predates the keyring — an
 * imported key file, say. Minting a fresh identity instead would orphan every
 * file already sealed to the one being imported.
 */
export function keyringFromKeyPair(
  userId: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
  now = new Date().toISOString(),
): Keyring {
  return {
    userId,
    entries: [{ version: 1, publicKey, secretKey, createdAt: now, retiredAt: null }],
  };
}

/** The entry new work is sealed to. Throws if the keyring is empty. */
export function activeEntry(keyring: Keyring): KeyringEntry {
  const active = keyring.entries.find((e) => e.retiredAt === null);
  if (!active) {
    throw new Error('Keyring has no active entry');
  }
  return active;
}

/**
 * The entry a file's DEK was sealed to.
 *
 * Returns null rather than throwing so callers can report a missing version as
 * the specific, actionable thing it is ("this file needs key v2, which this
 * device does not have") instead of a bare decryption failure.
 */
export function entryForVersion(keyring: Keyring, version: number): KeyringEntry | null {
  return keyring.entries.find((e) => e.version === version) ?? null;
}

/**
 * Add a fresh identity as the newest version and retire its predecessor.
 *
 * Returns a new keyring; the input is not mutated, so a caller that fails to
 * persist the result has not silently lost the old active key.
 */
export function rotateKeyring(keyring: Keyring, now = new Date().toISOString()): Keyring {
  const nextVersion = Math.max(0, ...keyring.entries.map((e) => e.version)) + 1;
  const kp = sodium.crypto_box_keypair();

  return {
    userId: keyring.userId,
    entries: [
      ...keyring.entries.map((e) => (e.retiredAt === null ? { ...e, retiredAt: now } : e)),
      {
        version: nextVersion,
        publicKey: kp.publicKey,
        secretKey: kp.privateKey,
        createdAt: now,
        retiredAt: null,
      },
    ],
  };
}

// ── Serialisation ─────────────────────────────────────────────────────────────

export function serializeKeyring(keyring: Keyring): SerializedKeyring {
  return {
    v: 1,
    userId: keyring.userId,
    entries: keyring.entries.map((e) => ({
      version: e.version,
      sk: b64u(e.secretKey),
      createdAt: e.createdAt,
      retiredAt: e.retiredAt,
    })),
  };
}

/**
 * Rebuild a keyring from its serialised form, validating as it goes.
 *
 * Everything this parses came off paper, a QR code or disk, so none of it is
 * trusted: a wrong secret-key length, a duplicate version or a keyring with no
 * active entry are all rejected here rather than surfacing later as files that
 * mysteriously will not open.
 */
export function deserializeKeyring(raw: unknown): Keyring {
  const data = raw as SerializedKeyring;
  if (!data || data.v !== 1 || typeof data.userId !== 'string' || !Array.isArray(data.entries)) {
    throw new Error('Unrecognised keyring format');
  }
  if (data.entries.length === 0) {
    throw new Error('Keyring is empty');
  }

  const entries: KeyringEntry[] = data.entries.map((e) => {
    const secretKey = unb64u(e.sk);
    if (secretKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
      throw new Error(`Key version ${e.version} has the wrong length`);
    }
    if (!Number.isInteger(e.version) || e.version < 1) {
      throw new Error(`Key version ${String(e.version)} is not a positive integer`);
    }
    return {
      version: e.version,
      publicKey: publicFromSecret(secretKey),
      secretKey,
      createdAt: e.createdAt,
      retiredAt: e.retiredAt ?? null,
    };
  });

  entries.sort((a, b) => a.version - b.version);

  const versions = new Set(entries.map((e) => e.version));
  if (versions.size !== entries.length) {
    throw new Error('Keyring has duplicate key versions');
  }

  const activeCount = entries.filter((e) => e.retiredAt === null).length;
  if (activeCount !== 1) {
    throw new Error(`Keyring must have exactly one active key, found ${activeCount}`);
  }

  return { userId: data.userId, entries };
}

/** Wipe every secret in the keyring. Best-effort, as JS allows. */
export function wipeKeyring(keyring: Keyring): void {
  for (const entry of keyring.entries) {
    entry.secretKey.fill(0);
    entry.publicKey.fill(0);
  }
}

export { b64u as keyringToBase64url, unb64u as keyringFromBase64url };
