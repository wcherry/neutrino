'use client';

import { useEffect, useRef } from 'react';
import { subscribeToSearchIndexUpdates, type SearchIndexUpdate } from '@neutrino/search';

/**
 * Run `onUpdate` whenever the local search index changes — in this tab or in
 * another one.
 *
 * Search surfaces hold their results in component state, so an edit saved in
 * the Docs tab, a periodic sync, or a snapshot pulled from another device all
 * leave what is on screen stale. Subscribing lets a surface re-run its query
 * against the index as it now stands.
 *
 * The callback is held in a ref, so callers can pass an inline function without
 * re-subscribing on every render.
 */
export function useSearchIndexUpdates(onUpdate: (update: SearchIndexUpdate) => void): void {
  const handler = useRef(onUpdate);
  handler.current = onUpdate;

  useEffect(() => subscribeToSearchIndexUpdates((update) => handler.current(update)), []);
}
