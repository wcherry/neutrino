'use client';

/**
 * E2EE cryptographic primitives built on libsodium-wrappers.
 *
 * Key hierarchy (Phase 1):
 *   Curve25519 keypair  ─── sealed-box ───▶  DEK (per-file 32-byte random key)
 *                                              │
 *                                     XChaCha20-Poly1305
 *                                              │
 *                                     encrypted file content
 *                                     encrypted metadata JSON
 *
 * All binary values are passed around as Uint8Array internally.
 * API boundaries encode/decode as base64url strings.
 */

import sodium from 'libsodium-wrappers';

let _ready = false;

/**
 * Must be called once before any other function.
 * Idempotent — safe to call multiple times.
 */
export async function initSodium(): Promise<void> {
  if (_ready) return;
  await sodium.ready;
  _ready = true;
}

function ensureReady(): void {
  if (!_ready) {
    throw new Error('Call initSodium() first');
  }
}

// ── Base64url helpers ─────────────────────────────────────────────────────────

export function toBase64url(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function fromBase64url(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

// ── Key generation ────────────────────────────────────────────────────────────

export interface KeyPair {
  /** Curve25519 public key — safe to upload to the server. */
  publicKey: Uint8Array;
  /** Curve25519 secret key — never leaves the client. */
  secretKey: Uint8Array;
}

/**
 * Generate a new Curve25519 keypair (box keypair).
 */
export function generateKeyPair(): KeyPair {
  ensureReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/**
 * Generate a random 32-byte file Data Encryption Key (DEK).
 */
export function generateFileKey(): Uint8Array {
  ensureReady();
  return sodium.randombytes_buf(sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
}

// ── Symmetric file encryption (XChaCha20-Poly1305 via secretstream) ───────────

/**
 * Encrypt arbitrary bytes with a DEK using XChaCha20-Poly1305.
 *
 * Output format: [24-byte header][ciphertext]
 */
export function encryptFile(plaintext: Uint8Array, dek: Uint8Array): Uint8Array {
  ensureReady();
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
  const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
    state,
    plaintext,
    null,
    sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
  );
  // Prepend the header so the receiver can initialise the pull state.
  const out = new Uint8Array(header.length + ciphertext.length);
  out.set(header, 0);
  out.set(ciphertext, header.length);
  return out;
}

/**
 * Decrypt bytes produced by `encryptFile`.
 */
export function decryptFile(ciphertext: Uint8Array, dek: Uint8Array): Uint8Array {
  ensureReady();
  const headerLen = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
  if (ciphertext.length < headerLen) {
    throw new Error('Ciphertext too short');
  }
  const header = ciphertext.slice(0, headerLen);
  const body = ciphertext.slice(headerLen);
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, dek);
  const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, body);
  if (!result) {
    throw new Error('Decryption failed — invalid ciphertext or key');
  }
  return result.message;
}

// ── Asymmetric DEK encryption (sealed box = Curve25519 + XSalsa20-Poly1305) ──

/**
 * Seal the DEK to a recipient's Curve25519 public key.
 * Returns a base64url string suitable for storing on the server.
 *
 * Uses `crypto_box_seal` — the recipient can open it with their secret key
 * without knowing who sent it (anonymous sender).
 */
export function encryptFileKey(dek: Uint8Array, recipientPublicKey: Uint8Array): string {
  ensureReady();
  const sealed = sodium.crypto_box_seal(dek, recipientPublicKey);
  return toBase64url(sealed);
}

/**
 * Open a sealed DEK using the holder's keypair.
 */
export function decryptFileKey(
  encryptedFileKey: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array {
  ensureReady();
  const sealed = fromBase64url(encryptedFileKey);
  const dek = sodium.crypto_box_seal_open(sealed, publicKey, secretKey);
  if (!dek) {
    throw new Error('Failed to decrypt file key');
  }
  return dek;
}

// ── Metadata encryption ───────────────────────────────────────────────────────

/**
 * Encrypt a metadata object (e.g. `{ name, mimeType }`) with the file's DEK.
 * Returns a base64url string.
 */
export function encryptMetadata(metadata: Record<string, unknown>, dek: Uint8Array): string {
  ensureReady();
  const json = JSON.stringify(metadata);
  const plaintext = sodium.from_string(json);
  const ciphertext = encryptFile(plaintext, dek);
  return toBase64url(ciphertext);
}

/**
 * Decrypt a metadata blob produced by `encryptMetadata`.
 */
export function decryptMetadata(
  encryptedMetadata: string,
  dek: Uint8Array,
): Record<string, unknown> {
  ensureReady();
  const ciphertext = fromBase64url(encryptedMetadata);
  const plaintext = decryptFile(ciphertext, dek);
  const json = sodium.to_string(plaintext);
  return JSON.parse(json) as Record<string, unknown>;
}
