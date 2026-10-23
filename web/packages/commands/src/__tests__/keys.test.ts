import { describe, it, expect } from 'vitest';
import { chordFromEvent, formatChord, legacyChordFromEvent, normalizeChord } from '../keys';

function ev(key: string, mods: Partial<KeyboardEvent> = {}, code = ''): KeyboardEvent {
  return { key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods } as KeyboardEvent;
}

describe('chordFromEvent', () => {
  it('calls ⌘ Mod on a Mac and Ctrl Mod elsewhere', () => {
    expect(chordFromEvent(ev('s', { metaKey: true }), 'mac')).toBe('Mod+S');
    expect(chordFromEvent(ev('s', { ctrlKey: true }), 'other')).toBe('Mod+S');
    expect(chordFromEvent(ev('s', { ctrlKey: true }), 'mac')).toBe('Ctrl+S');
  });

  it('writes modifiers in a fixed order', () => {
    expect(chordFromEvent(ev('F', { metaKey: true, shiftKey: true, altKey: true }), 'mac')).toBe('Mod+Alt+Shift+F');
  });

  it('names a key a modifier rewrote by its physical position', () => {
    // Shift+; types ':', ⌥K types '˚' on a Mac.
    expect(chordFromEvent(ev(':', { metaKey: true, shiftKey: true }, 'Semicolon'), 'mac')).toBe('Mod+Shift+;');
    expect(chordFromEvent(ev('˚', { altKey: true }, 'KeyK'), 'mac')).toBe('Alt+K');
    expect(chordFromEvent(ev('!', { shiftKey: true }, 'Digit1'), 'other')).toBe('Shift+1');
  });

  it('takes letters from the layout, not the physical key', () => {
    // Dvorak: the key labelled S sits where QWERTY has O.
    expect(chordFromEvent(ev('s', { metaKey: true }, 'KeyO'), 'mac')).toBe('Mod+S');
  });

  it('is empty for a modifier on its own', () => {
    expect(chordFromEvent(ev('Shift', { shiftKey: true }), 'mac')).toBe('');
  });

  it('names Space', () => {
    expect(chordFromEvent(ev(' '), 'other')).toBe('Space');
  });
});

describe('legacyChordFromEvent', () => {
  it('treats Ctrl on a Mac, and ⊞ elsewhere, as Mod — every shortcut accepted both before', () => {
    expect(legacyChordFromEvent(ev('s', { ctrlKey: true }), 'mac')).toBe('Mod+S');
    expect(legacyChordFromEvent(ev('s', { metaKey: true }), 'other')).toBe('Mod+S');
  });

  it('has nothing to add when the primary modifier is held', () => {
    expect(legacyChordFromEvent(ev('s', { metaKey: true }), 'mac')).toBeNull();
    expect(legacyChordFromEvent(ev('s', { metaKey: true, ctrlKey: true }), 'mac')).toBeNull();
  });
});

describe('normalizeChord', () => {
  it('accepts any case, order and common aliases', () => {
    expect(normalizeChord('shift+mod+f')).toBe('Mod+Shift+F');
    expect(normalizeChord('Cmd+Option+x')).toBe('Alt+Meta+X');
    expect(normalizeChord('esc')).toBe('Escape');
    expect(normalizeChord('Mod++')).toBe('Mod++');
  });

  it('refuses what is not a chord', () => {
    expect(normalizeChord('')).toBeNull();
    expect(normalizeChord('Hyper+K')).toBeNull();
    expect(normalizeChord('Mod+')).toBeNull();
  });
});

describe('formatChord', () => {
  it('uses symbols on a Mac and words elsewhere', () => {
    expect(formatChord('Mod+Shift+F', 'mac')).toBe('⌘⇧F');
    expect(formatChord('Mod+Shift+F', 'other')).toBe('Ctrl+Shift+F');
    expect(formatChord('ArrowLeft', 'other')).toBe('←');
  });
});
