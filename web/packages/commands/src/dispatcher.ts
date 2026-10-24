/**
 * The one place the app listens for keys.
 *
 * Every keyboard behaviour that is not scoped to a single element goes through here, in this
 * order, for each `keydown`:
 *
 * 1. **Dismiss layers** — Escape closes the topmost open menu, dialog or mode, and nothing under
 *    it. (Before, each had its own listener and one Escape closed every one of them at once.)
 * 2. **Commands** — the chord is looked up in the keymap and the most recently mounted, enabled
 *    handler for a bound command runs. Its catalog entry and the user's bindings decide the keys.
 * 3. **Key handlers** — behaviour that is not a nameable command (arrow keys moving a sheet's
 *    selection, type-to-edit, holding Space to pan), in mount order.
 *
 * The listeners are on `window` — keydown in the capture and bubble phases, keyup in the bubble
 * phase — installed with the first registration. The bubble phase is the default, so an element's own `onKeyDown` (an input's
 * Escape, ProseMirror's keymap) still sees the key first and can stop it; capture is only for a
 * command that must beat the focused element to it (the command palette's ⌘K, which an editor's
 * grid or canvas would otherwise swallow, and Docs' link, which macOS Chrome would otherwise take
 * as "delete to end of line").
 */

import { preferences } from '@neutrino/preferences';
import { commandSpec } from './catalog';
import { chordFromEvent, detectPlatform, hasCommandModifier, legacyChordFromEvent, type Platform } from './keys';
import { buildKeymap, isPreset, sanitizeBindings } from './keymap';

export type Phase = 'capture' | 'bubble';

export interface CommandOptions {
  /** Read at dispatch time. A disabled handler is passed over as if it were not mounted. */
  enabled?: () => boolean;
  phase?: Phase;
  /** Default true. False for a command that must let the browser's own action happen too (copy, paste). */
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

/** Return `false` to decline the key, which then goes on to the next handler as if this one were disabled. */
export type CommandRun = (e: KeyboardEvent) => void | boolean;

interface CommandEntry extends Required<Omit<CommandOptions, 'enabled'>> {
  id: string;
  run: CommandRun;
  enabled: () => boolean;
  seq: number;
}

export interface LayerOptions {
  /** Default true. False to let Escape pass this layer by while focus is in a text field. */
  whileTyping?: boolean;
}

interface LayerEntry {
  dismiss: (e: KeyboardEvent) => void;
  whileTyping: boolean;
  seq: number;
}

export type KeyEventType = 'keydown' | 'keyup';

interface HandlerEntry {
  type: KeyEventType;
  phase: Phase;
  handler: (e: KeyboardEvent) => void;
  seq: number;
}

let seq = 0;
const commands: CommandEntry[] = [];
const layers: LayerEntry[] = [];
const handlers: HandlerEntry[] = [];

let platform: Platform | null = null;
function currentPlatform(): Platform {
  return (platform ??= detectPlatform());
}

/** For tests: pretend to be on `p`. `null` goes back to detecting it. */
export function setPlatformForTesting(p: Platform | null): void {
  platform = p;
}

let keymap: Map<string, string[]> | null = null;
let unsubscribe: (() => void) | null = null;
function currentKeymap(): Map<string, string[]> {
  if (!keymap) {
    const preset = preferences.get('keyboard.preset');
    keymap = buildKeymap(isPreset(preset) ? preset : 'neutrino', sanitizeBindings(preferences.get('keyboard.bindings')));
  }
  return keymap;
}

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

let installed = false;
function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', onKeyDownCapture, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // The keymap is rebuilt lazily after any preference change; most changes are not bindings,
  // and a rebuild is a walk over the catalog.
  unsubscribe = preferences.subscribe(() => { keymap = null; });
}

/** For tests: drop every registration and the listeners, as if the page had just loaded. */
export function resetForTesting(): void {
  commands.length = 0;
  layers.length = 0;
  handlers.length = 0;
  keymap = null;
  unsubscribe?.();
  unsubscribe = null;
  if (installed && typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeyDownCapture, true);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  }
  installed = false;
}

/** Run `run` for command `id` until the returned function is called. */
export function registerCommand(id: string, run: CommandRun, options: CommandOptions = {}): () => void {
  if (!commandSpec(id) && process.env.NODE_ENV !== 'production') {
    console.warn(`[commands] "${id}" is not in the command catalog (packages/commands/src/catalog.ts); it will never run.`);
  }
  const entry: CommandEntry = {
    id,
    run,
    enabled: options.enabled ?? (() => true),
    phase: options.phase ?? 'bubble',
    preventDefault: options.preventDefault ?? true,
    stopPropagation: options.stopPropagation ?? false,
    seq: ++seq,
  };
  commands.push(entry);
  install();
  return () => remove(commands, entry);
}

/**
 * The ids with a mounted handler that is enabled right now — what the command palette offers.
 * In mount order, most recent last; each id once.
 */
