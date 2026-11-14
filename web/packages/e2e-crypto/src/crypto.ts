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

import { loadSodium, sodium } from './sodium';

let _ready = false;

/**
 * Must be called once before any other function.
 * Idempotent — safe to call multiple times.
 */
export async function initSodium(): Promise<void> {
  if (_ready) return;
  await loadSodium();
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
 * Do these two halves belong together?
 *
 * Curve25519 public keys are derived from the secret, so this is checkable
 * rather than a matter of trust. Worth checking on any keypair that arrives from
 * outside: adopting a mismatched pair fails silently and late — everything seals
 * to a public key whose secret nobody holds, and the damage only shows up when a
 * file will not open. The iOS importer makes the same comparison.
 */
export function keyPairMatches(publicKey: Uint8Array, secretKey: Uint8Array): boolean {
  ensureReady();
  if (publicKey.length !== 32 || secretKey.length !== 32) return false;
  const derived = sodium.crypto_scalarmult_base(secretKey);
  return sodium.memcmp(derived, publicKey);
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
 * Decrypt a file body in any of the three shapes the platform writes, choosing by the bytes
 * (`agent_docs/chunked-file-encryption.md` §3.5–§3.6):
 *
 * - **NEB1** — starts with the `NEB1` magic; self-describing, header authenticated on every chunk.
 * - **Photos-chunked** — `[header][chunk]…[FINAL chunk]` with the chunk size in the file's
 *   encrypted metadata (Neutrino Photos iOS, originals over 64 MiB). Pass `chunkSize` when the
 *   metadata is to hand; without it a body that fails as one push is retried at 1 MiB, the only
 *   size Photos has written.
 * - **v0** — `[24-byte header][one FINAL message]`, everything else.
 *
 * A NEB1 blob that fails its *structural* checks falls through to the other shapes (a v0 header
 * begins with `NEB1` by chance once in 2³²); one that fails *authentication* does not.
 */
export function decryptFile(
  ciphertext: Uint8Array,
  dek: Uint8Array,
  options: { chunkSize?: number | null } = {},
): Uint8Array {
  ensureReady();
  if (hasNeb1Magic(ciphertext)) {
    try {
      return decryptNeb1(ciphertext, dek);
    } catch (err) {
      if (!(err instanceof ChunkedHeaderError)) throw err;
    }
  }
  if (options.chunkSize != null && options.chunkSize > 0) {
    return decryptPhotosChunked(ciphertext, dek, options.chunkSize);
  }
  try {
    return decryptV0(ciphertext, dek);
  } catch (v0Error) {
    // A Photos-chunked body read without its metadata fails as one push. Retrying it as 1 MiB
    // chunks is safe: every chunk authenticates and a FINAL tag is required, so this succeeds only
    // on a genuine chunked body. Only bodies longer than one chunk can be chunked differently.
    const headerLen = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
    if (ciphertext.length > headerLen + PHOTOS_CHUNK_SIZE + ABYTES) {
      try {
        return decryptPhotosChunked(ciphertext, dek, PHOTOS_CHUNK_SIZE);
      } catch {
        /* report the v0 failure, which names the common case */
      }
    }
    throw v0Error;
  }
}

/** The chunk size recorded in a file's decrypted metadata, if it was written chunked. */
export function chunkSizeFromMetadata(metadata: Record<string, unknown> | null | undefined): number | undefined {
  const value = metadata?.chunkSize;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function decryptV0(ciphertext: Uint8Array, dek: Uint8Array): Uint8Array {
  const headerLen = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
  if (ciphertext.length < headerLen) {
    throw new Error('Ciphertext too short');
  }
  const header = ciphertext.slice(0, headerLen);
  const body = ciphertext.slice(headerLen);
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, dek);
  // Unchanged from before chunking: v0 never checked the tag, and tightening that could refuse a
  // body that opens today.
  const result = pullOrNull(state, body, null);
  if (!result) {
    throw new Error('Decryption failed — invalid ciphertext or key');
  }
  return result.message;
}

// ── Chunked file bodies: NEB1 (agent_docs/chunked-file-encryption.md) ─────────

/** `NEB1`: "Neutrino Encrypted Blob, format 1". */
export const NEB1_MAGIC = new Uint8Array([0x4e, 0x45, 0x42, 0x31]);
export const NEB1_DEFAULT_CHUNK_SIZE = 1 << 20;
export const NEB1_MIN_CHUNK_SIZE = 4096;
export const NEB1_MAX_CHUNK_SIZE = 16 * 1024 * 1024;
/** The chunk size Neutrino Photos iOS writes (`MediaCrypto.defaultChunkSize`). */
export const PHOTOS_CHUNK_SIZE = 1 << 20;

const NEB1_PREFIX_BYTES = 20;
const NEB1_HEADER_BYTES = 44;
const ABYTES = 17;

/** A NEB1 header that is malformed. Structural, so the dispatch may try another shape. */
export class ChunkedHeaderError extends Error {
  constructor(public readonly field: string) {
    super(`Not a valid NEB1 header (${field})`);
    this.name = 'ChunkedHeaderError';
  }
}

/** A chunked body that failed authentication. Never falls through to another shape. */
export class ChunkedAuthError extends Error {
  constructor(message = 'Decryption failed — chunked ciphertext is invalid, truncated or reordered') {
    super(message);
    this.name = 'ChunkedAuthError';
  }
}

function hasNeb1Magic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && NEB1_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Encrypt a file body as NEB1 (§4.1). Whole-buffer form, for tests, vectors and small inputs;
 * a streaming writer holds one chunk at a time and produces the same bytes.
 */
export function encryptFileNeb1(
  plaintext: Uint8Array,
  dek: Uint8Array,
  chunkSize: number = NEB1_DEFAULT_CHUNK_SIZE,
): Uint8Array {
  ensureReady();
  if (!Number.isInteger(chunkSize) || chunkSize < NEB1_MIN_CHUNK_SIZE || chunkSize > NEB1_MAX_CHUNK_SIZE) {
    throw new RangeError(`chunkSize must be in [${NEB1_MIN_CHUNK_SIZE}, ${NEB1_MAX_CHUNK_SIZE}]`);
  }
  const P = plaintext.length;
  const n = Math.max(1, Math.ceil(P / chunkSize));
  const prefix = neb1Prefix(chunkSize, P);
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);

  const out = new Uint8Array(NEB1_HEADER_BYTES + P + ABYTES * n);
  out.set(prefix, 0);
  out.set(header, NEB1_PREFIX_BYTES);
  let offset = NEB1_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const plain = plaintext.subarray(i * chunkSize, Math.min(P, (i + 1) * chunkSize));
    const tag = i === n - 1
      ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
      : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    const cipher = sodium.crypto_secretstream_xchacha20poly1305_push(state, plain, prefix, tag);
    out.set(cipher, offset);
    offset += cipher.length;
  }
  return out;
}

