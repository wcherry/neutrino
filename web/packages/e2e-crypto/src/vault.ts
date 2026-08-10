'use client';

/**
 * The key vault envelope.
 *
 *   Curve25519 secret key  ──secretbox──▶  master key (MK, 32 random bytes)
 *   MK                     ──secretbox──▶  one wrapped copy per unlock method
 *
 * Only the wrapped forms are ever persisted or transmitted; MK exists in memory
 * for the moment it takes to unwrap the identity. Because every method wraps
 * the *same* MK, enrolling a passkey or revoking a lost device rewrites one row
 * and leaves the identity — and therefore every `file_key_refs` entry sealed to
 * it — untouched.
 *
 * Server-side shape lives in
 * `migrations/00105_auth__2026-08-10-000000_create_key_vault`.
 */

import sodium from 'libsodium-wrappers';
import { deriveKek, newArgon2Params, type Argon2Params } from './kdf';
import { getPasskeyPrf, registerPasskey, type PasskeyParams } from './prf';

export type UnlockMethod = 'password' | 'passkey' | 'recovery';

/** One enrolled unlock method, as stored and returned by the server. */
export interface UnlockMethodBlob {
  id?: string;
  method: UnlockMethod;
  label: string;
  /** base64url( nonce || secretbox ciphertext of MK ). */
  encryptedMasterKey: string;
  /** JSON string — `Argon2Params` or `PasskeyParams` depending on `method`. */
  params: string;
  createdAt?: string;
  lastUsedAt?: string | null;
}

export interface VaultBundle {
  /** base64url( nonce || secretbox ciphertext of the Curve25519 secret key ). */
  encryptedIdentity: string;
  /** base64url Curve25519 public key. */
  publicKey: string;
  version: number;
  unlocks: UnlockMethodBlob[];
}

// ── Low-level wrapping ────────────────────────────────────────────────────────

function b64u(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function unb64u(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

/** Encrypt `plaintext` under `key`, returning base64url(nonce || ciphertext). */
function seal(plaintext: Uint8Array, key: Uint8Array): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return b64u(out);
}

/**
 * Inverse of `seal`. Throws if the key is wrong or the blob was tampered with.
 *
 * libsodium-wrappers *throws* on a failed open rather than returning null, and
 * its message ("wrong secret key for the given ciphertext") goes straight to
 * the user through the unlock dialog. Normalise it here so a mistyped password
 * reads as one — the distinction between a bad key and a corrupt blob is not
 * one the caller can act on differently anyway.
 */
function open(blob: string, key: Uint8Array): Uint8Array {
  const raw = unb64u(blob);
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  if (raw.length <= nonceLen) {
    throw new Error('Malformed encrypted blob');
  }
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = sodium.crypto_secretbox_open_easy(
      raw.slice(nonceLen),
      raw.slice(0, nonceLen),
      key,
    );
  } catch {
    plaintext = null;
  }
  if (!plaintext) {
    throw new Error('Decryption failed — wrong key or corrupted data');
  }
  return plaintext;
}

export function generateMasterKey(): Uint8Array {
  return sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
}

// ── Building unlock methods ───────────────────────────────────────────────────

/**
 * Wrap `masterKey` under a password or recovery code.
 * `method` distinguishes the two; the derivation is identical.
 */
export async function buildSecretUnlock(
  masterKey: Uint8Array,
  secret: string,
  method: 'password' | 'recovery',
  label: string,
): Promise<UnlockMethodBlob> {
  const params: Argon2Params = newArgon2Params();
  const kek = await deriveKek(secret, params);
  return {
    method,
    label,
    encryptedMasterKey: seal(masterKey, kek),
    params: JSON.stringify(params),
  };
}

/**
 * Register a new passkey and wrap `masterKey` under its PRF output.
 *
 * The PRF secret never leaves the authenticator — we only ever see the 32 bytes
 * it derives for our salt, and only after a user gesture (Touch ID, PIN, tap).
 */
export async function buildPasskeyUnlock(
  masterKey: Uint8Array,
  userId: string,
  userName: string,
  label: string,
): Promise<UnlockMethodBlob> {
  const { params, prfOutput } = await registerPasskey(userId, userName, label);
  return {
    method: 'passkey',
    label,
    encryptedMasterKey: seal(masterKey, prfOutput),
    params: JSON.stringify(params),
  };
}

// ── Unlocking ─────────────────────────────────────────────────────────────────

/** Recover MK from a password/recovery-code unlock blob. */
export async function unwrapWithSecret(
  unlock: UnlockMethodBlob,
  secret: string,
): Promise<Uint8Array> {
  const params = JSON.parse(unlock.params) as Argon2Params;
  const kek = await deriveKek(secret, params);
  return open(unlock.encryptedMasterKey, kek);
}

/** Recover MK from a passkey unlock blob, prompting the authenticator. */
export async function unwrapWithPasskey(unlock: UnlockMethodBlob): Promise<Uint8Array> {
  const params = JSON.parse(unlock.params) as PasskeyParams;
  const prfOutput = await getPasskeyPrf(params);
  return open(unlock.encryptedMasterKey, prfOutput);
}

// ── Identity envelope ─────────────────────────────────────────────────────────

export function wrapIdentity(secretKey: Uint8Array, masterKey: Uint8Array): string {
  return seal(secretKey, masterKey);
}

export function unwrapIdentity(encryptedIdentity: string, masterKey: Uint8Array): Uint8Array {
  const secretKey = open(encryptedIdentity, masterKey);
  if (secretKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new Error('Unwrapped identity key has the wrong length');
  }
  return secretKey;
}

/**
 * Open a whole vault with an already-recovered master key.
 *
 * Verifies the unwrapped secret really matches the vault's advertised public
 * key. Without this a tampered `encryptedIdentity` would yield a key that
 * decrypts nothing, surfacing much later as unexplained "cannot decrypt file"
 * errors instead of a clear failure here.
 */
export function openVault(
  vault: VaultBundle,
  masterKey: Uint8Array,
): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const secretKey = unwrapIdentity(vault.encryptedIdentity, masterKey);
  const publicKey = unb64u(vault.publicKey);
  const derived = sodium.crypto_scalarmult_base(secretKey);
  if (!sodium.memcmp(derived, publicKey)) {
    throw new Error('Vault is inconsistent — unwrapped key does not match its public key');
  }
  return { publicKey, secretKey };
}

export { b64u as toBase64urlBytes, unb64u as fromBase64urlBytes };
