'use client';

/**
 * Writes the Live Photo links the library can see are missing, as the library is browsed.
 *
 * The web pairs a still with its clip by content identifier or filename stem whether or not the
 * still stores `device.liveVideoFileID`; the iOS apps only follow that field. So every pair shown
 * here without it is a Live Photo the phone can't play or save back — until this writes it
 * (`agent_docs/live-photos.md`). That repairs a library imported before the link existed, a page
 * at a time, with no migration: the server can't do it, since it can't read what's in the files.
 *
 * Cheap on purpose. Nothing is refetched afterwards (the web already shows the pair); each still is
 * tried once per mount, so a write that fails doesn't retry in a loop; a pass writes at most
 * [MAX_PER_PASS], one request at a time; and unmounting stops it.
 */

import { useEffect, useRef } from 'react';
import type { LibraryItem } from '@neutrino/api-photos';
import { pendingMotionLinks, writeMotionLinks, type MergeMetadata } from '@/lib/motionLinks';

export const MAX_PER_PASS = 25;

export function useMotionLinkBackfill(items: LibraryItem[], merge?: MergeMetadata): void {
  const tried = useRef(new Set<string>());

  useEffect(() => {
    const links = pendingMotionLinks(items, tried.current, MAX_PER_PASS);
    if (links.length === 0) return;
    for (const link of links) tried.current.add(link.photoId);
    const controller = new AbortController();
    void writeMotionLinks(links, merge, controller.signal);
    return () => controller.abort();
  }, [items, merge]);
}
