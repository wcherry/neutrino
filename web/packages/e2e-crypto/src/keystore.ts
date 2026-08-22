'use client';

/**
 * Access to the user's identity key.
 *
 * Historically this persisted the secret key as plaintext base64url in
 * localStorage, then read it from a server-side vault. It now reads from the
 * in-memory keyring established by an unlock (see `session.ts`), whose durable
 * copy is this device's IndexedDB record (see `keystoreLocal.ts`). Nothing
 * leaves the device and nothing plain touches disk.
 *
 * `loadKeyPair` keeps its original synchronous signature, and returns the
 * **active** entry — the one new work is sealed to. Opening an existing file
 * needs the version it was sealed to instead: use `loadKeyPairForVersion`, or
 * `openSealedFileKey`, which resolves the version and reports a missing one as
 * the actionable thing it is.
 */

import {
  clearSession,
  getActiveKeyVersion,
  getSessionKeyPair,
  getSessionKeyPairForVersion,
  type SessionKeyPair,
} from './session';
import { decryptFileKey } from './crypto';

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

/** The active keypair for `userId`, or null while locked. */
export function loadKeyPair(userId: string): SessionKeyPair | null {
  return getSessionKeyPair(userId);
}

/** The keypair for a specific key version, or null if this device lacks it. */
export function loadKeyPairForVersion(userId: string, version: number): SessionKeyPair | null {
  return getSessionKeyPairForVersion(userId, version);
}

/** The version new work should be sealed to, or null while locked. */
export function activeKeyVersion(userId: string): number | null {
  return getActiveKeyVersion(userId);
}

/** True when the session is unlocked for `userId`. */
export function hasKeyPair(userId: string): boolean {
  return getSessionKeyPair(userId) !== null;
}

/** Lock the session, wiping the keyring from memory. */
export function clearKeyPair(_userId?: string): void {
  clearSession();
}

/**
 * Open a DEK that was sealed to `keyVersion` of `userId`'s keyring.
 *
 * The one place that resolves a version, so the "this device does not have that
 * key" case is reported once, in terms a user can act on, instead of surfacing
 * at each call site as an unexplained decryption failure.
 *
 * `keyVersion` is optional because rows written before rotation existed carry
 * no version; those are version 1 by definition.
 */
export function openSealedFileKey(
  userId: string,
  encryptedFileKey: string,
  keyVersion = 1,
): Uint8Array {
  const kp = loadKeyPairForVersion(userId, keyVersion);
  if (!kp) {
    if (!hasKeyPair(userId)) {
      throw new Error('Your encryption key is locked');
    }
    throw new Error(
      `This file needs encryption key version ${keyVersion}, which this device does not have. ` +
        'Restore your recovery kit or pair with a device that has it.',
    );
  }
  return decryptFileKey(encryptedFileKey, kp.publicKey, kp.secretKey);
}
