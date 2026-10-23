'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { preferences } from '@neutrino/preferences';
import type { CommandId } from './catalog';
import {
  addKeyHandler,
  pushLayer,
  registerCommand,
  type CommandRun,
  type KeyEventType,
  type Phase,
} from './dispatcher';
import { buildKeymap, isPreset, sanitizeBindings, type Bindings, type Preset } from './keymap';

export interface UseCommandOptions {
  /** Default true. Changing it does not re-register, so the handler keeps its place. */
  enabled?: boolean;
  phase?: Phase;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

/**
 * Run `run` when command `id`'s keys are pressed, while this component is mounted. `run` may
 * change every render; the latest one is called.
 */
export function useCommand(id: CommandId, run: CommandRun, options: UseCommandOptions = {}): void {
  const runRef = useRef(run);
  runRef.current = run;
  const enabledRef = useRef(options.enabled ?? true);
  enabledRef.current = options.enabled ?? true;
  const { phase, preventDefault, stopPropagation } = options;
  useEffect(
    () => registerCommand(id, (e) => runRef.current(e), {
      enabled: () => enabledRef.current,
      phase,
      preventDefault,
      stopPropagation,
    }),
    [id, phase, preventDefault, stopPropagation],
  );
}

/** `useCommand` for several commands that share options. `runs` may change every render. */
export function useCommands(
  runs: Partial<Record<CommandId, CommandRun>>,
  options: UseCommandOptions = {},
): void {
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const enabledRef = useRef(options.enabled ?? true);
  enabledRef.current = options.enabled ?? true;
  const ids = Object.keys(runs).sort().join(' ');
  const { phase, preventDefault, stopPropagation } = options;
  useEffect(() => {
    const offs = ids.split(' ').filter(Boolean).map((id) =>
      registerCommand(id, (e) => {
        // A handler that went away since the last render declines; one that returns nothing ran.
        const run = runsRef.current[id as CommandId];
        return run ? run(e) : false;
      }, {
        enabled: () => enabledRef.current,
        phase,
        preventDefault,
        stopPropagation,
      }),
    );
    return () => offs.forEach((off) => off());
  }, [ids, phase, preventDefault, stopPropagation]);
}

/**
 * Close this menu, dialog or mode on Escape while `open` — unless something opened after it is
 * still open, in which case only that one closes. The layer takes its place when `open` turns
 * true, so the most recently opened thing is always the one on top.
 */
export function useDismiss(
  onDismiss: (e: KeyboardEvent) => void,
  open = true,
  options: { whileTyping?: boolean } = {},
): void {
  const ref = useRef(onDismiss);
  ref.current = onDismiss;
  const { whileTyping } = options;
  useEffect(() => {
    if (!open) return;
    return pushLayer((e) => ref.current(e), { whileTyping });
  }, [open, whileTyping]);
}

/**
 * Call `handler` for every key event of `type` while `enabled` — for key behaviour that is not a
 * nameable, remappable command (arrow-key navigation, type-to-edit, holding a key down).
 */
export function useKeyHandler(
  handler: (e: KeyboardEvent) => void,
  options: { type?: KeyEventType; phase?: Phase; enabled?: boolean } = {},
): void {
  const ref = useRef(handler);
  ref.current = handler;
  const { type = 'keydown', phase = 'bubble', enabled = true } = options;
  useEffect(() => {
    if (!enabled) return;
    return addKeyHandler(type, (e) => ref.current(e), phase);
  }, [type, phase, enabled]);
}

/** The user's preset and bindings, sanitized, and the keymap they make. For Settings › Keyboard. */
export function useKeymap(): { preset: Preset; bindings: Bindings; keymap: Map<string, string[]> } {
  const preset = useSyncExternalStore(preferences.subscribe, () => preferences.get('keyboard.preset'), () => 'neutrino');
  const stored = useSyncExternalStore(preferences.subscribe, () => preferences.get('keyboard.bindings'), () => null);
  const cache = useRef<{ preset: unknown; stored: unknown; value: ReturnType<typeof useKeymap> } | null>(null);
  if (!cache.current || cache.current.preset !== preset || cache.current.stored !== stored) {
    const p = isPreset(preset) ? preset : 'neutrino';
    const bindings = sanitizeBindings(stored);
    cache.current = { preset, stored, value: { preset: p, bindings, keymap: buildKeymap(p, bindings) } };
  }
  return cache.current.value;
}
