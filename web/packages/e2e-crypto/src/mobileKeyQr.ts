'use client';

/**
 * The PIN-protected key QR the Neutrino mobile apps scan.
 *
 * This is the scheme `pairing.ts` was written to replace, restored because the
 * iOS apps implement it and nothing else. Read that file's header before
 * changing anything here: the whole keypair travels in one QR under PBKDF2 over
 * a short PIN, so **a photograph of the code plus an offline grind of the PIN
 * yields the identity**. Six digits at 600 000 iterations is minutes on a
 * consumer GPU, not the "seconds" of a bare hash, but it is not a security
 * boundary you can lean on either.
 *
 * What that means for how this is used, and why the UI matters as much as the
 * crypto here:
 *
 *   - the code is short-lived and must never be persisted, screenshotted into a
 *     ticket, or rendered on a screen that is being shared
 *   - the PIN is generated here, not chosen by the user, so it is uniformly
 *     random over its digit space rather than `123456`
 *   - `expireQrPayload` exists so the caller can wipe the rendered payload on a
 *     timer rather than leaving it on screen until the panel closes
 *
 * Prefer `pairing.ts` for any client that can implement it. This module is a
 * compatibility path for the mobile builds, and should be deleted when they
 * move over.
 *
 * ── Envelope ─────────────────────────────────────────────────────────────────
 * The exact shape `KeyQRDecryptService.swift` parses. Every field is base64url
 * without padding; `iter` is a number, `v` a number, and the plaintext's fields
 * are **all strings** — iOS decodes the inner JSON as `[String: String]` and a
 * numeric `key_version` makes the whole parse fail with "missing fields".
 *
 *   { "v": 1, "alg": "pbkdf2-sha256+xsalsa20",
 *     "salt": "…", "nonce": "…", "ct": "…", "iter": 600000 }
 *
 * KDF     PBKDF2-SHA256 over the PIN, 32-byte output
 * Cipher  XSalsa20-Poly1305 (libsodium secretbox), 24-byte nonce, combined
 *         MAC||ciphertext — which is what `sodium.secretBox.open` expects
 */

import sodium from 'libsodium-wrappers';
import { activeEntry, type Keyring } from './keyring';

/** Matches `KeyQRDecryptService`'s fallback, so an older build without `iter` still opens this. */
export const MOBILE_QR_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const PIN_DIGITS = 6;

/** The outer JSON the QR image carries. */
export interface MobileKeyQrEnvelope {
  v: 1;
  alg: 'pbkdf2-sha256+xsalsa20';
  salt: string;
  nonce: string;
  ct: string;
  iter: number;
}

export interface MobileKeyQr {
  /** JSON to render as the QR image. */
  payload: string;
  /** The digits to display alongside it. */
  pin: string;
  /** Which keyring version is inside — shown so the user can tell what the phone will hold. */
  keyVersion: number;
  /**
   * Versions the phone will *not* receive.
   *
   * iOS stores a single keypair (`KeyBundle`), so only the active entry fits.
   * After a rotation the phone therefore cannot read files sealed to a retired
   * version, and the UI has to say so rather than let it look like a full
   * transfer. Empty until the account has rotated at least once.
   */
  omittedVersions: number[];
}

function utf8(text: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(text));
}

