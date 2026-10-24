import { describe, it, expect, beforeEach } from 'vitest';
import {
  PreferenceStore,
  VaultConflictError,
  BOOT_KEY,
  BOOT_OWN_KEY,
  REGISTRY,
  migrateLegacyPreferences,
  type PreferenceBackend,
  type PreferenceKey,
  type PreferencesSnapshot,
  type StorageLike,
  type VaultCrypto,
} from '../index';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

/** A server: plain values plus a vault that enforces the base-version rule like the real one. */
class FakeServer implements PreferenceBackend {
  values: Record<string, unknown> = {};
  vault: { blob: string; updatedAt: string } | null = null;
  org: PreferencesSnapshot['org'] = { values: {}, locked: [] };
  teams: Record<string, Record<string, unknown>> = {};
  patches: Record<string, unknown>[] = [];
  private n = 0;
  async load(): Promise<PreferencesSnapshot> {
    return { values: { ...this.values }, vault: this.vault, org: this.org, teams: this.teams };
  }
  async patch(values: Record<string, unknown>): Promise<PreferencesSnapshot> {
    this.patches.push(values);
    for (const [k, v] of Object.entries(values)) {
      if (v === null) delete this.values[k];
      else this.values[k] = v;
    }
    return this.load();
  }
  async putVault(blob: string, base: string | null) {
    if ((this.vault?.updatedAt ?? null) !== base) throw new VaultConflictError();
    this.vault = { blob, updatedAt: `v${++this.n}` };
    return { updatedAt: this.vault.updatedAt };
  }
}

/** "Sealing" that is visibly not plaintext, so a test can assert nothing leaks. */
const crypto = (ready = () => true): VaultCrypto => ({
  ready,
  seal: (p) => Buffer.from(JSON.stringify(p)).toString('base64url').split('').reverse().join(''),
  open: (b) => JSON.parse(Buffer.from(b.split('').reverse().join(''), 'base64url').toString()),
});

let storage: MemoryStorage;
let server: FakeServer;
let store: PreferenceStore;

beforeEach(async () => {
  storage = new MemoryStorage();
  server = new FakeServer();
  store = new PreferenceStore(storage);
});

describe('reading', () => {
  it('resolves every key to its registry default before anything is set', () => {
    for (const spec of REGISTRY) expect(store.get(spec.key as PreferenceKey)).toEqual(spec.default);
  });

  it('treats a stored value that has gone bad as absent', async () => {
    server.values = { 'appearance.density': 'enormous', 'calendar.weekStart': 3 };
    await store.attach('u1', server, crypto());
    expect(store.get('appearance.density')).toBe('comfortable');
    expect(store.get('calendar.weekStart')).toBe(3);
  });

  it('refuses an invalid write and changes nothing', () => {
    expect(store.set('calendar.weekStart', 9)).toBe(false);
    expect(store.get('calendar.weekStart')).toBe(0);
  });
});

describe('the plain tier', () => {
  it('batches writes into one PATCH holding only what changed', async () => {
    await store.attach('u1', server, crypto());
    store.set('appearance.look', 'precision');
    store.set('appearance.density', 'compact');
    store.set('appearance.look', 'blended');
    await store.flush();
    expect(server.patches).toEqual([{ 'appearance.look': 'blended', 'appearance.density': 'compact' }]);
  });

  it('a reset sends null, which clears the key server-side', async () => {
    server.values = { 'docs.spellCheck': false };
    await store.attach('u1', server, crypto());
    store.reset('docs.spellCheck');
    await store.flush();
    expect(server.values).toEqual({});
    expect(store.get('docs.spellCheck')).toBe(true);
  });

  it('keeps this device’s unsent writes over a refresh that arrives first', async () => {
    await store.attach('u1', server, crypto());
    store.set('appearance.look', 'precision');
    server.values = { 'appearance.look': 'lightflow' }; // another device, a moment ago
    await store.refresh();
    expect(store.get('appearance.look')).toBe('precision');
  });
});

describe('a reload before a write is sent', () => {
  it('keeps the write, over the server’s older copy, and sends it', async () => {
    server.values = { 'appearance.theme': 'light' };
    await store.attach('u1', server, crypto());
    store.set('appearance.theme', 'dark');
    // The page goes away inside the flush delay: nothing reached the server.
    expect(server.patches).toEqual([]);

    const reloaded = new PreferenceStore(storage);
    expect(reloaded.get('appearance.theme')).toBe('dark');
    await reloaded.attach('u1', server, crypto());
    expect(reloaded.get('appearance.theme')).toBe('dark');
    expect(await reloaded.flush()).toBe(true);
    expect(server.values['appearance.theme']).toBe('dark');
  });

  it('does not carry one user’s unsent writes into another’s session', async () => {
    await store.attach('u1', server, crypto());
    store.set('appearance.theme', 'dark');
    const reloaded = new PreferenceStore(storage);
    await reloaded.attach('u2', server, crypto());
    expect(reloaded.get('appearance.theme')).toBe('system');
    expect(await reloaded.flush()).toBe(true);
    expect(server.patches).toEqual([]);
  });
});

