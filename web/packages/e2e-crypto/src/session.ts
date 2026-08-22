'use client';

/**
 * The unlocked keyring, held in memory for the life of the page.
 *
 * The durable copy lives in this device's IndexedDB as ciphertext (see
 * `keystoreLocal.ts`); this is the opened form, and it is deliberately never
 * written anywhere. Since the secret must be raw bytes in JS to open a libsodium
 * sealed box, memory is the only place it is not also at rest.
 *
 * The wrapping key from the unlock is kept alongside it. That is what lets a
 * rotation re-wrap the keyring to disk without demanding a second Touch ID
 * prompt for a key the user just asked us to make. It is no more exposed than
 * the keyring it protects — both are memory-only, both are wiped on lock.
 */

import { activeEntry, entryForVersion, wipeKeyring, type Keyring } from './keyring';

export interface SessionKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

let sessionUserId: string | null = null;
let sessionKeyring: Keyring | null = null;
let sessionWrappingKey: Uint8Array | null = null;

/** Listeners for lock/unlock transitions, so the UI can gate on it. */
type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // A broken listener must not stop the others from hearing about a lock.
    }
  });
}

export function subscribeToLockState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Install an unlocked keyring.
 *
 * `wrappingKey` is optional because not every path has one — a keyring restored
 * from a recovery kit or received by pairing has not been unlocked from local
 * storage, and is wrapped afresh by the caller.
 */
export function setSessionKeyring(keyring: Keyring, wrappingKey?: Uint8Array): void {
  sessionUserId = keyring.userId;
  sessionKeyring = keyring;
  sessionWrappingKey = wrappingKey ?? null;
  notify();
}

/**
 * The unlocked keyring for `userId`, or null if locked.
 *
 * The user check matters on shared machines: after signing out and back in as
 * someone else, a stale keyring would silently decrypt into the wrong account's
 * session and re-seal DEKs to the wrong identity.
 */
export function getSessionKeyring(userId: string): Keyring | null {
  if (!sessionKeyring || sessionUserId !== userId) return null;
  return sessionKeyring;
}

/**
 * The *active* keypair — what new work is sealed to.
 *
 * Synchronous on purpose. A dozen call sites across Drive, Docs, Notes, Photos
 * and search depend on that, and unlocking is gated at the app shell, so by the
 * time those run the keyring is already in memory. A locked session returns
 * null, which is the same "no key" branch those call sites already handled.
 */
export function getSessionKeyPair(userId: string): SessionKeyPair | null {
  const keyring = getSessionKeyring(userId);
  if (!keyring) return null;
  const active = activeEntry(keyring);
  return { publicKey: active.publicKey, secretKey: active.secretKey };
}

/**
 * The keypair for a specific version — what *opens* an existing file.
 *
 * Returns null when this device's keyring has no such version, so the caller can
 * say which key is missing rather than reporting an unexplained decrypt failure.
 */
export function getSessionKeyPairForVersion(
  userId: string,
  version: number,
): SessionKeyPair | null {
  const keyring = getSessionKeyring(userId);
  if (!keyring) return null;
  const entry = entryForVersion(keyring, version);
  if (!entry) return null;
  return { publicKey: entry.publicKey, secretKey: entry.secretKey };
}

/** The version new work should be sealed to, or null while locked. */
export function getActiveKeyVersion(userId: string): number | null {
  const keyring = getSessionKeyring(userId);
  if (!keyring) return null;
  return activeEntry(keyring).version;
}

export function isUnlocked(userId: string): boolean {
  return getSessionKeyring(userId) !== null;
}

/** The key this device's stored keyring is wrapped under, if the unlock had one. */
export function getSessionWrappingKey(userId: string): Uint8Array | null {
  if (!sessionWrappingKey || sessionUserId !== userId) return null;
  return sessionWrappingKey;
}

export function setSessionWrappingKey(userId: string, wrappingKey: Uint8Array): void {
  sessionUserId = userId;
  sessionWrappingKey = wrappingKey;
}

/** Wipe the keyring from memory. Called on logout and on user switch. */
export function clearSession(): void {
  // Zero the bytes rather than only dropping the reference — it does not defeat
  // a determined heap scrape, but it shortens the window for free.
  if (sessionKeyring) wipeKeyring(sessionKeyring);
  sessionWrappingKey?.fill(0);
  sessionUserId = null;
  sessionKeyring = null;
  sessionWrappingKey = null;
  notify();
}
