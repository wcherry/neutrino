/**
 * The menu that opens while a `{{` token is being typed.
 *
 * Field codes are only useful if you know they exist, and a syntax you have to
 * have read the help for is a syntax nobody uses. So typing `{{` lists every
 * code with a line of description, and each further character narrows and
 * re-ranks the list (`docFields.fieldSuggestions` owns the ranking).
 *
 * Everything about *which* token is open lives in this plugin rather than in
 * React, for one reason: the caret stays in the document the whole time, so the
 * arrow keys and Enter have to be answered by a ProseMirror key handler, and a
 * handler that read its list from React state would be answering with whatever
 * the last render happened to leave behind. The plugin holds the list and the
 * highlighted row; the popover renders them and is otherwise inert.
 *
 * The token ends at the first character that cannot be part of a code, which is
 * what closes the menu when a fallback starts: `{{author:` is no longer a code
 * being typed, it is a code with free text after it.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { NodeType } from '@tiptap/pm/model';
import { fieldSuggestions, type FieldSuggestion } from '@/lib/docFields';

export interface FieldSuggestionState {
  /** Position of the opening `{`, or `null` when no token is being typed. */
  from: number | null;
  /** The caret — the end of what has been typed so far. */
  to: number;
  /** The characters after `{{`. */
  query: string;
  /** The highlighted row. Always a valid index into `items` when open. */
  index: number;
  items: FieldSuggestion[];
  /**
   * The token Escape was pressed on. Kept so the menu stays shut while the
   * caret is still inside it, instead of reopening on the next keystroke.
   */
  dismissedFrom: number | null;
  decorations: DecorationSet;
}

export const fieldSuggestionKey = new PluginKey<FieldSuggestionState>('docFieldSuggestion');

/** A code being typed: `{{`, then the characters a code may contain. */
const OPEN_TOKEN = /\{\{([A-Za-z0-9_-]*)$/;

const CLOSED: Omit<FieldSuggestionState, 'dismissedFrom' | 'decorations'> = {
  from: null,
  to: 0,
  query: '',
  index: 0,
  items: [],
};

/** Whether the menu has something to show. */
export function isSuggestionOpen(state: FieldSuggestionState | undefined): boolean {
  return Boolean(state && state.from !== null && state.items.length > 0);
}

export function getFieldSuggestionState(state: EditorState): FieldSuggestionState | undefined {
  return fieldSuggestionKey.getState(state);
}

/** The token open at the caret, if there is one. */
function detectToken(state: EditorState): { from: number; to: number; query: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  // Not inside a code block: `{{page}}` there is a literal someone is writing
  // about, not a field they want.
  if ($from.parent.type.spec.code) return null;

  // `￼` stands in for every leaf node so one node counts as one character
  // and the offsets below stay aligned with document positions.
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = OPEN_TOKEN.exec(textBefore);
  if (!match) return null;

  return { from: selection.from - match[0].length, to: selection.from, query: match[1] };
}

export interface SuggestionMeta {
  /** Move the highlight, wrapping at both ends. */
  move?: number;
  /** Close the menu for the token the caret is in. */
  dismiss?: true;
}

/** Ask the plugin to move the highlight or close the menu. */
export function dispatchSuggestion(view: EditorView, meta: SuggestionMeta): void {
  view.dispatch(view.state.tr.setMeta(fieldSuggestionKey, meta));
}

/**
 * Replace the token being typed with the field it names. Returns false when no
 * token is open, so a caller can fall through to whatever the key normally does.
 */
export function applySuggestion(
  view: EditorView,
  type: NodeType,
  item: FieldSuggestion,
): boolean {
  const state = getFieldSuggestionState(view.state);
  if (!state || state.from === null) return false;
  view.dispatch(
    view.state.tr.replaceWith(
      state.from,
      state.to,
      type.create({ code: item.code, arg: null, showCode: false }),
    ),
  );
  view.focus();
  return true;
}

/** Wrap `index` into `[0, length)`, so Up from the first row lands on the last. */
function wrap(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function decorate(state: EditorState, from: number | null, to: number): DecorationSet {
  if (from === null) return DecorationSet.empty;
  return DecorationSet.create(state.doc, [
    Decoration.inline(from, to, { class: 'doc-field-typing' }),
  ]);
}

/**
 * @param getCustomCodes the property names this document defines, so a menu
 *   opened in a document with a `client` property offers `{{client}}` too.
 */
export function docFieldSuggestionPlugin(
  getCustomCodes: () => string[],
): Plugin<FieldSuggestionState> {
  return new Plugin<FieldSuggestionState>({
    key: fieldSuggestionKey,

    state: {
      init: () => ({ ...CLOSED, dismissedFrom: null, decorations: DecorationSet.empty }),

      apply: (tr: Transaction, prev, _old, next): FieldSuggestionState => {
        const meta = tr.getMeta(fieldSuggestionKey) as SuggestionMeta | undefined;

        if (meta?.dismiss) {
          return {
            ...CLOSED,
            dismissedFrom: prev.from,
            decorations: DecorationSet.empty,
          };
        }

        if (meta?.move && prev.from !== null) {
          return { ...prev, index: wrap(prev.index + meta.move, prev.items.length) };
        }

        const token = detectToken(next);
        if (!token) {
          // The caret has left the token, so a later one at the same position
          // is a new token and deserves a menu.
          return { ...CLOSED, dismissedFrom: null, decorations: DecorationSet.empty };
        }
        if (token.from === prev.dismissedFrom) {
          return { ...CLOSED, dismissedFrom: prev.dismissedFrom, decorations: DecorationSet.empty };
        }

        // Re-ranked on every keystroke, so the highlight goes back to the best
        // match rather than staying on a row that has just moved or vanished.
        const items = fieldSuggestions(token.query, getCustomCodes());
        return {
          from: token.from,
          to: token.to,
          query: token.query,
          index: token.query === prev.query && prev.from !== null ? wrap(prev.index, items.length) : 0,
          items,
          dismissedFrom: null,
          decorations: decorate(next, token.from, token.to),
        };
      },
    },

    props: {
      decorations: state => fieldSuggestionKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}
