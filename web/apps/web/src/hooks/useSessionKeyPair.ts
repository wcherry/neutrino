'use client';

/**
 * The unlocked E2EE identity key, as a reactive value.
 *
 * `loadKeyPair` is a synchronous read of memory that returns null while the
 * vault is locked, and `E2EEUnlockGate` is an overlay rather than a hard gate —
 * so a component that mounts before the user unlocks reads null and, if it read
 * it once inside an effect, keeps behaving as though the account had no key for
 * the rest of the page's life. That is how a spreadsheet renders blank and a
 * photo renders as a broken image seconds after the user typed their unlock
 * password.
 *
 * Subscribing instead of reading means the effect that needs the key re-runs
 * when the key arrives. Use the returned pair *as an effect dependency*, not
 * just inside the body:
 *
 *   const keyPair = useSessionKeyPair();
 *   useEffect(() => { ... }, [keyPair]);
 *
 * The snapshot is the identity-stable object held in `session.ts`, so this is
 * null → keyPair on unlock, keyPair → null on lock, and referentially stable in
 * between (no render loop).
 */

import { useSyncExternalStore } from 'react';
import { getSessionKeyPair, subscribeToLockState, type SessionKeyPair } from '@neutrino/e2e-crypto';

export function useSessionKeyPair(userId: string | null | undefined): SessionKeyPair | null {
  return useSyncExternalStore(
    subscribeToLockState,
    () => (userId ? getSessionKeyPair(userId) : null),
    // The key is memory-only and never exists during SSR.
    () => null,
  );
}