describe('the device tier', () => {
  it('never leaves the browser', async () => {
    await store.attach('u1', server, crypto());
    store.set('shell.sidebarCollapsed', true);
    await store.flush();
    expect(server.patches).toEqual([]);
    expect(new PreferenceStore(storage).get('shell.sidebarCollapsed')).toBe(true);
  });

  it('survives sign-out, where user values do not', async () => {
    server.values = { 'appearance.look': 'precision' };
    await store.attach('u1', server, crypto());
    store.set('shell.sidebarCollapsed', true);
    store.detach();
    expect(store.get('appearance.look')).toBe('classic');
    expect(store.get('shell.sidebarCollapsed')).toBe(true);
  });
});

describe('the vault tier', () => {
  it('is sealed on the server and never written to local storage', async () => {
    await store.attach('u1', server, crypto());
    store.set('ai.apiKey', 'sk-secret-1');
    await store.flush();
    expect(server.vault?.blob).toBeTruthy();
    expect(server.vault!.blob).not.toContain('sk-secret-1');
    for (const v of storage.data.values()) expect(v).not.toContain('sk-secret-1');
    // A fresh session opens it.
    const other = new PreferenceStore(new MemoryStorage());
    await other.attach('u1', server, crypto());
    expect(other.get('ai.apiKey')).toBe('sk-secret-1');
  });

  it('merges with another device’s write instead of overwriting it', async () => {
    const a = new PreferenceStore(new MemoryStorage());
    const b = new PreferenceStore(new MemoryStorage());
    await a.attach('u1', server, crypto());
    await b.attach('u1', server, crypto());
    a.set('library.fill.slides', [{ name: 'Sunset' }]);
    await a.flush();
    b.set('ai.apiKey', 'sk-from-b'); // b's base version is now stale
    await b.flush();
    const fresh = new PreferenceStore(new MemoryStorage());
    await fresh.attach('u1', server, crypto());
    expect(fresh.get('ai.apiKey')).toBe('sk-from-b');
    expect(fresh.get('library.fill.slides')).toEqual([{ name: 'Sunset' }]);
  });

  it('waits while the session is locked, and saves once it unlocks', async () => {
    let unlocked = false;
    server.vault = { blob: crypto().seal({ 'ai.apiKey': 'sk-old' }), updatedAt: 'v0' };
    await store.attach('u1', server, crypto(() => unlocked));
    expect(store.vaultAvailable).toBe(false);
    expect(store.get('ai.apiKey')).toBe('');
    store.set('ai.apiKey', 'sk-new');
    await store.flush();
    expect(server.vault.blob).toBe(crypto().seal({ 'ai.apiKey': 'sk-old' })); // untouched while locked
    unlocked = true;
    await store.onUnlocked();
    await store.flush();
    expect(crypto().open(server.vault!.blob)).toEqual({ 'ai.apiKey': 'sk-new' });
  });
});

describe('the boot record', () => {
  it('holds exactly the before-paint keys, resolved', async () => {
    server.values = { 'appearance.look': 'precision', 'calendar.weekStart': 1 };
    await store.attach('u1', server, crypto());
    const boot = JSON.parse(storage.getItem(BOOT_KEY)!);
    expect(Object.keys(boot).sort()).toEqual(
      [...REGISTRY.filter((s) => s.paint).map((s) => s.key), BOOT_OWN_KEY].sort(),
    );
    expect(boot['appearance.look']).toBe('precision');
    expect(boot['appearance.density']).toBe('comfortable');
    // Only the look is the user's own; the rest are inherited and may be replaced before paint.
    expect(boot[BOOT_OWN_KEY]).toEqual(['appearance.look']);
  });
});

