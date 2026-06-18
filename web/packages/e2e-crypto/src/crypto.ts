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

// ── PIN-protected key export (for QR code transfer) ──────────────────────────

export interface PinEncryptedKeys {
  v: 1;
  alg: 'pbkdf2-sha256+xsalsa20';
  /** base64url-encoded 16-byte PBKDF2 salt */
  salt: string;
  /** base64url-encoded 24-byte secretbox nonce */
  nonce: string;
  /** base64url-encoded secretbox ciphertext containing keypair JSON */
  ct: string;
  /** PBKDF2 iteration count — mobile must use the same value */
  iter: number;
}

const PBKDF2_ITERATIONS = 600_000;

async function deriveKeyFromPin(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypt a keypair with a PIN using PBKDF2-SHA256 + XSalsa20-Poly1305.
 * Intended for QR-code-based device pairing. Requires a secure context (HTTPS/localhost).
 */
export async function encryptKeysWithPin(
  publicKey: Uint8Array,
  secretKey: Uint8Array,
  pin: string,
): Promise<PinEncryptedKeys> {
  ensureReady();
  const salt = sodium.randombytes_buf(16);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const derivedKey = await deriveKeyFromPin(pin, salt, PBKDF2_ITERATIONS);
  const plaintext = sodium.from_string(JSON.stringify({
    pk: toBase64url(publicKey),
    sk: toBase64url(secretKey),
  }));
  const ct = sodium.crypto_secretbox_easy(plaintext, nonce, derivedKey);
  return {
    v: 1,
    alg: 'pbkdf2-sha256+xsalsa20',
    salt: toBase64url(salt),
    nonce: toBase64url(nonce),
    ct: toBase64url(ct),
    iter: PBKDF2_ITERATIONS,
  };
}

/**
 * Decrypt a keypair previously encrypted with `encryptKeysWithPin`.
 * Throws if the PIN is wrong or the payload is malformed.
 */
export async function decryptKeysWithPin(
  payload: PinEncryptedKeys,
  pin: string,
): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  ensureReady();
  if (payload.v !== 1 || payload.alg !== 'pbkdf2-sha256+xsalsa20') {
    throw new Error('Unsupported key format');
  }
  const derivedKey = await deriveKeyFromPin(pin, fromBase64url(payload.salt), payload.iter);
  const plaintext = sodium.crypto_secretbox_open_easy(
    fromBase64url(payload.ct),
    fromBase64url(payload.nonce),
    derivedKey,
  );
  if (!plaintext) throw new Error('Wrong PIN or corrupted payload');
  const parsed = JSON.parse(sodium.to_string(plaintext)) as { pk: string; sk: string };
  return {
    publicKey: fromBase64url(parsed.pk),
    secretKey: fromBase64url(parsed.sk),
  };
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
