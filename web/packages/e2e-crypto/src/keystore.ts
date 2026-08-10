'use client';

/**
 * Access to the user's Curve25519 identity key.
 *
 * This module used to persist the secret key as plaintext base64url in
 * localStorage. It now reads from the in-memory session established by an
 * unlock (see `session.ts`), with the durable copy living server-side as a
 * wrapped blob (see `vault.ts`). Nothing secret touches disk.
 *
 * `loadKeyPair` and `hasKeyPair` keep their original synchronous signatures on
 * purpose: a dozen call sites across Drive, Docs, Notes, Photos and search
 * depend on them, and unlocking is gated at the app shell so by the time those
 * run the key is already in memory. A locked session returns null, which is the
 * same "no key" branch those call sites already handled.
 */

import sodium from 'libsodium-wrappers';
import {
  clearSession,
  getSessionKeyPair,
  setSessionKeyPair,
  type SessionKeyPair,
} from './session';

export interface StoredKeyPair {
  /** Base64url-encoded Curve25519 public key (32 bytes). */
  publicKey: string;
  /** Base64url-encoded Curve25519 secret key (32 bytes). */
  secretKey: string;
}

/** Key under which the pre-vault build kept the plaintext secret key. */
const LEGACY_STORAGE_PREFIX = 'neutrino_e2e_';

export function fromBase64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function fromBase64(s: string): Uint8Array {
  const binary = atob(s.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Put a keypair into the unlocked session.
 *
 * Does *not* persist — call `createVault` from `@neutrino/auth` to store a
 * wrapped copy the user's other devices can open.
 */
export function saveKeyPair(userId: string, publicKey: Uint8Array, secretKey: Uint8Array): void {
  setSessionKeyPair(userId, { publicKey, secretKey });
}

/** The unlocked keypair for `userId`, or null while locked. */
export function loadKeyPair(userId: string): SessionKeyPair | null {
  return getSessionKeyPair(userId);
}

/** True when the session is unlocked for `userId`. */
export function hasKeyPair(userId: string): boolean {
  return getSessionKeyPair(userId) !== null;
}

/** Lock the session, wiping the key from memory. */
export function clearKeyPair(_userId?: string): void {
  clearSession();
}

// ── Migration off the plaintext localStorage keystore ─────────────────────────

/**
 * Read a plaintext keypair left by the pre-vault build, if one is there.
 *
 * Used once at login to move an existing key into a vault instead of stranding
 * the user's files behind a key format that is going away. Returns null when
 * there is nothing to migrate.
 */
export function readLegacyKeyPair(userId: string): SessionKeyPair | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredKeyPair;
    const publicKey = fromBase64url(stored.publicKey);
    const secretKey = fromBase64url(stored.secretKey);
    if (
      publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
      secretKey.length !== sodium.crypto_box_SECRETKEYBYTES
    ) {
      return null;
    }
    return { publicKey, secretKey };
  } catch {
    return null;
  }
}

/** True if a plaintext key from the old build is still on disk. */
export function hasLegacyKeyPair(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${userId}`) !== null;
}

/**
 * Delete the plaintext key.
 *
 * Only call this once the wrapped vault is confirmed stored — it is the last
 * copy of the key until then.
 */
export function clearLegacyKeyPair(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${userId}`);
}