describe('the organisation and team layers', () => {
  it('resolves lock, then own, then team inside its space, then org default, then the registry', async () => {
    server.values = { 'appearance.look': 'blended', 'appearance.density': 'spacious' };
    server.org = {
      values: { 'appearance.look': 'precision', 'appearance.density': 'compact', 'keyboard.preset': 'google' },
      locked: ['appearance.look'],
    };
    server.teams = { t1: { 'teamSpace.view': 'list', 'appearance.density': 'compact' } };
    await store.attach('u1', server, crypto());

    // Locked: the org wins over the user's own row, and the user cannot change it.
    expect(store.get('appearance.look')).toBe('precision');
    expect(store.sourceOf('appearance.look')).toBe('locked');
    expect(store.set('appearance.look', 'lightflow')).toBe(false);
    // Unlocked org default: used until the user sets their own.
    expect(store.get('keyboard.preset')).toBe('google');
    expect(store.sourceOf('keyboard.preset')).toBe('org');
    // The user's own value beats both the team and the org default.
    expect(store.get('appearance.density')).toBe('spacious');

    // A team default applies only inside that team's space.
    expect(store.get('teamSpace.view')).toBe('large');
    store.setTeamContext('t1');
    expect(store.get('teamSpace.view')).toBe('list');
    expect(store.sourceOf('teamSpace.view')).toBe('team');
    store.setTeamContext(null);
    expect(store.sourceOf('teamSpace.view')).toBe('default');
  });

  it('refuses a user write to a key only an organisation sets', async () => {
    await store.attach('u1', server, crypto());
    expect(store.set('apps.enabled', ['docs'])).toBe(false);
    await store.flush();
    expect(server.patches).toEqual([]);
  });

  it('starts from the org layer the page itself carries, before any request', () => {
    const fresh = new PreferenceStore(new MemoryStorage(), {
      org: { values: { 'appearance.look': 'precision', 'apps.enabled': ['docs', 'calendar'] }, locked: ['appearance.look'] },
    });
    expect(fresh.get('appearance.look')).toBe('precision');
    expect(fresh.isLocked('appearance.look')).toBe(true);
    expect(fresh.get('apps.enabled')).toEqual(['docs', 'calendar']);
  });

  it('ignores org values that are not legal for the key', () => {
    const fresh = new PreferenceStore(new MemoryStorage(), {
      org: { values: { 'appearance.look': 'neon', 'apps.enabled': ['docs', 'docs'] }, locked: ['appearance.look'] },
    });
    expect(fresh.get('appearance.look')).toBe('classic');
    expect(fresh.isLocked('appearance.look')).toBe(false);
    expect(fresh.get('apps.enabled')).toHaveLength(8);
  });

  it('forgets the team layer on sign-out but keeps the instance\'s org layer', async () => {
    server.org = { values: { 'keyboard.preset': 'microsoft' }, locked: [] };
    server.teams = { t1: { 'teamSpace.view': 'list' } };
    await store.attach('u1', server, crypto());
    store.setTeamContext('t1');
    store.detach();
    expect(store.get('teamSpace.view')).toBe('large');
    expect(store.get('keyboard.preset')).toBe('microsoft');
  });
});