function b64u(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

/**
 * A uniformly random PIN.
 *
 * Rejection sampling rather than `% 10`: a byte is 256 values, so folding it
 * into ten digits would make 0–5 appear 26 times per 256 and 6–9 only 25,
 * measurably skewing a secret that is already short enough to grind.
 */
export function generateQrPin(digits: number = PIN_DIGITS): string {
  let pin = '';
  while (pin.length < digits) {
    for (const byte of sodium.randombytes_buf(digits)) {
      if (byte < 250) {
        pin += String(byte % 10);
        if (pin.length === digits) break;
      }
    }
  }
  return pin;
}

/**
 * Derive the secretbox key from the PIN.
 *
 * WebCrypto rather than libsodium: libsodium has no PBKDF2, and matching iOS's
 * `CCKeyDerivationPBKDF` exactly is the whole point — a different KDF here is
 * an envelope the phone cannot open no matter how correct the rest is.
 */
async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  // The cast, not a copy. WebCrypto's `BufferSource` wants a view over a plain
  // `ArrayBuffer`, while `Uint8Array.buffer` is typed `ArrayBufferLike` (which
  // admits `SharedArrayBuffer`), so this does not typecheck as written and the
  // build fails on it. Re-slicing the buffer to satisfy the type is what jsdom
  // then rejects at runtime — a detached-realm `ArrayBuffer` is not one of the
  // instances `importKey` accepts. The values here are always ordinary
  // `Uint8Array`s over ordinary buffers; only the type is imprecise.
  const bytes = (u8: Uint8Array) => u8 as unknown as BufferSource;
  const material = await crypto.subtle.importKey(
    'raw', bytes(utf8(pin)), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytes(salt), iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Build the QR payload and its PIN for the keyring's active entry.
 *
 * The PIN is generated here and returned rather than accepted as an argument,
 * so no caller can pass a user-chosen one through by mistake.
 */
export async function exportKeyQr(keyring: Keyring): Promise<MobileKeyQr> {
  const entry = activeEntry(keyring);
  const pin = generateQrPin();

  // iOS re-derives the public half and compares, so both are sent verbatim
  // rather than letting the phone reconstruct one and risk a mismatch.
  const inner = utf8(
    JSON.stringify({
      public_key: b64u(entry.publicKey),
      private_key: b64u(entry.secretKey),
      key_version: String(entry.version),
    }),
  );

  const salt = sodium.randombytes_buf(SALT_BYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const key = await deriveKey(pin, salt, MOBILE_QR_ITERATIONS);

  const ct = sodium.crypto_secretbox_easy(inner, nonce, key);
  inner.fill(0);
  key.fill(0);

  const envelope: MobileKeyQrEnvelope = {
    v: 1,
    alg: 'pbkdf2-sha256+xsalsa20',
    salt: b64u(salt),
    nonce: b64u(nonce),
    ct: b64u(ct),
    iter: MOBILE_QR_ITERATIONS,
  };

  return {
    payload: JSON.stringify(envelope),
    pin,
    keyVersion: entry.version,
    omittedVersions: keyring.entries
      .filter((e) => e.version !== entry.version)
      .map((e) => e.version),
  };
}

/**
 * Open an envelope this module produced.
 *
 * Exported for the round-trip test, which is the only thing that proves the
 * bytes match what iOS expects without a phone in the loop. Returns the inner
 * JSON string.
 */
export async function openKeyQr(payload: string, pin: string): Promise<string> {
  const envelope = JSON.parse(payload) as MobileKeyQrEnvelope;
  if (envelope.v !== 1 || envelope.alg !== 'pbkdf2-sha256+xsalsa20') {
    throw new Error('Unsupported key QR envelope');
  }
  const unb64u = (s: string) => sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);

  const key = await deriveKey(pin, unb64u(envelope.salt), envelope.iter ?? MOBILE_QR_ITERATIONS);

  // libsodium-wrappers *throws* on a failed open rather than returning null, and
  // its message ("wrong secret key for the given ciphertext") describes the key
  // it derived rather than the PIN the user typed.
  let opened: Uint8Array;
  try {
    opened = sodium.crypto_secretbox_open_easy(unb64u(envelope.ct), unb64u(envelope.nonce), key);
  } catch {
    throw new Error('Could not open the key QR — wrong PIN?');
  } finally {
    key.fill(0);
  }
  return new TextDecoder().decode(opened);
}

/** Overwrite a rendered payload's backing string reference. See the header on lifetime. */
export function expireQrPayload(qr: MobileKeyQr): MobileKeyQr {
  return { ...qr, payload: '', pin: '' };
}
