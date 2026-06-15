'use client';

/**
 * Persistent key storage using localStorage.
 *
 * The Curve25519 secret key is stored as base64url in localStorage under
 * a per-user key.  In Phase 1 the secret key is stored *plaintext* so that
 * signup → login → decrypt works without re-entering a password.
 *
 * Phase 2 upgrade path: replace `saveKeyPair` / `loadKeyPair` with versions
 * that encrypt the secret key with an Argon2id-derived KEK before persisting.
 */

const STORAGE_PREFIX = 'neutrino_e2e_';

export interface StoredKeyPair {
  /** Base64url-encoded Curve25519 public key (32 bytes). */
  publicKey: string;
  /** Base64url-encoded Curve25519 secret key (32 bytes). */
  secretKey: string;
}

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

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

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

/**
 * Persist a keypair for `userId`.
 */
export function saveKeyPair(
  userId: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): void {
  if (typeof window === 'undefined') return;
  const stored: StoredKeyPair = {
    publicKey: toBase64url(publicKey),
    secretKey: toBase64url(secretKey),
  };
  localStorage.setItem(storageKey(userId), JSON.stringify(stored));
}

/**
 * Load the stored keypair for `userId`, or return `null` if none exists.
 */
export function loadKeyPair(
  userId: string,
): { publicKey: Uint8Array; secretKey: Uint8Array } | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredKeyPair;
    return {
      publicKey: fromBase64url(stored.publicKey),
      secretKey: fromBase64url(stored.secretKey),
    };
  } catch {
    return null;
  }
}

/**
 * Remove the stored keypair for `userId` (e.g. on logout).
 */
export function clearKeyPair(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(storageKey(userId));
}

/**
 * Returns true if a keypair for `userId` is stored.
 */
export function hasKeyPair(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(storageKey(userId)) !== null;
}
