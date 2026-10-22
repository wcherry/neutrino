/**
 * The preference registry, typed. `registry.json` is the data (and what the server's
 * `src/preferences/catalog.rs` is checked against); this is how code reads it.
 * agent_docs/preference-registry.md explains every entry.
 */

import raw from './registry.json';

export type Sync = 'plain' | 'vault' | 'device';

/**
 * Who may set a key. `user` and `device` are the person's own; `org` is an administrator's default
 * (which they may lock) and `team` a default inside that team's space. Resolution, most specific
 * first, with the org lock on top: org lock → device → user → team → org default → default.
 */
export type Scope = 'user' | 'device' | 'org' | 'team';

/** Every app an instance can offer, in sidebar order — the options of `apps.enabled`. */
export const APPS = ['docs', 'sheets', 'slides', 'notes', 'diagrams', 'drawing', 'photos', 'calendar'] as const;
export type AppKey = (typeof APPS)[number];

export type PreferenceType =
  | { kind: 'enum'; options: readonly string[] }
  | { kind: 'boolean' }
  | { kind: 'integer'; min: number; max: number }
  | { kind: 'string'; maxLength: number; pattern?: string }
  | { kind: 'object'; maxBytes: number }
  | { kind: 'stringList'; maxItems: number; maxLength: number }
  /** Distinct values, each one of `options`. */
  | { kind: 'set'; options: readonly string[] }
  /** A list of user-authored items (a library); its items are the feature's own shape. */
  | { kind: 'list' }
  /** Any JSON value the owning feature validates itself. Vault-only: the server never reads it. */
  | { kind: 'json' };

export interface PreferenceSpec {
  key: string;
  type: PreferenceType;
  default: unknown;
  sync: Sync;
  scopes: readonly Scope[];
  /** Applied before first paint, from the boot cache. */
  paint?: boolean;
  label: string;
  /**
   * Where its control lives: a Settings tab id (`appearance`, `calendar`, `keyboard`, `advanced`, `ai`), an
   * app or surface (`docs`, `sheets`, `editors`, `sidebar`, …), or `none` while it has no control
   * yet. Settings search is built from this.
   */
  section: string;
  /** Where the value lived before the registry; read once by the migration, then removed. */
  legacyKey?: string;
}

/** The value type of every registered preference. A test holds these keys to registry.json. */
export interface PreferenceValues {
  'appearance.theme': string;
  'appearance.look': 'classic' | 'lightflow' | 'precision' | 'blended';
  'appearance.density': 'compact' | 'comfortable' | 'spacious';
  'appearance.textSize': 'sm' | 'md' | 'lg';
  /** Corner radii: half, as drawn, or 1.75× — `--radius-scale` in tokens/spacing.css. */
  'appearance.shape': 'sharper' | 'default' | 'rounder';
  /** The interface font family — a built-in or one from the instance's font library; '' for the look's own. */
  'appearance.font': string;
  /** `#rrggbb`, or null for the look's own accent. Never stored adjusted: lib/accent.ts adjusts. */
  'appearance.accent': string | null;
  'a11y.reduceMotion': 'system' | 'on' | 'off';
  'a11y.reduceTransparency': 'system' | 'on' | 'off';
  'a11y.contrast': 'system' | 'more' | 'standard';
  /** Pinned folders, hidden entries and the order of the Apps; see lib/sidebarLayout.ts. */
  'shell.sidebar': Record<string, unknown> | null;
  'shell.sidebarCollapsed': boolean;
  'calendar.weekStart': number;
  'calendar.dayStartHour': number;
  'calendar.dayEndHour': number;
  'docs.spellCheck': boolean;
  'docs.splitParagraphs': boolean;
  'photos.autoFaceDetect': boolean;
  'drawing.brush': Record<string, unknown> | null;
  'search.syncDisabled': boolean;
  'keyboard.preset': 'neutrino' | 'google' | 'microsoft';
  /** Command id → chords; see @neutrino/commands `sanitizeBindings`. */
  'keyboard.bindings': Record<string, string[]> | null;
  'ai.provider': 'gemini' | 'claude' | 'openai';
  'apps.enabled': AppKey[];
  'teamSpace.view': 'large' | 'small' | 'list';
  'teamSpace.sort': 'name' | 'size' | 'createdAt' | 'updatedAt';
  'teamSpace.sortDirection': 'asc' | 'desc';
  /** Listing id → its remembered view and order; see `useListingView` in the web app. */
  'listing.views': Record<string, { view?: string; sort?: string; dir?: string }> | null;
  /** Editor → its toolbar's order, hidden tools and labels; see lib/editorToolbars.ts in the web app. */
  'editor.toolbars': Record<string, { order?: string[]; hidden?: string[]; labels?: boolean }> | null;
  'drive.landing': 'drive' | 'recent' | 'starred';
  'ai.apiKey': string;
  'library.sheets.cfTemplates': unknown[];
  'library.sheets.cfVariables': unknown[];
  'library.fill.slides': unknown[];
  'library.fill.diagrams': unknown[];
  'library.fill.drawing': unknown[];
  'library.fill.default': unknown[];
  'library.diagrams.shapeLibraries': Record<string, unknown> | null;
}

export type PreferenceKey = keyof PreferenceValues;

export const REGISTRY: readonly PreferenceSpec[] = (raw as { preferences: PreferenceSpec[] }).preferences;

const BY_KEY = new Map(REGISTRY.map((s) => [s.key, s]));

export function specFor(key: string): PreferenceSpec | undefined {
  return BY_KEY.get(key);
}

export function defaultOf<K extends PreferenceKey>(key: K): PreferenceValues[K] {
  return BY_KEY.get(key)!.default as PreferenceValues[K];
}

const patterns = new Map<string, RegExp>();

/**
 * Whether `value` is a legal value for `spec` — the client half of the server's
 * `catalog::validate`, so a value the server would refuse is never sent, and a value read from
 * storage that has gone bad resolves to the default instead of reaching a component.
 */
export function isValid(spec: PreferenceSpec, value: unknown): boolean {
  const t = spec.type;
  switch (t.kind) {
    case 'enum':
      return typeof value === 'string' && t.options.includes(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value) && (value as number) >= t.min && (value as number) <= t.max;
    case 'string': {
      if (typeof value !== 'string' || [...value].length > t.maxLength) return false;
      if (!t.pattern) return true;
      let re = patterns.get(t.pattern);
      if (!re) patterns.set(t.pattern, (re = new RegExp(t.pattern)));
      return re.test(value);
    }
    case 'object':
      return (
        value === null ||
        (typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= t.maxBytes)
      );
    case 'stringList':
      return (
        Array.isArray(value) &&
        value.length <= t.maxItems &&
        value.every((v) => typeof v === 'string' && [...v].length <= t.maxLength)
      );
    case 'set':
      return (
        Array.isArray(value) &&
        value.every((v, i) => typeof v === 'string' && t.options.includes(v) && value.indexOf(v) === i)
      );
    case 'list':
      return Array.isArray(value);
    case 'json':
      return value !== undefined;
  }
}
