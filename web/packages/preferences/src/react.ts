'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { defaultOf, type PreferenceKey, type PreferenceValues } from './registry';
import { preferences as defaultStore, type PreferenceSource, type PreferenceStore } from './store';
import { readVaultOrLegacy } from './migrate';

/**
 * A preference and its setter, like `useState` — but synced, validated and shared by every
 * component that reads the same key.
 *
 * Replaces each feature's own `localStorage` read, parse, validate, write and `storage`
 * listener. During a server render (the static export's prerender) it returns the default; the
 * real value arrives on hydration, as it did before.
 */
export function usePreference<K extends PreferenceKey>(
  key: K,
  store: PreferenceStore = defaultStore,
): [PreferenceValues[K], (value: PreferenceValues[K]) => void] {
  const value = useSyncExternalStore(
    store.subscribe,
    () => store.get(key),
    () => defaultOf(key),
  );
  const set = useCallback((next: PreferenceValues[K]) => {
    store.set(key, next);
  }, [key, store]);
  return [value, set];
}

/**
 * Where a preference's value comes from — `locked` (Settings disables the control and says the
 * organisation set it), the user's or device's own choice, or a team or org default ("Compact —
 * your team's default"). `default` during a server render.
 */
export function usePreferenceSource(key: PreferenceKey, store: PreferenceStore = defaultStore): PreferenceSource {
  return useSyncExternalStore(store.subscribe, () => store.sourceOf(key), () => 'default');
}

/**
 * A vault-tier library (saved presets, templates) and its setter. Like `usePreference`, except
 * that until the vault is open it shows the legacy `localStorage` copy instead of an empty list,
 * so a library does not vanish for the moment between page load and unlock.
 */
export function useLibrary<K extends PreferenceKey>(
  key: K,
  store: PreferenceStore = defaultStore,
): [PreferenceValues[K], (value: PreferenceValues[K]) => void] {
  const [value, set] = usePreference(key, store);
  const open = useVaultAvailable(store);
  return [open ? value : readVaultOrLegacy(store, key), set];
}

/** Whether vault-tier preferences (the AI key, libraries) are readable in this session yet. */
export function useVaultAvailable(store: PreferenceStore = defaultStore): boolean {
  return useSyncExternalStore(store.subscribe, () => store.vaultAvailable, () => false);
}

/** Whether the signed-in user's preferences have arrived from the server yet (`store.loaded`). */
export function usePreferencesLoaded(store: PreferenceStore = defaultStore): boolean {
  return useSyncExternalStore(store.subscribe, () => store.loaded, () => false);
}
