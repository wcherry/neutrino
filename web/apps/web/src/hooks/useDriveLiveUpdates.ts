'use client';

/**
 * useDriveLiveUpdates
 *
 * Keeps every Drive listing in step with changes made elsewhere — the iOS apps, the macOS sync
 * agent, another browser — without a manual refresh.
 *
 * Mounted once, in the `(apps)` shell, above every route. That is the whole point: the listing
 * surfaces share `FileGrid` and nothing about refreshing them is per-page, so this is one hook in
 * one place rather than a `refetchInterval` copied onto each view. Pages need no change at all;
 * `invalidateDriveListings` re-reads whichever listing happens to be mounted.
 *
 * The signal arrives on the notification socket `useNotifications` already holds open (no second
 * socket per tab), which is why `connected` is passed in rather than discovered here.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DRIVE_CHANGED_EVENT, invalidateDriveListings } from '@/lib/driveLiveUpdates';

/**
 * How often to re-read listings while the socket is down.
 *
 * Only a fallback: a blocked or failed WebSocket should degrade to eventual consistency rather
 * than to no consistency, which is the same trade the notes editor makes at 15 s. Slower than that
 * one because this polls on behalf of whatever listing is open rather than a single file, and a
 * folder appearing half a minute late is a far smaller thing than a lost keystroke.
 */
const OFFLINE_POLL_MS = 30_000;

export interface UseDriveLiveUpdatesOptions {
  /** Whether the notification socket carrying the signal is open. */
  connected: boolean;
}

export function useDriveLiveUpdates({ connected }: UseDriveLiveUpdatesOptions): void {
  const queryClient = useQueryClient();
  const hasConnectedRef = useRef(false);

  /**
   * Catch up after a gap.
   *
   * A signal is pushed to whoever is connected and is not queued for anyone who is not, so
   * everything sent while the socket was down is simply gone. This is what makes that survivable
   * without reasoning about *why* it was down — a dropped connection, a sleeping laptop, a proxy
   * timing out an idle socket, a failed token refresh — and it is the half that matters for a tab
   * left open all day, which is exactly when a socket is most likely to have quietly died.
   *
   * Deliberately not on the *first* connect: the listing was read on mount a moment earlier, and
   * invalidating then would make every page load fetch its folder twice.
   */
  useEffect(() => {
    if (!connected) return;
    if (hasConnectedRef.current) {
      void invalidateDriveListings(queryClient);
    }
    hasConnectedRef.current = true;
  }, [connected, queryClient]);

  useEffect(() => {
    const onDriveChanged = () => {
      void invalidateDriveListings(queryClient);
    };
    window.addEventListener(DRIVE_CHANGED_EVENT, onDriveChanged);
    return () => window.removeEventListener(DRIVE_CHANGED_EVENT, onDriveChanged);
  }, [queryClient]);

  useEffect(() => {
    if (connected) return;

    const poll = () => {
      // A hidden tab is not showing a listing, and polling one only spends the user's battery to
      // refresh something nobody is looking at. React Query refetches on focus anyway, so the tab
      // is correct the moment it comes back whether or not this ran.
      if (document.visibilityState !== 'visible') return;
      void invalidateDriveListings(queryClient);
    };

    const timer = setInterval(poll, OFFLINE_POLL_MS);
    return () => clearInterval(timer);
  }, [connected, queryClient]);
}
