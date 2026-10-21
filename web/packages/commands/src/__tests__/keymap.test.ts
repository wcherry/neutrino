import { describe, it, expect } from 'vitest';
import { COMMANDS, sharesScope, type CommandSpec } from '../catalog';
import { normalizeChord } from '../keys';
import { PRESETS, buildKeymap, conflictsWith, keysFor, sanitizeBindings } from '../keymap';

const all = COMMANDS as readonly CommandSpec[];

describe('catalog', () => {
  it('has unique ids, and every default key is a chord in canonical form', () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    for (const c of all) for (const k of c.defaultKeys) expect(normalizeChord(k)).toBe(k);
  });

  it('ships no conflicts — in the defaults or any preset', () => {
    for (const preset of PRESETS) {
      const keymap = buildKeymap(preset.id, {});
      for (const c of all) {
        for (const chord of keysFor(c.id, preset.id, {})) {
          expect(conflictsWith(c.id, chord, keymap).map((x) => x.id), `${preset.id}: ${c.id} on ${chord}`).toEqual([]);
        }
      }
    }
  });

  it('presets only name commands in the catalog, with canonical chords', () => {
    for (const preset of PRESETS) {
      for (const [id, keys] of Object.entries(preset.keys)) {
        expect(all.some((c) => c.id === id), id).toBe(true);
        for (const k of keys!) expect(normalizeChord(k)).toBe(k);
      }
    }
  });
});

describe('keysFor', () => {
  it('takes the user over the preset over the default', () => {
    expect(keysFor('sheets.replace', 'neutrino', {})).toEqual(['Mod+H']);
    expect(keysFor('sheets.replace', 'google', {})).toEqual(['Mod+Shift+H']);
    expect(keysFor('sheets.replace', 'google', { 'sheets.replace': ['Mod+Alt+H'] })).toEqual(['Mod+Alt+H']);
  });

  it('lets a user unbind a command with an empty list', () => {
    const keymap = buildKeymap('neutrino', { 'docs.save': [] });
    expect(keymap.get('Mod+S')).not.toContain('docs.save');
  });
});

describe('sanitizeBindings', () => {
  it('drops unknown commands, bad chords and duplicates, and normalizes the rest', () => {
    expect(sanitizeBindings({
      'docs.save': ['shift+mod+s', 'Mod+Shift+S', 'Hyper+S', 7],
      'gone.command': ['Mod+G'],
      'docs.find': 'Mod+F',
    })).toEqual({ 'docs.save': ['Mod+Shift+S'] });
  });

  it('is empty for anything that is not an object', () => {
    expect(sanitizeBindings(null)).toEqual({});
    expect(sanitizeBindings(['Mod+S'])).toEqual({});
  });
});

describe('conflictsWith', () => {
  it('reports a chord another command uses where both can run', () => {
    const keymap = buildKeymap('neutrino', {});
    expect(conflictsWith('editors.spellCheck.toggle', 'Mod+S', keymap).map((c) => c.id).sort())
      .toEqual(['docs.save', 'sheets.save', 'slides.save']);
  });

  it('ignores the same chord in an app that is never open at the same time', () => {
    const keymap = buildKeymap('neutrino', {});
    expect(conflictsWith('docs.find', 'Mod+H', keymap)).toEqual([]);
  });

  it('treats Everywhere as sharing a scope with every app', () => {
    expect(sharesScope('global', 'drawing')).toBe(true);
    expect(sharesScope('editors', 'drawing')).toBe(false);
  });
});
