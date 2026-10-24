'use client';

/**
 * Where an editor's back button goes.
 *
 * Every editor's back button used to push a fixed route — `/drive`, or
 * `/diagrams` — so a document opened from a sub-folder, from an app's own
 * library, from search or from Recent came back out at the root of My Drive.
 * The place the user came from is the one the button should return to.
 *
 * `router.back()` is not that place: an editor rewrites its own URL (a new
 * document's id, Save As, Make a copy), a document can be opened in a new tab
 * or from a link, and in each of those the previous history entry is another
 * editor or nothing at all. So the shell instead remembers the last route that
 * was *not* an editor, per tab, and the editors return there — falling back to
 * their old fixed route when the tab has never been anywhere else.
 */

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const RETURN_KEY = 'neutrino.editorReturn';

/**
 * Routes that are not somewhere to return to: the editors themselves, and the
 * Universal Link landing page, which only ever forwards into an editor.
 */
const NOT_A_RETURN_ROUTE = /^\/((docs|sheets|slides|notes|diagrams|drawing|photos)\/editor|open)(\/|$)/;

export function isReturnRoute(pathname: string): boolean {
  return !NOT_A_RETURN_ROUTE.test(pathname);
}

/**
 * Records the current route as the editors' return location whenever it is
 * one. Mounted once by the app shell; it reads search params (a Drive folder is
 * `?folder=`), so it must sit under a Suspense boundary.
 */
export function EditorReturnTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    if (!isReturnRoute(pathname)) return;
    try {
      sessionStorage.setItem(RETURN_KEY, search ? `${pathname}?${search}` : pathname);
    } catch {
      // No session storage: the editors fall back to their fixed route.
    }
  }, [pathname, search]);
  return null;
}

export function editorReturnHref(fallback: string): string {
  try {
    return sessionStorage.getItem(RETURN_KEY) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Navigates out of an editor to where the user came from, or to `fallback`. */
export function useEditorExit(fallback = '/drive'): () => void {
  const router = useRouter();
  return useCallback(() => router.push(editorReturnHref(fallback)), [router, fallback]);
}
