'use client';

import React, { useMemo, useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import {
  COMMANDS,
  COMMAND_APPS,
  PRESETS,
  chordFromEvent,
  conflictsWith,
  detectPlatform,
  formatChord,
  keysFor,
  presetKeysFor,
  type Bindings,
  type CommandSpec,
  type Preset,
  useKeymap,
} from '@neutrino/commands';
import { preferences } from '@neutrino/preferences';
import { InheritedNote, useLocked } from './InheritedNote';
import styles from './KeyboardSettings.module.css';

/** Keys that already mean something everywhere and so cannot be a command's binding. */
const RESERVED = new Set(['Escape', 'Tab', 'Shift+Tab']);

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** `bindings` with `id` set to `keys`, dropping the entry when it is what the preset gives anyway. */
function withKeys(bindings: Bindings, preset: Preset, id: string, keys: string[]): Bindings {
  const next = { ...bindings };
  if (sameKeys(keys, presetKeysFor(id, preset))) delete next[id];
  else next[id] = keys;
  return next;
}

function save(bindings: Bindings): void {
  preferences.set('keyboard.bindings', Object.keys(bindings).length ? bindings : null);
}

interface Pending {
  id: string;
  chord: string;
  conflicts: CommandSpec[];
}

/**
 * Settings › Keyboard: every command in the catalog, the keys that run it, and a way to change
 * them. Bindings are the `keyboard.bindings` preference, so they follow the user to every device.
 */
export function KeyboardSettings() {
  const { preset, bindings, keymap } = useKeymap();
  const platform = useMemo(() => detectPlatform(), []);
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const q = query.trim().toLowerCase();
  const groups = COMMAND_APPS.map((app) => ({
    ...app,
    commands: (COMMANDS as readonly CommandSpec[]).filter(
      (c) => c.app === app.id && (!q || c.title.toLowerCase().includes(q) || app.label.toLowerCase().includes(q)),
    ),
  })).filter((g) => g.commands.length > 0);

  function setPreset(next: Preset) {
    preferences.set('keyboard.preset', next);
  }

  function addChord(id: string, chord: string, replace: CommandSpec[]) {
    let next = bindings;
    for (const other of replace) {
      next = withKeys(next, preset, other.id, keysFor(other.id, preset, next).filter((k) => k !== chord));
    }
    const current = keysFor(id, preset, next);
    if (!current.includes(chord)) next = withKeys(next, preset, id, [...current, chord]);
    save(next);
    setPending(null);
  }

  function removeChord(id: string, chord: string) {
    save(withKeys(bindings, preset, id, keysFor(id, preset, bindings).filter((k) => k !== chord)));
  }

  function onRecordKey(e: React.KeyboardEvent, id: string) {
    // Held here so the key neither runs a command nor closes anything while it is being recorded.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setRecording(null); return; }
    const chord = chordFromEvent(e.nativeEvent, platform);
    if (!chord) return; // a modifier on its own: keep waiting for the key
    setRecording(null);
    if (RESERVED.has(chord)) {
      setError({ id, message: `${formatChord(chord, platform)} is reserved for moving around the app.` });
      return;
    }
    setError(null);
    const conflicts = conflictsWith(id, chord, keymap);
    if (conflicts.length) setPending({ id, chord, conflicts });
    else addChord(id, chord, []);
  }

  const customised = Object.keys(bindings).length;
  const presetLocked = useLocked('keyboard.preset');

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Shortcut preset</h2>
        <p className={styles.sectionDesc}>
          Start from the shortcuts you already know. Your own changes below stay on top of the preset.
        </p>
        <div className={styles.segmented} role="radiogroup" aria-label="Shortcut preset">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              className={`${styles.segmentedBtn} ${preset === p.id ? styles.segmentedBtnActive : ''}`}
              disabled={presetLocked}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <InheritedNote prefKey="keyboard.preset" />
      </section>

      <section className={styles.section}>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.filter}
            placeholder="Filter shortcuts"
            aria-label="Filter shortcuts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {customised > 0 && (
            <button type="button" className={styles.resetAll} onClick={() => save({})}>
              <RotateCcw size={14} aria-hidden /> Reset all ({customised})
            </button>
          )}
        </div>

        {groups.map((group) => (
          <div key={group.id} className={styles.group}>
            <h3 className={styles.groupTitle}>{group.label}</h3>
            <ul className={styles.list}>
              {group.commands.map((cmd) => {
                const keys = keysFor(cmd.id, preset, bindings);
                const isCustom = cmd.id in bindings;
                return (
                  <li key={cmd.id} className={styles.row}>
                    <span className={styles.title}>{cmd.title}</span>
                    <span className={styles.keys}>
                      {keys.length === 0 && <span className={styles.none}>No shortcut</span>}
                      {keys.map((chord) => (
                        <span key={chord} className={styles.chip}>
                          <kbd>{formatChord(chord, platform)}</kbd>
                          <button
                            type="button"
                            className={styles.chipRemove}
                            aria-label={`Remove ${formatChord(chord, platform)} from ${cmd.title}`}
                            onClick={() => removeChord(cmd.id, chord)}
                          >
                            <X size={12} aria-hidden />
                          </button>
                        </span>
                      ))}
                      {recording === cmd.id ? (
                        <button
                          type="button"
                          className={`${styles.add} ${styles.recording}`}
                          autoFocus
                          onKeyDown={(e) => onRecordKey(e, cmd.id)}
                          onBlur={() => setRecording(null)}
                        >
                          Press keys… (Esc to cancel)
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.add}
                          aria-label={`Add a shortcut for ${cmd.title}`}
                          onClick={() => { setPending(null); setError(null); setRecording(cmd.id); }}
                        >
                          <Plus size={12} aria-hidden />
                        </button>
                      )}
                      {isCustom && (
                        <button
                          type="button"
                          className={styles.reset}
                          onClick={() => { const next = { ...bindings }; delete next[cmd.id]; save(next); }}
                        >
                          Reset
                        </button>
                      )}
                    </span>
                    {pending?.id === cmd.id && (
                      <div className={styles.conflict} role="alert">
                        <span>
                          {formatChord(pending.chord, platform)} already runs{' '}
                          {pending.conflicts.map((c) => `${c.title} (${COMMAND_APPS.find((a) => a.id === c.app)!.label})`).join(', ')}.
                        </span>
                        <button type="button" onClick={() => addChord(cmd.id, pending.chord, pending.conflicts)}>
                          Use it here instead
                        </button>
                        <button type="button" onClick={() => setPending(null)}>Cancel</button>
                      </div>
                    )}
                    {error?.id === cmd.id && <div className={styles.conflict} role="alert">{error.message}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {groups.length === 0 && <p className={styles.sectionDesc}>No shortcuts match “{query}”.</p>}
      </section>
    </div>
  );
}
