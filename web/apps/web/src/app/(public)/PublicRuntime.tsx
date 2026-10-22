'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/serviceWorker';

/*
 * The signed-out root's own client components (`share/ShareQueryProvider.tsx` is the other).
 * They do what `ServiceWorkerRegister` and `QueryProvider` do, and deliberately are not those
 * components: Next records one set of script chunks per client component, taken from whichever
 * root layout bundled it, so a client component shared with the `(apps)` or `(mirror)` root made
 * `/sign-in` load that root's whole provider stack (framer-motion, the toast and theme providers,
 * feature flags) — about 160 KB, and which root "won" changed from build to build. The logic they
 * share lives in plain modules in `lib/`, which carry no such link; `scripts/check-route-budgets.mjs`
 * is what caught it. One component per file, too: a module's chunk is all of its imports, so a
 * query provider in this file put React Query on `/sign-in`.
 */

export function PublicServiceWorker() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
