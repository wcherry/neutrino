'use client';

/**
 * Password-based key derivation for the key vault.
 *
 * Argon2id, not PBKDF2: the threat is an attacker who has pulled the wrapped
 * blobs and is grinding candidate passwords offline, and Argon2id's memory cost
 * is what makes that expensive on GPUs.
 *
 * libsodium exposes `crypto_pwhash` (Argon2id) only in its `-sumo` build, which
 * costs ~700 KB of extra wasm on a package every app page imports. `hash-wasm`
 * ships argon2 as a standalone ~29 KB module instead, and the dynamic import
 * below keeps even that off the initial bundle — it is fetched the first time
 * someone actually unlocks.
 */

import sodium from 'libsodium-wrappers';

/** Serialised into `user_key_unlocks.params` for password and recovery methods. */
export interface Argon2Params {
  kdf: 'argon2id';
  /** base64url, 16 bytes. */
  salt: string;
  /** Argon2 time cost. */
  iterations: number;
  /** Argon2 memory cost in KiB. */
  memoryKiB: number;
  parallelism: number;
}

/**
 * Comfortably above the OWASP floor (m=19 MiB, t=2) while still finishing in a
 * few hundred milliseconds on a laptop. Stored per-blob, so raising these later
 * does not strand existing vaults — each unlock uses the params it was made
 * with.
 */
export const DEFAULT_ARGON2_PARAMS = {
  iterations: 3,
  memoryKiB: 65536,
  parallelism: 1,
} as const;

const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

export function newArgon2Params(): Argon2Params {
  const salt = sodium.randombytes_buf(SALT_BYTES);
  return {
    kdf: 'argon2id',
    salt: sodium.to_base64(salt, sodium.base64_variants.URLSAFE_NO_PADDING),
    ...DEFAULT_ARGON2_PARAMS,
  };
}

/**
 * Derive a 32-byte key-encryption key from a password or recovery code.
 *
 * Throws on unknown `kdf` values rather than silently falling back, so a future
 * algorithm change can't be downgraded by a tampered `params` blob.
 */
export async function deriveKek(secret: string, params: Argon2Params): Promise<Uint8Array> {
  if (params.kdf !== 'argon2id') {
    throw new Error(`Unsupported KDF: ${String(params.kdf)}`);
  }
  const { argon2id } = await import('hash-wasm');
  const salt = sodium.from_base64(params.salt, sodium.base64_variants.URLSAFE_NO_PADDING);

  const hex = await argon2id({
    password: secret,
    salt,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    parallelism: params.parallelism,
    hashLength: DERIVED_KEY_BYTES,
    outputType: 'hex',
  });

  const key = new Uint8Array(DERIVED_KEY_BYTES);
  for (let i = 0; i < DERIVED_KEY_BYTES; i += 1) {
    key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return key;
}
