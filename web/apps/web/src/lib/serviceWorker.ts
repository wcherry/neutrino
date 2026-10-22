/**
 * Registering the service worker (production) or tearing it down (development) — the body of
 * every root layout's service-worker component. A plain module, not a component, so each root can
 * mount its own small client component around it: a client component shared by two roots ships,
 * on every page that uses it, the scripts of whichever root Next bundled it with (see
 * `app/(public)/PublicRuntime.tsx`).
 */

const isProduction = process.env.NODE_ENV === 'production';

export function registerServiceWorker(): void {
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
}
