/**
 * The preference store: one place every preference is read from and written to
 * (agent_docs/ui-customization-roadmap.md §3.1–3.2).
 *
 * Three tiers, by the registry's `sync`:
 *
 *  - **plain** — synced through `/api/v1/preferences`. Held in memory, mirrored to a
 *    per-user cache in `localStorage` so a reload paints the user's settings before the
 *    network answers, and written back in batches.
 *  - **vault** — sealed with the user's own key into one blob. Held decrypted **in memory
 *    only**; this is what takes the AI key out of plaintext `localStorage`.
 *  - **device** — this browser only, in `localStorage`.
 *
 * Resolution for a key is its tier's stored value if it is valid, else the registry default.
 * A stored value that fails validation is treated as absent, so a component never receives a
 * shape it was not written for.
 *
 * The store has no dependencies: the app *attaches* a backend (HTTP) and the vault crypto once
 * a user is signed in, which is what lets `@neutrino/layout` read preferences without the API
 * client. Before that — on the sign-in page, or for the first paint of a reload — values come
 * from the cache and the boot record.
 */

import { REGISTRY, defaultOf, isValid, specFor, type PreferenceKey, type PreferenceValues } from './registry';

export interface PreferencesSnapshot {
  values: Record<string, unknown>;
  vault: { blob: string; updatedAt: string } | null;
}

export interface PreferenceBackend {
  load(): Promise<PreferencesSnapshot>;
  patch(values: Record<string, unknown>): Promise<PreferencesSnapshot>;
  /** Rejects with a `VaultConflictError` when the server's version is not `baseUpdatedAt`. */
  putVault(blob: string, baseUpdatedAt: string | null): Promise<{ updatedAt: string }>;
}

export class VaultConflictError extends Error {
  constructor() {
    super('The preference vault changed on another device');
    this.name = 'VaultConflictError';
  }
}

export interface VaultCrypto {
  /** False while the session is locked or has no keypair; vault writes wait until it is true. */
  ready(): boolean;
  seal(payload: Record<string, unknown>): string;
  open(blob: string): Record<string, unknown>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the anti-FOUC script reads before React runs (app/layout.tsx). */
export const BOOT_KEY = 'neutrino.prefs.boot';
const CACHE_KEY = 'neutrino.prefs.cache';
const DEVICE_KEY = 'neutrino.prefs.device';
const FLUSH_DELAY_MS = 400;
/** After a failed save: retry at these delays, then keep retrying at the last one. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];

type Listener = () => void;

function safeParse(raw: string | null): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class PreferenceStore {
  private plain: Record<string, unknown> = {};
  private vault: Record<string, unknown> | null = null;
  private vaultUpdatedAt: string | null = null;
  /** True once the vault has been loaded and opened (or found absent) for this user. */
  private vaultOpen = false;
  private device: Record<string, unknown> = {};
  private userId: string | null = null;
  private backend: PreferenceBackend | null = null;
  private crypto: VaultCrypto | null = null;
  private pendingPlain: Record<string, unknown> = {};
  private dirtyVault = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private flushing: Promise<boolean> | null = null;
  private listeners = new Set<Listener>();
  private version = 0;

  constructor(private storage: StorageLike | null = browserStorage()) {
    this.device = (safeParse(storage?.getItem(DEVICE_KEY) ?? null) as Record<string, unknown>) ?? {};
    const cache = safeParse(storage?.getItem(CACHE_KEY) ?? null) as
      | { userId?: string; values?: Record<string, unknown>; pending?: Record<string, unknown> }
      | undefined;
    if (cache?.values) {
      // The last signed-in user's plain values, for the first paint of a reload. Replaced — not
      // merged — the moment a different user attaches.
      this.plain = cache.values;
      this.userId = cache.userId ?? null;
      // And the writes that had not reached the server when the page went away: a reload within
      // the flush delay of a change would otherwise load the server's older copy over it and
      // lose it. `attach` keeps them for the same user and sends them.
      if (cache.pending && typeof cache.pending === 'object') this.pendingPlain = cache.pending;
    }
    if (typeof window !== 'undefined' && storage) {
      // Another tab of this browser changed something: its cache write is the news. Cross-device
      // changes arrive as a server signal instead (`refresh`).
      window.addEventListener('storage', (e) => {
        if (e.key === DEVICE_KEY) {
          this.device = (safeParse(e.newValue) as Record<string, unknown>) ?? {};
          this.notify();
        } else if (e.key === CACHE_KEY) {
          const next = safeParse(e.newValue) as { userId?: string; values?: Record<string, unknown> } | undefined;
          if (next?.values && next.userId === this.userId) {
            this.plain = this.withPending(next.values);
            this.notify();
          }
        }
      });
    }
  }

