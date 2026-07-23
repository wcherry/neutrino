'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks browser online/offline state via `navigator.onLine` and the
 * `online`/`offline` window events.
 *
 * `navigator.onLine` is a weak signal: it only reflects whether a network
 * interface is present (e.g. Wi-Fi/Ethernet is up), not whether the app can
 * actually reach the server — a device can report `true` while sitting on a
 * captive portal or a dead connection. Use this hook to drive UI badges and
 * to trigger a reconnect / revision check, never as the sole gate for
 * falling back to an offline cache. The authoritative signal for "the
 * network call failed" is always the actual fetch error (see
 * `ApiClientError` vs. raw `TypeError` handling in the offline cache
 * integration), not this hook.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