describe('migrating the legacy keys', () => {
  it('moves each key into its tier and deletes the original', async () => {
    storage.setItem('neutrino:calendar:weekStart', '1');
    storage.setItem('neutrino.spellCheck', 'false');
    storage.setItem('neutrino.sidebar.collapsed', 'true');
    storage.setItem('neutrino:sheets:cf-templates', JSON.stringify([{ id: 't1' }]));
    await store.attach('u1', server, crypto());
    await migrateLegacyPreferences(store, storage);
    await store.flush();
    expect(server.values).toEqual({ 'calendar.weekStart': 1, 'docs.spellCheck': false });
    expect(store.get('shell.sidebarCollapsed')).toBe(true);
    expect(store.get('library.sheets.cfTemplates')).toEqual([{ id: 't1' }]);
    for (const k of ['neutrino:calendar:weekStart', 'neutrino.spellCheck', 'neutrino.sidebar.collapsed', 'neutrino:sheets:cf-templates']) {
      expect(storage.getItem(k)).toBeNull();
    }
  });

  it('lets an already-synced value win, except for the theme, where this browser wins', async () => {
    server.values = { 'calendar.weekStart': 2, 'appearance.theme': 'dark' };
    storage.setItem('neutrino:calendar:weekStart', '1');
    storage.setItem('neutrino.theme', 'midnight');
    await store.attach('u1', server, crypto());
    await migrateLegacyPreferences(store, storage);
    expect(store.get('calendar.weekStart')).toBe(2);
    expect(store.get('appearance.theme')).toBe('midnight');
  });

  it('merges libraries from two browsers rather than choosing one', async () => {
    server.vault = { blob: crypto().seal({ 'library.fill.slides': [{ g: 'a' }] }), updatedAt: 'v0' };
    storage.setItem('neutrino:slides:gradientPresets', JSON.stringify([{ g: 'a' }, { g: 'b' }]));
    await store.attach('u1', server, crypto());
    await migrateLegacyPreferences(store, storage);
    expect(store.get('library.fill.slides')).toEqual([{ g: 'a' }, { g: 'b' }]);
  });

  it('splits the AI record: provider to plain now, the key sealed, and the plaintext copy deleted', async () => {
    storage.setItem('neutrino.ai.settings', JSON.stringify({ provider: 'claude', apiKey: 'sk-legacy' }));
    await store.attach('u1', server, crypto());
    await migrateLegacyPreferences(store, storage);
    await store.flush();
    expect(server.values['ai.provider']).toBe('claude');
    expect(crypto().open(server.vault!.blob)).toEqual({ 'ai.apiKey': 'sk-legacy' });
    expect(storage.getItem('neutrino.ai.settings')).toBeNull();
  });

  it('keeps the plaintext copy when saving the sealed one fails, so a reload cannot lose the key', async () => {
    // The bug this guards: the old copy deleted the moment the value was in memory, then the vault
    // upload failed ("database is locked"), then a reload found neither.
    storage.setItem('neutrino.ai.settings', JSON.stringify({ provider: 'claude', apiKey: 'sk-keep-me' }));
    let failNext = true;
    const flaky: PreferenceBackend = {
      load: () => server.load(),
      patch: (v) => server.patch(v),
      putVault: async (blob, base) => {
        if (failNext) { failNext = false; throw new Error('500 database is locked'); }
        return server.putVault(blob, base);
      },
    };
    await store.attach('u1', flaky, crypto());
    await migrateLegacyPreferences(store, storage);
    expect(storage.getItem('neutrino.ai.settings')).not.toBeNull(); // kept: not saved yet
    expect(server.vault).toBeNull();

    // The next load retries; this time the save lands and only then does the plaintext go.
    await migrateLegacyPreferences(store, storage);
    expect(crypto().open(server.vault!.blob)).toEqual({ 'ai.apiKey': 'sk-keep-me' });
    expect(storage.getItem('neutrino.ai.settings')).toBeNull();
  });

  it('leaves vault-bound keys in place while the vault cannot be opened', async () => {
    server.vault = { blob: crypto().seal({}), updatedAt: 'v0' };
    storage.setItem('neutrino.ai.settings', JSON.stringify({ provider: 'openai', apiKey: 'sk-wait' }));
    storage.setItem('neutrino:sheets:cf-variables', '[]');
    await store.attach('u1', server, crypto(() => false));
    await migrateLegacyPreferences(store, storage);
    expect(storage.getItem('neutrino.ai.settings')).not.toBeNull();
    expect(storage.getItem('neutrino:sheets:cf-variables')).not.toBeNull();
    expect(store.get('ai.provider')).toBe('openai'); // the plain half did not have to wait
  });
});

describe('the typed value map', () => {
  it('names exactly the registry keys', () => {
    const typed: Record<PreferenceKey, true> = {
      'appearance.theme': true, 'appearance.look': true, 'appearance.density': true, 'shell.sidebarCollapsed': true,
      'calendar.weekStart': true, 'calendar.dayStartHour': true, 'calendar.dayEndHour': true,
      'docs.spellCheck': true, 'docs.splitParagraphs': true, 'photos.autoFaceDetect': true, 'drawing.brush': true,
      'search.syncDisabled': true, 'keyboard.preset': true, 'keyboard.bindings': true, 'ai.provider': true, 'ai.apiKey': true,
      'apps.enabled': true, 'teamSpace.view': true, 'teamSpace.sort': true, 'teamSpace.sortDirection': true,
      'listing.views': true, 'drive.landing': true, 'drive.quickAccessDays': true, 'editor.toolbars': true, 'editor.panels': true, 'team.pins': true, 'team.commands': true, 'team.library': true,
      'appearance.textSize': true, 'appearance.shape': true, 'appearance.font': true, 'appearance.accent': true, 'a11y.reduceMotion': true,
      'a11y.reduceTransparency': true, 'a11y.contrast': true, 'shell.sidebar': true,
      'library.sheets.cfTemplates': true, 'library.sheets.cfVariables': true, 'library.fill.slides': true,
      'library.fill.diagrams': true, 'library.fill.drawing': true, 'library.fill.default': true,
      'library.diagrams.shapeLibraries': true,
    };
    expect(Object.keys(typed).sort()).toEqual(REGISTRY.map((s) => s.key).sort());
  });
});
