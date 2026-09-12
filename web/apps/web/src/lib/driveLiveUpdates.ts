import type { QueryClient } from '@tanstack/react-query';

/**
 * Live Drive updates — the client half of `shared::drive_events` on the server.
 *
 * A listing here is a cached query, and nothing in its read path could tell an open tab that a
 * *different* client had changed the folder it was showing: the iOS Drive app uploading a photo,
 * the macOS sync agent, another browser. React Query's `refetchOnWindowFocus` covered tabbing away
 * and back, which is why the staleness only ever showed up on a window that already had focus.
 *
 * The server now pushes a signal on the notification socket the shell already holds open. The
 * signal says only "something in your drive changed" — no file, no folder, no description — and
 * this module turns it into a re-read of whatever listing is on screen. That is the same shape
 * `useFileSync` uses for notes, and it is what lets one message keep every listing correct without
 * the server having to describe a change in the vocabulary of each view that renders one.
 */

/** Dispatched on `window` by `useNotifications` when a drive-change signal arrives. */
export const DRIVE_CHANGED_EVENT = 'neutrino:drive-changed';

/** The wire `type` of the signal. Inbox records carry no `type` at all. */
export const DRIVE_CHANGED_TYPE = 'drive.changed';

export interface DriveChangedSignal {
  type: typeof DRIVE_CHANGED_TYPE;
  /**
   * The client every change behind this signal came from, when they all came from one. Null when
   * the server coalesced changes from more than one client, or when the client that made them sent
   * no id (every native app) — in which case nobody may treat the signal as their own echo.
   */
  originClientId: string | null;
}

/**
 * Query key roots whose data is a listing of Drive files or folders.
 *
 * Grouped by the surface that renders them rather than sorted, because the question asked of this
 * list is always "is my view covered?". Most of these render `FileGrid`, directly or through
 * `DocumentLibrary`; `notes`, `diagrams` and the photo keys are the hand-written pages that
 * predate that component (see `web/CLAUDE.md`) and are listed here so they behave the same until
 * they are folded into it.
 *
 * Anything not a listing is deliberately absent: a file's own versions, tags, comments or
 * permissions are read when that file is opened and are not what goes stale behind an upload.
 */
export const LISTING_QUERY_KEYS: readonly string[] = [
  // Drive views
  'contents',
  'recent',
  'starred',
  'starred-page',
  'shared-with-me',
  'trash',
  'tags',
  'tag-files',
  // The folder browser inside Move to — a destination folder can appear while the dialog is open
  'move-folder-browse',
  'move-team-browse',
  // Team Spaces
  'team-library',
  'team-shares',
  // Office suite landing pages, via DocumentLibrary
  'docs',
  'sheets',
  'slides',
  'drawings',
  // Hand-written listings
  'notes',
  'diagrams',
  'photos',
  'photo-motion',
  'albums',
];

const LISTING_KEY_SET = new Set(LISTING_QUERY_KEYS);

/**
 * Re-read every listing currently on screen.
 *
 * A predicate over the key root rather than a call per key: the roots are the stable part of each
 * key (the rest carries a folder id, a sort, a filter chip) and a view must refresh whichever of
 * its pages the user has scrolled to. Broad on purpose, and cheap because of how invalidation
 * works — React Query refetches only *active* queries and merely marks the rest stale, so a signal
 * arriving while Drive is open costs one folder read and nothing for the twenty other keys here.
 */
export function invalidateDriveListings(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return typeof root === 'string' && LISTING_KEY_SET.has(root);
    },
  });
}

/**
 * Reads a socket message as a drive-change signal, or returns null if it is something else.
 *
 * The notification socket carries inbox records too, and they are told apart by `type` being
 * absent on them rather than by a new field on every record — so an older server, or a message
 * kind added later, is ignored here instead of being mistaken for one.
 */
export function parseDriveChangedSignal(data: unknown): DriveChangedSignal | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Partial<DriveChangedSignal>;
  if (message.type !== DRIVE_CHANGED_TYPE) return null;
  return {
    type: DRIVE_CHANGED_TYPE,
    originClientId: typeof message.originClientId === 'string' ? message.originClientId : null,
  };
}
