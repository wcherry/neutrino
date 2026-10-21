/**
 * Moving the pre-registry `localStorage` keys into the registry, once
 * (agent_docs/preference-registry.md §4).
 *
 * Each legacy key is read, validated against its entry, written through the store and then
 * **deleted**, so there is never a second copy for something to read by mistake. Run after the
 * store has loaded the user's synced values, because what the server already holds decides the
 * outcome:
 *
 *  - Most keys: a value already synced (set on another device first) wins, and the local one is
 *    discarded — one answer for the account beats this browser's stale one.
 *  - The theme: the browser's value wins. It is what the user is looking at right now.
 *  - Libraries: merged, de-duplicated by content — presets made on two browsers end up in both.
 *  - Vault keys wait until the vault is open (a signed-in, unlocked session). Until then the legacy
 *    key stays where it is, still read by nothing but this migration, so it is not lost.
 */

import { REGISTRY, isValid, specFor, type PreferenceKey, type PreferenceSpec, type PreferenceValues } from './registry';
import type { PreferenceStore, StorageLike } from './store';

/** The pre-registry AI settings record: one key holding both halves of what is now two tiers. */
const LEGACY_AI_KEY = 'neutrino.ai.settings';

function parseLegacy(spec: PreferenceSpec, raw: string): unknown {
  switch (spec.type.kind) {
    case 'boolean':
      // Written as String(bool) by every old reader; tolerate a JSON boolean too.
      return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'integer': {
      const n = Number(raw);
      return Number.isInteger(n) ? n : undefined;
    }
    case 'string':
    case 'enum':
      return raw;
    default:
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
  }
}

function mergeLists(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set(a.map((x) => JSON.stringify(x)));
  return [...a, ...b.filter((x) => !seen.has(JSON.stringify(x)))];
}

/**
 * A vault-tier value, or — while the vault is not open yet — its legacy `localStorage` copy.
 *
 * For the features that read a library once when they mount (shape libraries, conditional-format
 * templates, fill presets): the vault opens a moment after sign-in or unlock, and in that window
 * the legacy key is still the only copy. Reading it keeps a library from flashing empty.
 */
export function readVaultOrLegacy<K extends PreferenceKey>(
  store: PreferenceStore,
  key: K,
  storage: StorageLike | null = typeof window !== 'undefined' ? window.localStorage : null,
): PreferenceValues[K] {
  if (store.vaultAvailable) return store.get(key);
  const spec = specFor(key)!;
  const raw = spec.legacyKey ? storage?.getItem(spec.legacyKey) ?? null : null;
  if (raw !== null) {
    const value = parseLegacy(spec, raw);
    if (value !== undefined && isValid(spec, value)) return value as PreferenceValues[K];
  }
  return store.get(key);
}

/**
 * Moves every legacy key it can, and deletes a legacy key only once the value it held is
 * **confirmed saved on the server**. Until then the old copy stays: a save that fails (offline, a
 * busy server) must not leave the value only in this tab's memory, where a reload loses it — for
 * the AI key that would be the key itself. Resolves to the registry keys that were written. Safe
 * to call on every load; a no-op once done.
 */
export function migrateLegacyPreferences(store: PreferenceStore, storage: StorageLike): Promise<PreferenceKey[]> {
  // One run at a time per store. Sign-in and unlock both trigger a run, often moments apart; two
  // overlapping runs each re-write what the other is still waiting to see saved, and neither ever
  // deletes the legacy key.
  const running = inFlight.get(store);
  if (running) return running.then(() => migrateOnce(store, storage));
  const run = migrateOnce(store, storage).finally(() => inFlight.delete(store));
  inFlight.set(store, run);
  return run;
}

const inFlight = new WeakMap<PreferenceStore, Promise<PreferenceKey[]>>();

async function migrateOnce(store: PreferenceStore, storage: StorageLike): Promise<PreferenceKey[]> {
  const migrated: PreferenceKey[] = [];
  /** Legacy key → the registry keys whose saving it waits on. Empty: safe to delete now. */
  const toRemove = new Map<string, PreferenceKey[]>();

  for (const spec of REGISTRY) {
    if (!spec.legacyKey) continue;
    const raw = storage.getItem(spec.legacyKey);
    if (raw === null) continue;
    if (spec.sync === 'vault' && !store.vaultAvailable) continue; // try again once it opens

    const key = spec.key as PreferenceKey;
    const value = parseLegacy(spec, raw);
    if (value !== undefined && isValid(spec, value)) {
      if (spec.type.kind === 'list' && store.isSet(key)) {
        store.set(key, mergeLists(store.get(key) as unknown[], value as unknown[]) as never);
        migrated.push(key);
      } else if (!store.isSet(key) || (key === 'appearance.theme' && store.get(key) !== value)) {
        store.set(key, value as never);
        migrated.push(key);
      }
      toRemove.set(spec.legacyKey, migrated.includes(key) ? [key] : []);
    } else {
      console.warn(`[prefs:migrate] dropping unreadable ${spec.legacyKey}`);
      toRemove.set(spec.legacyKey, []);
    }
  }

  // The AI record splits across two tiers: the provider is plain, the key is sealed.
  const ai = storage.getItem(LEGACY_AI_KEY);
  if (ai !== null) {
    let parsed: { provider?: unknown; apiKey?: unknown } = {};
    try {
      parsed = JSON.parse(ai);
    } catch {
      console.warn('[prefs:migrate] dropping unreadable neutrino.ai.settings');
    }
    const waitsOn: PreferenceKey[] = [];
    const provider = specFor('ai.provider')!;
    if (!store.isSet('ai.provider') && isValid(provider, parsed.provider)) {
      store.set('ai.provider', parsed.provider as 'gemini' | 'claude' | 'openai');
      migrated.push('ai.provider');
      waitsOn.push('ai.provider');
    }
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
    if (!apiKey) {
      toRemove.set(LEGACY_AI_KEY, waitsOn);
    } else if (store.vaultAvailable) {
      if (!store.get('ai.apiKey')) {
        store.set('ai.apiKey', apiKey);
        migrated.push('ai.apiKey');
        waitsOn.push('ai.apiKey');
      }
      // The plaintext copy goes the moment a sealed one is saved — the point of the vault tier.
      toRemove.set(LEGACY_AI_KEY, waitsOn);
    }
  }

  if (toRemove.size === 0) return migrated;
  await store.flush();
  const unsaved = store.pendingKeys();
  for (const [legacyKey, waitsOn] of toRemove) {
    if (waitsOn.some((k) => unsaved.has(k))) continue; // kept for the next load to retry
    storage.removeItem(legacyKey);
  }
  if (migrated.length > 0) console.info(`[prefs:migrate] moved ${migrated.join(', ')}`);
  return migrated;
}
