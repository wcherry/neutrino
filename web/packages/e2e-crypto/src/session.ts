'use client';

/**
 * The unlocked identity key, held in memory for the life of the page.
 *
 * Deliberately *not* persisted. Wrapping the key and then leaving a copy in
 * localStorage, sessionStorage or IndexedDB would hand back everything the
 * vault was built to take away: same-origin script can read all three, and the
 * first two reach disk. Since the key must be raw bytes in JS to open a
 * libsodium sealed box, memory is the only place it is not also at rest.
 *
 * The cost is that a page reload requires unlocking again. That is what the
 * passkey method is for — one Touch ID tap, versus retyping a password.
 */

export interface SessionKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

let sessionUserId: string | null = null;
let sessionKeyPair: SessionKeyPair | null = null;

/**
 * The master key, kept alongside the identity for the same session lifetime.
 *
 * Enrolling a passkey or rotating the password has to wrap the *same* MK, so
 * without this every such action would demand a second unlock. It is no more
 * exposed than the identity key it protects — both are memory-only.
 */
let sessionMasterKey: Uint8Array | null = null;

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

/** Install the unwrapped keypair for `userId`. */
export function setSessionKeyPair(userId: string, keyPair: SessionKeyPair): void {
  sessionUserId = userId;
  sessionKeyPair = keyPair;
  notify();
}

/**
 * The unlocked keypair for `userId`, or null if locked.
 *
 * The user check matters on shared machines: after signing out and back in as
 * someone else, a stale keypair would silently decrypt into the wrong account's
 * session and re-seal DEKs to the wrong identity.
 */
export function getSessionKeyPair(userId: string): SessionKeyPair | null {
  if (!sessionKeyPair || sessionUserId !== userId) return null;
  return sessionKeyPair;
}

export function isUnlocked(userId: string): boolean {
  return getSessionKeyPair(userId) !== null;
}

/** Install the master key for `userId`, so later enrolments can rewrap it. */
export function setSessionMasterKey(userId: string, masterKey: Uint8Array): void {
  sessionUserId = userId;
  sessionMasterKey = masterKey;
}

export function getSessionMasterKey(userId: string): Uint8Array | null {
  if (!sessionMasterKey || sessionUserId !== userId) return null;
  return sessionMasterKey;
}

/** Wipe the keys from memory. Called on logout and on user switch. */
export function clearSession(): void {
  // Zero the bytes rather than only dropping the reference — it does not
  // defeat a determined heap scrape, but it shortens the window for free.
  if (sessionKeyPair) {
    sessionKeyPair.secretKey.fill(0);
    sessionKeyPair.publicKey.fill(0);
  }
  sessionMasterKey?.fill(0);
  sessionUserId = null;
  sessionKeyPair = null;
  sessionMasterKey = null;
  notify();
}
