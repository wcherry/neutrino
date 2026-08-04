'use client';

import { useEffect } from 'react';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { isSyncDue, syncSearchIndex } from '@/lib/searchIndexer';
import { pullSnapshot, syncSnapshot } from '@/lib/searchIndexSnapshot';

/** One run at a time per tab — remounts and focus events share this promise. */
let inFlight: Promise<unknown> | null = null;

/**
 * Floor between passes. `syncSearchIndex` has its own five-minute throttle, but
 * the snapshot pull sits outside it so a newly-restored index shows up without
 * waiting — this stops alt-tabbing from turning that into a request per focus.
 */
const MIN_RUN_INTERVAL_MS = 60_000;
let lastRunAt = 0;

/** Settings → Advanced writes this; the toggle is only meaningful if we read it. */
const SYNC_DISABLED_KEY = 'neutrino:search:syncDisabled';

function syncDisabled(): boolean {
  try {
    return localStorage.getItem(SYNC_DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * One full pass: adopt another device's index, bring it in line with the
 * server, then share the result.
 *
 * The snapshot pull runs *first* and unthrottled. It is one small metadata
 * request in the steady state, and when it does have something it saves the
 * local rebuild entirely — a device that pulls a populated index has nothing
 * left for `syncSearchIndex` to fetch, because every document already matches
 * the server's `updatedAt`.
 */
async function runFullSync(userId: string): Promise<void> {
  try {
    await pullSnapshot(userId);
  } catch {
    // A device that cannot reach the snapshot still indexes locally; it just
    // pays the full cost. Never let this block the local sync below.
  }

  if (isSyncDue(userId)) {
    await syncSearchIndex(userId);
  }

  try {
    await syncSnapshot(userId);
  } catch {
    // Sharing the index is best-effort — the local one is already correct.
  }
}

function runSync(userId: string): void {
  if (inFlight || syncDisabled()) return;
  if (Date.now() - lastRunAt < MIN_RUN_INTERVAL_MS) return;
  lastRunAt = Date.now();
  inFlight = runFullSync(userId)
    .catch(() => {
      // Indexing is best-effort background work; a failed run retries later.
    })
    .finally(() => {
      inFlight = null;
    });
}

/**
 * Keeps the client-side search index populated and in step with the user's
 * other devices.
 *
 * Search reads only from the local index, so without this the box has nothing
 * to match against until someone hits "Rebuild index" in Settings. The local
 * sync is incremental (unchanged items are never re-fetched) and throttled, and
 * the snapshot exchange is skipped whenever nothing has changed, so running the
 * whole thing on every app mount and tab focus is cheap.
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
