'use client';

import { useQuery } from '@tanstack/react-query';
import { usePreference } from '@neutrino/preferences';
import { filesystemApi, type FileItem } from '@/lib/api';

/** The most Quick access lists, on the Drive page and in the top bar's menu alike. */
export const QUICK_ACCESS_LIMIT = 12;

/**
 * Starred files and folders share one limit server-side, so a handful of starred folders would
 * crowd files out of a request for twelve. Starring is rare enough that this is the whole list.
 */
const STARRED_FETCH_LIMIT = 50;

export interface QuickAccessEntry {
  file: FileItem;
  /** Why it is listed: edited inside the window, or starred. */
  reason: 'recent' | 'starred';
}

/**
 * What Quick access lists, in every look and every place it appears: the files edited in the
 * last `drive.quickAccessDays` days, newest first, then starred files by when they were starred,
 * without repeats, up to twelve in all.
 *
 * "Edited" is the file's `updatedAt`, the only recency the server keeps; opening a file without
 * changing it does not move it. Starred order is the server's (`starred_at`, newest first), and
 * files starred before that column existed come last. Both query keys sit under the `recent` and
 * `starred` roots, so starring a file and a change from another device both refresh the list.
 */
export function quickAccessEntries(
  recent: FileItem[] | undefined,
  starred: FileItem[] | undefined,
  days: number,
  now: number = Date.now(),
): QuickAccessEntry[] {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const out: QuickAccessEntry[] = [];
  const add = (file: FileItem, reason: QuickAccessEntry['reason']) => {
    if (out.length >= QUICK_ACCESS_LIMIT || seen.has(file.id)) return;
    seen.add(file.id);
    out.push({ file, reason });
  };
  for (const file of recent ?? []) {
    if (Date.parse(file.updatedAt) >= cutoff) add(file, 'recent');
  }
  for (const file of starred ?? []) add(file, 'starred');
  return out;
}

export function useQuickAccess({ enabled = true }: { enabled?: boolean } = {}): {
  entries: QuickAccessEntry[] | undefined;
  loading: boolean;
} {
  const [days] = usePreference('drive.quickAccessDays');
  const recent = useQuery({
    queryKey: ['recent', 'quick-access'],
    queryFn: () => filesystemApi.getRecent({ limit: QUICK_ACCESS_LIMIT }),
    enabled,
  });
  const starred = useQuery({
    queryKey: ['starred', 'quick-access'],
    queryFn: () => filesystemApi.getStarred(STARRED_FETCH_LIMIT),
    enabled,
  });
  const ready = recent.data !== undefined && starred.data !== undefined;
  return {
    entries: ready ? quickAccessEntries(recent.data?.files, starred.data?.files, Number(days) || 7) : undefined,
    loading: recent.isLoading || starred.isLoading,
  };
}
