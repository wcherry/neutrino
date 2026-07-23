'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker (`/sw.js`) unconditionally, on
 * every boot — including before auth resolves. This must stay outside the
 * `(apps)` route group's post-auth logic: the entire point of the PWA app
 * shell is that a cold, fully offline launch (e.g. from a bookmark or
 * `.webloc` shortcut) can still load the JS needed to check the local
 * offline cache, and that has to happen before the app even knows whether
 * the user is authenticated.
 *
 * Mirrors the side-effect-only client component pattern already established
 * by `E2ECryptoExpose`.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failure (e.g. unsupported browser, dev environment
        // serving over non-HTTPS localhost quirks) is non-fatal — the app
        // still works online, it just won't have offline app-shell caching.
      });
    }
  }, []);
  return null;
}