  // ── Reading ──────────────────────────────────────────────────────────────────

  get<K extends PreferenceKey>(key: K): PreferenceValues[K] {
    const spec = specFor(key);
    if (!spec) throw new Error(`${key} is not a registered preference`);
    const tier = spec.sync === 'device' ? this.device : spec.sync === 'vault' ? this.vault ?? {} : this.plain;
    const value = tier[key];
    return (value !== undefined && isValid(spec, value) ? value : defaultOf(key)) as PreferenceValues[K];
  }

  /** Whether the user (or this device) has set `key`, as opposed to it resolving to the default. */
  isSet(key: PreferenceKey): boolean {
    const spec = specFor(key)!;
    const tier = spec.sync === 'device' ? this.device : spec.sync === 'vault' ? this.vault ?? {} : this.plain;
    return tier[key] !== undefined;
  }

  /** Whether vault-tier values are available — false until a signed-in, unlocked session opens it. */
  get vaultAvailable(): boolean {
    return this.vaultOpen;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever any value does; what `useSyncExternalStore` compares. */
  getVersion = (): number => this.version;

  // ── Writing ──────────────────────────────────────────────────────────────────

  /** Returns false (and changes nothing) for a value the registry would not accept. */
  set<K extends PreferenceKey>(key: K, value: PreferenceValues[K]): boolean {
    const spec = specFor(key);
    if (!spec || !isValid(spec, value)) return false;
    // Setting what is already there is not a change: no save, no re-render.
    if (this.isSet(key) && JSON.stringify(this.get(key)) === JSON.stringify(value)) return true;
    if (spec.sync === 'device') {
      this.device = { ...this.device, [key]: value };
      this.storage?.setItem(DEVICE_KEY, JSON.stringify(this.device));
    } else if (spec.sync === 'vault') {
      this.vault = { ...(this.vault ?? {}), [key]: value };
      this.dirtyVault.add(key);
    } else {
      this.plain = { ...this.plain, [key]: value };
      this.pendingPlain[key] = value;
    }
    this.changed();
    this.scheduleFlush();
    return true;
  }

  /** Back to the registry default. */
  reset(key: PreferenceKey): void {
    const spec = specFor(key)!;
    if (spec.sync === 'device') {
      const { [key]: _gone, ...rest } = this.device;
      this.device = rest;
      this.storage?.setItem(DEVICE_KEY, JSON.stringify(this.device));
    } else if (spec.sync === 'vault') {
      const { [key]: _gone, ...rest } = this.vault ?? {};
      this.vault = rest;
      this.dirtyVault.add(key);
    } else {
      const { [key]: _gone, ...rest } = this.plain;
      this.plain = rest;
      this.pendingPlain[key] = null;
    }
    this.changed();
    this.scheduleFlush();
  }

  // ── Session ──────────────────────────────────────────────────────────────────

  /** A user signed in: load their preferences and start syncing. */
  async attach(userId: string, backend: PreferenceBackend, crypto: VaultCrypto): Promise<void> {
    if (this.userId !== userId) {
      this.plain = {};
      this.vault = null;
      this.vaultOpen = false;
      this.vaultUpdatedAt = null;
      this.pendingPlain = {};
      this.dirtyVault.clear();
    }
    this.userId = userId;
    this.backend = backend;
    this.crypto = crypto;
    await this.refresh();
  }

  /** Signed out: forget everything that belongs to the user. Device values stay. */
  detach(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.backend = null;
    this.crypto = null;
    this.userId = null;
    this.plain = {};
    this.vault = null;
    this.vaultOpen = false;
    this.vaultUpdatedAt = null;
    this.pendingPlain = {};
    this.dirtyVault.clear();
    this.storage?.removeItem(CACHE_KEY);
    this.changed();
  }

  /** Re-read from the server — on attach, and when another device signals a change. */
  async refresh(): Promise<void> {
    if (!this.backend) return;
    const snapshot = await this.backend.load();
    // Local writes not yet sent win over what the server had a moment ago.
    this.plain = this.withPending(snapshot.values);
    this.adoptVault(snapshot.vault);
    this.changed();
    if (this.dirtyVault.size > 0 || Object.keys(this.pendingPlain).length > 0) this.scheduleFlush();
  }

  /** The session unlocked (or a keypair appeared): open a vault that could not be opened before. */
  async onUnlocked(): Promise<void> {
    if (!this.vaultOpen) await this.refresh();
    else this.scheduleFlush();
  }

  /** Keys written here whose save to the server has not been confirmed yet. */
  pendingKeys(): Set<string> {
    return new Set([...Object.keys(this.pendingPlain), ...this.dirtyVault]);
  }

  /**
   * Send everything pending now. Resolves true when nothing is left unsaved. The plain and vault
   * writes go one after the other, never at once — two concurrent writes from one client is how a
   * SQLite server answers "database is locked".
   */
  async flush(): Promise<boolean> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.backend) return this.pendingKeys().size === 0;
    if (!this.flushing) {
      this.flushing = (async () => {
        await this.flushPlain();
        await this.flushVault();
        return this.afterFlush();
      })().finally(() => { this.flushing = null; });
    }
    return this.flushing;
  }

  /** Back off and try again when something is still unsaved after a flush that could have sent it. */
  private afterFlush(): boolean {
    const vaultWaiting = this.dirtyVault.size > 0 && !(this.crypto?.ready() && this.vaultOpen);
    const unsent = Object.keys(this.pendingPlain).length > 0 || (this.dirtyVault.size > 0 && !vaultWaiting);
    if (!unsent) {
      this.failures = 0;
      return this.pendingKeys().size === 0;
    }
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)];
    this.failures += 1;
    if (this.backend && !this.flushTimer) {
      this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, delay);
    }
    return false;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Server values with this device's unsent writes on top — including clears, which win too. */
  private withPending(values: Record<string, unknown>): Record<string, unknown> {
    const merged = { ...values };
    for (const [k, v] of Object.entries(this.pendingPlain)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    return merged;
  }

  private adoptVault(vault: PreferencesSnapshot['vault']): void {
    if (!vault) {
      // No vault yet: an empty one is open, and the first vault write creates it.
      this.vault = { ...(this.vault ?? {}) };
      this.vaultUpdatedAt = null;
      this.vaultOpen = true;
      return;
    }
    if (!this.crypto?.ready()) {
      // Locked: the values exist but cannot be read here yet. `onUnlocked` retries.
      this.vaultOpen = false;
      return;
    }
    try {
      const opened = this.crypto.open(vault.blob);
      const local = Object.fromEntries([...this.dirtyVault].map((k) => [k, this.vault?.[k]]));
      this.vault = { ...opened, ...local };
      this.vaultUpdatedAt = vault.updatedAt;
      this.vaultOpen = true;
    } catch (e) {
      // Sealed to a key this device does not hold (or damaged). Never overwrite it blind:
      // keep it closed so no write replaces what another device can still read.
      console.warn('[prefs] the preference vault could not be opened', e);
      this.vaultOpen = false;
    }
  }

  private scheduleFlush(): void {
    if (!this.backend || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  private async flushPlain(): Promise<void> {
    const batch = this.pendingPlain;
    if (!this.backend || Object.keys(batch).length === 0) return;
    this.pendingPlain = {};
    try {
      const snapshot = await this.backend.patch(batch);
      this.plain = this.withPending(snapshot.values);
      this.changed();
    } catch (e) {
      // Keep the batch for the next attempt, under anything written since.
      this.pendingPlain = { ...batch, ...this.pendingPlain };
      this.persistCache();
      console.warn('[prefs] saving preferences failed; will retry', e);
    }
  }

  private async flushVault(): Promise<void> {
    if (!this.backend || !this.crypto?.ready() || !this.vaultOpen || this.dirtyVault.size === 0) return;
    const sending = new Set(this.dirtyVault);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const payload = Object.fromEntries(Object.entries(this.vault ?? {}).filter(([, v]) => v !== undefined));
      try {
        const { updatedAt } = await this.backend.putVault(this.crypto.seal(payload), this.vaultUpdatedAt);
        this.vaultUpdatedAt = updatedAt;
        for (const k of sending) this.dirtyVault.delete(k);
        return;
      } catch (e) {
        if (!(e instanceof VaultConflictError) || attempt > 0) {
          console.warn('[prefs] saving the preference vault failed; will retry', e);
          return;
        }
        // Another device wrote first: take its vault, put this device's changes on top, retry.
        const snapshot = await this.backend.load();
        this.adoptVault(snapshot.vault);
        this.changed();
        if (!this.vaultOpen) return;
      }
    }
  }

  /** Tell subscribers without re-persisting — for changes that came *from* storage. */
  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private persistCache(): void {
    if (!this.userId) return;
    this.storage?.setItem(
      CACHE_KEY,
      JSON.stringify({ userId: this.userId, values: this.plain, pending: this.pendingPlain }),
    );
  }

  private changed(): void {
    this.version += 1;
    this.persistCache();
    const boot: Record<string, unknown> = {};
    for (const spec of REGISTRY) if (spec.paint) boot[spec.key] = this.get(spec.key as PreferenceKey);
    this.storage?.setItem(BOOT_KEY, JSON.stringify(boot));
    for (const listener of this.listeners) listener();
  }
}

/** The app's one store. */
export const preferences = new PreferenceStore();
