/**
 * Chords: the canonical text of a key combination, e.g. `Mod+Shift+F`.
 *
 * `Mod` is ⌘ on a Mac and Ctrl everywhere else, so one default binding serves both. Modifiers
 * are written in a fixed order (Mod, Ctrl, Alt, Shift, Meta) and the key last, letters upper
 * case, so a chord typed by a user, read from storage or built from an event compares as text.
 */

export type Platform = 'mac' | 'other';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const name = nav.userAgentData?.platform || nav.platform || '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
}

const MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Keys named by their physical position, for when a modifier turned them into another character. */
const CODE_KEYS: Record<string, string> = {
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Slash: '/', Period: '.', Comma: ',', Minus: '-', Equal: '=', Backquote: '`',
};

const NAMED: Record<string, string> = {
  ' ': 'Space', Esc: 'Escape', Del: 'Delete', Up: 'ArrowUp', Down: 'ArrowDown',
  Left: 'ArrowLeft', Right: 'ArrowRight',
};

/**
 * The key part of a chord for `e`. Letters come from `e.key` so a Dvorak or AZERTY user's ⌘S is
 * the key labelled S; anything a modifier may have rewritten (Shift+; is `:`, ⌥K is `˚`) comes
 * from `e.code`, the physical key, which is what the binding means.
 */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const k = e.key;
  if (NAMED[k]) return NAMED[k];
  if (k.length === 1) {
    const lower = k.toLowerCase();
    if (lower >= 'a' && lower <= 'z') return lower.toUpperCase();
    const letter = /^Key([A-Z])$/.exec(e.code ?? '');
    if (letter) return letter[1];
    const digit = /^Digit(\d)$/.exec(e.code ?? '');
    if (digit) return digit[1];
    return CODE_KEYS[e.code ?? ''] ?? k;
  }
  return k;
}

type ModifierEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * The chord `e` makes on `platform`: the primary modifier (⌘ on a Mac, Ctrl elsewhere) is
 * `Mod`, the other one `Ctrl` on a Mac and `Meta` elsewhere. Empty for a modifier on its own.
 */
export function chordFromEvent(e: ModifierEvent, platform: Platform): string {
  const mac = platform === 'mac';
  const parts: Modifier[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (!mac && e.metaKey) parts.push('Meta');
  return withKey(parts, e);
}

/**
 * The chord `e` makes if whichever one of Ctrl and ⌘ is held counts as `Mod`, or `null` when
 * that is the chord `chordFromEvent` already gave. Every shortcut before the registry accepted
 * Ctrl and ⌘ alike on every platform; the dispatcher keeps that as a fallback, so Ctrl+S still
 * saves on a Mac unless something is bound to ⌃S itself.
 */
export function legacyChordFromEvent(e: ModifierEvent, platform: Platform): string | null {
  const secondary = platform === 'mac' ? e.ctrlKey : e.metaKey;
  const primary = platform === 'mac' ? e.metaKey : e.ctrlKey;
  if (!secondary || primary) return null;
  const parts: Modifier[] = ['Mod'];
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  return withKey(parts, e);
}

function withKey(parts: Modifier[], e: ModifierEvent): string {
  const key = keyOf(e);
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return '';
  return [...parts, key].join('+');
}

/** `text` in canonical form, or `null` when it is not a chord. Accepts any case and modifier order. */
export function normalizeChord(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  // A trailing '+' is the plus key itself ("Mod++").
  const parts = raw.endsWith('++') ? [...raw.slice(0, -2).split('+'), '+'] : raw.split('+');
  const key = parts.pop()!.trim();
  if (!key) return null;
  const mods = new Set<Modifier>();
  for (const p of parts) {
    const m = MODIFIER_ALIASES[p.trim().toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const named = NAMED[key] ?? NAMED_LOWER[key.toLowerCase()];
  const k = named ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  return [...MODIFIERS.filter((m) => mods.has(m)), k].join('+');
}

const MODIFIER_ALIASES: Record<string, Modifier> = {
  mod: 'Mod', cmdorctrl: 'Mod', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta', super: 'Meta', win: 'Meta',
};

const NAMED_LOWER: Record<string, string> = {
  space: 'Space', esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete',
  backspace: 'Backspace', enter: 'Enter', return: 'Enter', tab: 'Tab', up: 'ArrowUp',
  down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home',
  end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

/** Whether `chord` has a modifier other than Shift — one that typing never produces. */
export function hasCommandModifier(chord: string): boolean {
  return /(^|\+)(Mod|Ctrl|Alt|Meta)\+/.test(chord);
}

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc',
  Backspace: '⌫', Delete: 'Del', Enter: '↵',
};

/** How `chord` reads on `platform`: `⌘⇧F` on a Mac, `Ctrl+Shift+F` elsewhere. */
export function formatChord(chord: string, platform: Platform): string {
  const parts = chord.endsWith('++') ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
  const key = parts.pop()!;
  const label = KEY_LABELS[key] ?? key;
  if (platform === 'mac') return parts.map((m) => MAC_SYMBOLS[m] ?? m).join('') + label;
  return [...parts.map((m) => (m === 'Mod' ? 'Ctrl' : m === 'Meta' ? 'Win' : m)), label].join('+');
}