/** `NEB1 ‖ version ‖ alg ‖ reserved ‖ be32(chunkSize) ‖ be64(plaintextLength)`: 20 bytes. */
function neb1Prefix(chunkSize: number, plaintextLength: number): Uint8Array {
  const prefix = new Uint8Array(NEB1_PREFIX_BYTES);
  prefix.set(NEB1_MAGIC, 0);
  prefix[4] = 0x01; // version
  prefix[5] = 0x01; // alg: sequential secretstream chunks
  const view = new DataView(prefix.buffer);
  view.setUint16(6, 0);
  view.setUint32(8, chunkSize);
  view.setBigUint64(12, BigInt(plaintextLength));
  return prefix;
}

/** Decrypt a NEB1 blob (§4.2), checking the whole header and length before any decryption. */
export function decryptNeb1(blob: Uint8Array, dek: Uint8Array): Uint8Array {
  ensureReady();
  if (blob.length < NEB1_HEADER_BYTES) throw new ChunkedHeaderError('length');
  if (!hasNeb1Magic(blob)) throw new ChunkedHeaderError('magic');
  if (blob[4] !== 0x01) throw new ChunkedHeaderError('version');
  if (blob[5] !== 0x01) throw new ChunkedHeaderError('alg');
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (view.getUint16(6) !== 0) throw new ChunkedHeaderError('reserved');
  const C = view.getUint32(8);
  if (C < NEB1_MIN_CHUNK_SIZE || C > NEB1_MAX_CHUNK_SIZE) throw new ChunkedHeaderError('chunkSize');
  const big = view.getBigUint64(12);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new ChunkedHeaderError('length');
  const P = Number(big);
  const n = Math.max(1, Math.ceil(P / C));
  if (blob.length !== NEB1_HEADER_BYTES + P + ABYTES * n) throw new ChunkedHeaderError('length');

  const prefix = blob.slice(0, NEB1_PREFIX_BYTES);
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
    blob.slice(NEB1_PREFIX_BYTES, NEB1_HEADER_BYTES), dek,
  );
  const out = new Uint8Array(P);
  let read = NEB1_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const want = Math.min(C, P - i * C);
    const result = pullOrNull(state, blob.subarray(read, read + want + ABYTES), prefix);
    if (!result || result.message.length !== want) throw new ChunkedAuthError();
    const expected = i === n - 1
      ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
      : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    if (result.tag !== expected) throw new ChunkedAuthError();
    out.set(result.message, i * C);
    read += want + ABYTES;
  }
  return out;
}

/**
 * Decrypt a Photos-chunked body: `[24-byte header][chunkSize+17]…[≤ chunkSize+17, FINAL]`, no AD.
 * The chunk size comes from the file's metadata; it is bounded so a damaged one can't ask for an
 * absurd allocation.
 */
export function decryptPhotosChunked(blob: Uint8Array, dek: Uint8Array, chunkSize: number): Uint8Array {
  ensureReady();
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > NEB1_MAX_CHUNK_SIZE) {
    throw new ChunkedAuthError('Decryption failed — chunk size out of range');
  }
  const headerLen = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
  if (blob.length < headerLen + ABYTES) throw new ChunkedAuthError();
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(blob.slice(0, headerLen), dek);
  const parts: Uint8Array[] = [];
  let total = 0;
  let read = headerLen;
  let sawFinal = false;
  while (read < blob.length) {
    const end = Math.min(blob.length, read + chunkSize + ABYTES);
    const result = pullOrNull(state, blob.subarray(read, end), null);
    if (!result) throw new ChunkedAuthError();
    parts.push(result.message);
    total += result.message.length;
    read = end;
    if (result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
      sawFinal = true;
      break;
    }
    // Every chunk before the last is full; a short one that isn't FINAL means a re-framed body.
    if (result.message.length !== chunkSize) throw new ChunkedAuthError();
  }
  // Every chunk authenticates itself, so only this catches a body cut short before its FINAL
  // chunk, or bytes appended after it.
  if (!sawFinal || read !== blob.length) throw new ChunkedAuthError();
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** libsodium-wrappers returns `false` for some failures and throws for others; normalise. */
function pullOrNull(
  state: unknown,
  cipher: Uint8Array,
  ad: Uint8Array | null,
): { message: Uint8Array; tag: number } | null {
  try {
    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
      state as Parameters<typeof sodium.crypto_secretstream_xchacha20poly1305_pull>[0], cipher, ad,
    );
    return result ? (result as { message: Uint8Array; tag: number }) : null;
  } catch {
    return null;
  }
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
