'use client';

import { useEffect } from 'react';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { isSyncDue, syncSearchIndex } from '@/lib/searchIndexer';

/** One run at a time per tab — remounts and focus events share this promise. */
let inFlight: Promise<unknown> | null = null;

/** Settings → Advanced writes this; the toggle is only meaningful if we read it. */
const SYNC_DISABLED_KEY = 'neutrino:search:syncDisabled';

function syncDisabled(): boolean {
  try {
    return localStorage.getItem(SYNC_DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function runSync(userId: string): void {
  if (inFlight || syncDisabled() || !isSyncDue(userId)) return;
  inFlight = syncSearchIndex(userId)
    .catch(() => {
      // Indexing is best-effort background work; a failed run retries later.
    })
    .finally(() => {
      inFlight = null;
    });
}

/**
 * Keeps the client-side search index populated.
 *
 * Search reads only from the local index, so without this the box has nothing
 * to match against until someone hits "Rebuild index" in Settings. The sync is
 * incremental (unchanged items are never re-fetched) and throttled, so running
 * it on every app mount and on tab focus is cheap.
 */
export function useSearchIndexSync(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    // The index stores decrypted text, so it only makes sense once the user's
    // E2EE keys are on this device — the same gate the search engine uses.
    if (!loadKeyPair(userId)) return;

    runSync(userId);

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && userId) runSync(userId);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [userId]);
}
