/**
 * Which chords run which commands: the catalog's defaults, then the chosen preset's changes,
 * then the user's own bindings (the `keyboard.preset` and `keyboard.bindings` preferences).
 */

import { COMMANDS, commandSpec, sharesScope, type CommandId, type CommandSpec } from './catalog';
import { normalizeChord } from './keys';

export type Preset = 'neutrino' | 'google' | 'microsoft';

/** A user's bindings: command id → its chords. An empty list unbinds the command. */
export type Bindings = Record<string, string[]>;

export const PRESETS: { id: Preset; label: string; keys: Partial<Record<CommandId, string[]>> }[] = [
  { id: 'neutrino', label: 'Neutrino', keys: {} },
  {
    // Only where Google Docs, Sheets and Slides differ from Neutrino's defaults.
    id: 'google',
    label: 'Google Workspace',
    keys: {
      'sheets.replace': ['Mod+Shift+H'],
      'editors.spellCheck.toggle': ['Mod+Alt+X'],
    },
  },
  {
    // Only where Word, Excel and PowerPoint differ from Neutrino's defaults.
    id: 'microsoft',
    label: 'Microsoft 365',
    keys: {
      'editors.spellCheck.toggle': ['F7'],
    },
  },
];

export function isPreset(value: unknown): value is Preset {
  return PRESETS.some((p) => p.id === value);
}

/** The chords that run `id` before the user's own bindings: the preset's, else the default. */
export function presetKeysFor(id: string, preset: Preset): readonly string[] {
  const fromPreset = PRESETS.find((p) => p.id === preset)?.keys[id as CommandId];
  return fromPreset ?? commandSpec(id)?.defaultKeys ?? [];
}

/** The chords that run `id`. */
export function keysFor(id: string, preset: Preset, bindings: Bindings): readonly string[] {
  return bindings[id] ?? presetKeysFor(id, preset);
}

/**
 * `value` (a stored `keyboard.bindings`) with everything unusable dropped: ids no longer in the
 * catalog, chords that do not parse, duplicates. A binding is never rendered or dispatched from
 * raw storage.
 */
export function sanitizeBindings(value: unknown): Bindings {
  const out: Bindings = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, chords] of Object.entries(value as Record<string, unknown>)) {
    if (!commandSpec(id) || !Array.isArray(chords)) continue;
    const valid = chords
      .map((c) => (typeof c === 'string' ? normalizeChord(c) : null))
      .filter((c): c is string => c !== null);
    out[id] = [...new Set(valid)];
  }
  return out;
}

/** chord → the ids of every command bound to it. */
export function buildKeymap(preset: Preset, bindings: Bindings): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const spec of COMMANDS) {
    for (const raw of keysFor(spec.id, preset, bindings)) {
      const chord = normalizeChord(raw);
      if (!chord) continue;
      const ids = map.get(chord);
      if (ids) ids.push(spec.id);
      else map.set(chord, [spec.id]);
    }
  }
  return map;
}

/** Commands other than `id` that `chord` would also run where `id` runs. */
export function conflictsWith(id: string, chord: string, keymap: Map<string, string[]>): CommandSpec[] {
  const spec = commandSpec(id);
  const normal = normalizeChord(chord);
  if (!spec || !normal) return [];
  return (keymap.get(normal) ?? [])
    .filter((other) => other !== id)
    .map((other) => commandSpec(other)!)
    .filter((other) => sharesScope(spec.app, other.app));
}
