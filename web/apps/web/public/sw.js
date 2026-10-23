// Hand-rolled service worker for the Neutrino app shell — deliberately not
// Workbox/next-pwa (no such tooling exists in this build).
//
// Strategy:
//   - API calls (`/api/*`) are left completely untouched: `fetch` returns
//     without calling `event.respondWith(...)`, so the request goes straight
//     to the network. The `@neutrino/offline` IndexedDB layer already owns
//     per-file, DEK-aware, revision-tracked offline handling for API data —
//     a second SW-level cache of API responses would create an uncoordinated
//     stale-data source and undermine that revision-based conflict
//     detection. This is load-bearing, not an oversight.
//   - Pages (navigations) are network-first, falling back to the cached copy
//     only when the network fails. The server writes the instance's brand and
//     the organisation's preference defaults into every page it serves
//     (src/branding/inject.rs); a page served from cache would show them as
//     they were when it was cached, until the next deploy. Revalidating costs
//     a 304 when nothing changed — the page's ETag covers the injected part.
//   - Everything else (the static app shell: JS/CSS/manifest/icons) uses a
//     cache-first strategy: serve from cache if present, otherwise fetch from
//     the network and populate the cache for next time.
//
// __BUILD_ID__ is a placeholder replaced at build time (see
// scripts/stamp-sw-build-id.mjs) with a short git SHA (or a timestamp
// fallback), so every deploy gets a fresh cache name and the activate
// handler evicts the previous shell.
const CACHE_NAME = 'neutrino-shell-__BUILD_ID__';

const API_PATH_PREFIX = '/api/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — let them hit the network directly.
  if (url.pathname.startsWith(API_PATH_PREFIX)) {
    return;
  }

  // Only handle same-origin GET requests for the app shell.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const response = await fetch(event.request);
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch (err) {
          const cached = await cache.match(event.request);
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }

      const response = await fetch(event.request);
      // Response bodies can only be read once — clone before caching so the
      // browser can still consume the original for this request.
      if (response && response.status === 200) {
        cache.put(event.request, response.clone());
      }
      return response;
    })(),
  );
});