export function availableCommands(): string[] {
  const seen = new Set<string>();
  for (const c of [...commands].sort((a, b) => a.seq - b.seq)) {
    if (commandSpec(c.id)?.palette === false) continue;
    if (c.enabled()) seen.add(c.id);
  }
  return [...seen];
}

/**
 * Run command `id` as if its key had been pressed — the most recently mounted enabled handler,
 * declining ones passed over, exactly as `runCommand` picks. Returns whether one ran. The event it
 * gets is a synthetic `keydown` with no key; a handler that needs a real one should be
 * `palette: false` in the catalog.
 */
export function runCommandById(id: string): boolean {
  const candidates = commands.filter((c) => c.id === id).sort((a, b) => b.seq - a.seq);
  const event = typeof KeyboardEvent !== 'undefined' ? new KeyboardEvent('keydown') : ({} as KeyboardEvent);
  for (const c of candidates) {
    if (!c.enabled()) continue;
    if (c.run(event) === false) continue;
    return true;
  }
  return false;
}

/** Make `dismiss` the topmost Escape layer until the returned function is called. */
export function pushLayer(dismiss: (e: KeyboardEvent) => void, options: LayerOptions = {}): () => void {
  const entry: LayerEntry = { dismiss, whileTyping: options.whileTyping ?? true, seq: ++seq };
  layers.push(entry);
  install();
  return () => remove(layers, entry);
}

/**
 * Call `handler` for every `type` event until the returned function is called. `phase` is for
 * keydown only; keyup is always seen in the bubble phase.
 */
export function addKeyHandler(
  type: KeyEventType,
  handler: (e: KeyboardEvent) => void,
  phase: Phase = 'bubble',
): () => void {
  const entry: HandlerEntry = { type, phase: type === 'keyup' ? 'bubble' : phase, handler, seq: ++seq };
  handlers.push(entry);
  install();
  return () => remove(handlers, entry);
}

/** Whether `target` takes typed text: a text field, a select or anything contenteditable. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  // `closest` as well as `isContentEditable`, which jsdom does not implement.
  return el.isContentEditable || !!el.closest?.('[contenteditable]:not([contenteditable="false"])');
}

function dismissTopLayer(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.isComposing || layers.length === 0) return false;
  const typing = isEditableTarget(e.target);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (typing && !layer.whileTyping) continue;
    layer.dismiss(e);
    return true;
  }
  return false;
}

function runCommand(e: KeyboardEvent, phase: Phase): boolean {
  if (e.isComposing || commands.length === 0) return false;
  const p = currentPlatform();
  const map = currentKeymap();
  const chord = chordFromEvent(e, p);
  if (!chord) return false;
  let ids = map.get(chord);
  if (!ids) {
    const legacy = legacyChordFromEvent(e, p);
    if (legacy) ids = map.get(legacy);
  }
  if (!ids) return false;
  const typing = isEditableTarget(e.target);
  // A bare key is someone typing, whatever the command allows.
  if (typing && !hasCommandModifier(chord) && !/^F\d+$/.test(chord.replace(/^Shift\+/, ''))) return false;

  // Most recently mounted first: a dialog's command shadows the page's under it.
  const candidates = commands
    .filter((c) => c.phase === phase && ids!.includes(c.id))
    .sort((a, b) => b.seq - a.seq);
  for (const c of candidates) {
    if (typing && commandSpec(c.id)?.whileTyping !== 'run') continue;
    if (!c.enabled()) continue;
    if (c.run(e) === false) continue;
    if (c.preventDefault) e.preventDefault();
    if (c.stopPropagation) e.stopPropagation();
    return true;
  }
  return false;
}

function runHandlers(e: KeyboardEvent, type: KeyEventType, phase: Phase): void {
  // A copy, so a handler that unmounts another (or itself) does not skip the next one.
  for (const h of handlers.filter((x) => x.type === type && x.phase === phase)) h.handler(e);
}

/**
 * Keys a capture-phase command already ran for. One key press runs one command: without this, the
 * bubble phase would also run a bubble-phase command bound to the same chord, so two commands
 * the user has bound to one key would both fire. Dismiss layers and key
 * handlers still see the key, as they always have.
 */
const handledInCapture = new WeakSet<Event>();

function onKeyDownCapture(e: KeyboardEvent): void {
  if (runCommand(e, 'capture')) {
    handledInCapture.add(e);
    return;
  }
  runHandlers(e, 'keydown', 'capture');
}

function onKeyDown(e: KeyboardEvent): void {
  if (dismissTopLayer(e)) return;
  if (!handledInCapture.has(e) && runCommand(e, 'bubble')) return;
  runHandlers(e, 'keydown', 'bubble');
}

function onKeyUp(e: KeyboardEvent): void {
  runHandlers(e, 'keyup', 'bubble');
}
