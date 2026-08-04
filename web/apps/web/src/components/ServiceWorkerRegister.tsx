'use client';

import { useEffect } from 'react';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Registers the app-shell service worker (`/sw.js`) on every production boot
 * — including before auth resolves. This must stay outside the `(apps)` route
 * group's post-auth logic: the entire point of the PWA app shell is that a
 * cold, fully offline launch (e.g. from a bookmark or `.webloc` shortcut) can
 * still load the JS needed to check the local offline cache, and that has to
 * happen before the app even knows whether the user is authenticated.
 *
 * In development it does the exact opposite: it tears the worker down. `next
 * dev` serves `public/sw.js` verbatim, so the `__BUILD_ID__` placeholder is
 * never stamped (`scripts/stamp-sw-build-id.mjs` only rewrites `out/sw.js` in
 * the `postbuild` step) and the cache name is a single constant for all time.
 * Combined with the worker's cache-first strategy, that pins every chunk, CSS
 * file and HTML document to whatever was fetched on the first-ever localhost
 * load: a normal reload is served the stale copy and only a hard reload — which
 * bypasses the worker — picks up code changes. It also swallows the
 * `/_next/webpack-hmr` event stream, so hot reload never arrives either.
 *
 * Unregistering is not merely skipping registration. A worker installed by an
 * earlier dev session (or by a local production build) stays installed and
 * keeps controlling the page until something removes it, so we actively
 * unregister and drop its caches to un-wedge machines that already have one.
 *
 * Mirrors the side-effect-only client component pattern already established
 * by `E2ECryptoExpose`.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    if (!isProduction) {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          const unregistered = await Promise.all(
            registrations.map((registration) => registration.unregister()),
          );

          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(
              cacheNames
                .filter((name) => name.startsWith('neutrino-shell-'))
                .map((name) => caches.delete(name)),
            );
          }

          // The page is still controlled by the worker we just unregistered,
          // so this load is being served from its cache. One reload hands the
          // page back to the network for good.
          if (unregistered.some(Boolean) && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        } catch {
          // Best-effort cleanup — a browser that refuses to enumerate
          // registrations still leaves the dev server perfectly usable.
        }
      })();
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure (e.g. unsupported browser, dev environment
      // serving over non-HTTPS localhost quirks) is non-fatal — the app
      // still works online, it just won't have offline app-shell caching.
    });
  }, []);
  return null;
}
