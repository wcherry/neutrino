'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

import {
  allFlagsOff,
  assertEveryFlagPresent,
  type FeatureFlagKey,
  type FeatureFlags,
} from '@/lib/featureFlags';

export type { FeatureFlagKey, FeatureFlags };

type FeatureFlagsContextValue = {
  flags: FeatureFlags;
  loaded: boolean;
  /** The reason the flags could not be read, when that is what happened. */
  error: string | null;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: allFlagsOff(),
  loaded: false,
  error: null,
});

/**
 * Fetches the flag map once and holds it for the tree.
 *
 * Unauthenticated, and above `AuthProvider` in the layout, because what the sign-in page itself
 * renders can depend on a flag.
 *
 * Two failure modes, deliberately treated differently:
 *
 * - **The fetch fails** — offline, the server is down, a 500. Every flag reads off, because a
 *   gated feature that cannot confirm it is enabled must not render. That is a `false` the app is
 *   entitled to act on.
 * - **The response is missing a key this client declares.** Not a network problem: the table has
 *   no row for a flag the product knows about, which is a deployment fault. It is logged as an
 *   error naming the keys, and in development it throws so it cannot be walked past. Everything
 *   still reads off — a broken flag map must not accidentally enable anything — but the difference
 *   between "off" and "nobody knows" is now visible instead of silent.
 */
export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(allFlagsOff);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/v1/feature-flags')
      .then((r) => {
        if (!r.ok) throw new Error(`Feature flags request failed with ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setFlags(assertEveryFlagPresent(data));
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error('[feature-flags]', message);
        setError(message);
        setLoaded(true);
        if (process.env.NODE_ENV === 'development') {
          // Surfaced as an unhandled rejection rather than a render-time throw, so a misconfigured
          // table is loud in the console without blanking the app for whoever is fixing it.
          throw e;
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <FeatureFlagsContext.Provider value={{ flags, loaded, error }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext).flags;
}

/**
 * Whether the flags have been read yet.
 *
 * Worth waiting on wherever "off" and "not known yet" would look different to a user — a nav entry
 * that appears a beat after the page does, say. Everything else can read the flag and treat the
 * pre-load state as off.
 */
export function useFeatureFlagsLoaded(): boolean {
  return useContext(FeatureFlagsContext).loaded;
}

/** The flag map's error, for a surface that wants to say why a feature is missing. */
export function useFeatureFlagsError(): string | null {
  return useContext(FeatureFlagsContext).error;
}
