'use client';

/**
 * The `{{` autocomplete for a plain `<input>`.
 *
 * The document body gets this from a ProseMirror plugin, which is not available
 * to the header and footer bands: those are one-line `<input>` elements holding
 * the slot's raw text, tokens and all. The rules are meant to be identical
 * either way, so the parts that decide *behaviour* — the pattern that opens a
 * token, the ranking, the keys — are the same functions and the same order
 * here; only the mechanics of reading a caret and splicing a string differ.
 *
 * One hook serves every input on screen rather than one per input. Only the
 * focused field can have a token open, so per-input instances would be a dozen
 * copies of the same state, all but one of them empty — and the one that
 * mattered would still have to be found before a key could be answered.
 */

import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { fieldSuggestions, type FieldSuggestion } from '@/lib/docFields';

/** A code being typed: `{{`, then the characters a code may contain. */
const OPEN_TOKEN = /\{\{([A-Za-z0-9_-]*)$/;

/** Write the field's new text back into wherever the caller keeps it. */
export type CommitValue = (value: string) => void;

interface TrackedState {
  input: HTMLInputElement;
  /** Index of the opening `{` within the input's value. */
  from: number;
  query: string;
  items: FieldSuggestion[];
  index: number;
}

export interface FieldCodeAutocomplete {
  open: boolean;
  items: FieldSuggestion[];
  index: number;
  /** The tracked input's box, for the menu to sit under. */
  anchor: { left: number; top: number; bottom: number } | null;
  /**
   * Re-read the token from `input`. Call whenever its value or caret may have
   * moved — on change, on focus, and on selection changes.
   */
  track: (input: HTMLInputElement | null, commit: CommitValue) => void;
  /**
   * Answer a key press. Returns true when the menu consumed it, so the caller
   * can leave its own Enter/Escape handling alone in that case.
   */
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => boolean;
  /** Replace the open token with `item`'s code. */
  pick: (item: FieldSuggestion) => void;
  close: () => void;
}

/** Wrap `index` into `[0, length)`, so Up from the first row lands on the last. */
function wrap(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function useFieldCodeAutocomplete(customCodes: string[] = []): FieldCodeAutocomplete {
  const [state, setState] = useState<TrackedState | null>(null);
  // The token Escape was pressed on, so the menu stays shut while the caret is
  // still inside it rather than reopening on the next keystroke.
  const dismissedRef = useRef<{ input: HTMLInputElement; from: number } | null>(null);
  // In a ref rather than in state: the caller's commit closure is new on every
  // render, and keeping it in state would make every caret move a re-render
  // even when the menu has not changed at all.
  const commitRef = useRef<CommitValue>(() => {});

  const close = useCallback(() => setState(null), []);

  const track = useCallback(
    (input: HTMLInputElement | null, commit: CommitValue) => {
      if (!input) {
        setState(null);
        return;
      }
      commitRef.current = commit;
      const caret = input.selectionStart ?? input.value.length;
      // A selection is not a caret, and a token cannot be open behind one.
      const collapsed = input.selectionEnd === caret;
      const match = collapsed ? OPEN_TOKEN.exec(input.value.slice(0, caret)) : null;
      if (!match) {
        // The caret has left the token, so a later one at the same place is a
        // new token and deserves a menu.
        dismissedRef.current = null;
        setState(null);
        return;
      }

      const from = caret - match[0].length;
      const dismissed = dismissedRef.current;
      if (dismissed && dismissed.input === input && dismissed.from === from) {
        setState(null);
        return;
      }
      dismissedRef.current = null;

      const query = match[1];
      setState(prev => {
        // `select` fires on every caret move, most of which change nothing —
        // returning the previous state is what stops each of them re-rendering
        // every band on screen.
        if (prev && prev.input === input && prev.from === from && prev.query === query) return prev;
        return {
          input,
          from,
          query,
          // Re-ranked on every keystroke, so the highlight goes back to the
          // best match rather than staying on a row that has moved or vanished.
          items: fieldSuggestions(query, customCodes),
          index: 0,
        };
      });
    },
    [customCodes],
  );

  const pick = useCallback((item: FieldSuggestion) => {
    setState(current => {
      if (!current) return null;
      const { input, from } = current;
      const caret = input.selectionStart ?? input.value.length;
      const token = `{{${item.code}}}`;
      const value = input.value.slice(0, from) + token + input.value.slice(caret);
      const next = from + token.length;

      // Written to the DOM first and then to React state. The input is
      // controlled, so by the time React re-renders the value already matches
      // and it skips the write — which is what leaves the caret where this put
      // it instead of at the end of the field.
      input.value = value;
      input.setSelectionRange(next, next);
      commitRef.current(value);
      return null;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): boolean => {
      if (!state || state.items.length === 0) return false;

      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault();
          const move = event.key === 'ArrowDown' ? 1 : -1;
          setState(prev =>
            prev ? { ...prev, index: wrap(prev.index + move, prev.items.length) } : prev,
          );
          return true;
        }
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          pick(state.items[state.index]);
          return true;
        case 'Escape':
          event.preventDefault();
          dismissedRef.current = { input: state.input, from: state.from };
          setState(null);
          return true;
        default:
          return false;
      }
    },
    [state, pick],
  );

  let anchor: FieldCodeAutocomplete['anchor'] = null;
  if (state) {
    const rect = state.input.getBoundingClientRect();
    anchor = { left: rect.left, top: rect.top, bottom: rect.bottom };
  }

  return {
    open: Boolean(state && state.items.length > 0),
    items: state?.items ?? [],
    index: state?.index ?? 0,
    anchor,
    track,
    handleKeyDown,
    pick,
    close,
  };
}
