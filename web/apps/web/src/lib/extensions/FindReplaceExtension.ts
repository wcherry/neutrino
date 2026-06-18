import { Extension } from '@tiptap/react';
import { Plugin, PluginKey, TextSelection, type Transaction, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MatchRange {
  from: number;
  to: number;
}

interface FindReplacePluginState {
  searchTerm: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  results: MatchRange[];
  currentIndex: number;
  decorations: DecorationSet;
}

// ── Plugin key (exported for external read-access in FindReplaceBar) ───────────

export const findReplacePluginKey = new PluginKey<FindReplacePluginState>('findReplace');

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildRegex(term: string, caseSensitive: boolean, wholeWord: boolean): RegExp | null {
  if (!term.trim()) return null;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
}

function findMatches(doc: PmNode, regex: RegExp): MatchRange[] {
  const results: MatchRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(node.text)) !== null) {
      results.push({ from: pos + m.index, to: pos + m.index + m[0].length });
    }
  });
  return results;
}

function buildDecorations(doc: PmNode, results: MatchRange[], currentIndex: number): DecorationSet {
  if (results.length === 0) return DecorationSet.empty;
  const decorations = results.map((r, i) =>
    Decoration.inline(r.from, r.to, {
      class: i === currentIndex ? 'find-replace-current' : 'find-replace-match',
    })
  );
  return DecorationSet.create(doc, decorations);
}

// ── Command type augmentation ─────────────────────────────────────────────────

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    findReplace: {
      setFindTerm: (term: string, opts?: { caseSensitive?: boolean; wholeWord?: boolean }) => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replaceOne: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────────

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplacePluginState>({
        key: findReplacePluginKey,

        state: {
          init() {
            return {
              searchTerm: '',
              caseSensitive: false,
              wholeWord: false,
              results: [],
              currentIndex: -1,
              decorations: DecorationSet.empty,
            };
          },

          apply(tr: Transaction, old: FindReplacePluginState, _oldState: EditorState, newState: EditorState): FindReplacePluginState {
            const meta = tr.getMeta(findReplacePluginKey) as Partial<FindReplacePluginState> | undefined;

            let { searchTerm, caseSensitive, wholeWord, results, currentIndex } = old;

            if (meta) {
              if (meta.searchTerm !== undefined) searchTerm = meta.searchTerm;
              if (meta.caseSensitive !== undefined) caseSensitive = meta.caseSensitive;
              if (meta.wholeWord !== undefined) wholeWord = meta.wholeWord;
              if (meta.currentIndex !== undefined) currentIndex = meta.currentIndex;
            }

            const needsRecompute =
              tr.docChanged ||
              (meta &&
                (meta.searchTerm !== undefined ||
                  meta.caseSensitive !== undefined ||
                  meta.wholeWord !== undefined));

            if (needsRecompute) {
              const regex = buildRegex(searchTerm, caseSensitive, wholeWord);
              results = regex ? findMatches(newState.doc, regex) : [];
              if (results.length === 0) {
                currentIndex = -1;
              } else if (currentIndex < 0) {
                currentIndex = 0;
              } else if (currentIndex >= results.length) {
                currentIndex = results.length - 1;
              }
            }

            return {
              searchTerm,
              caseSensitive,
              wholeWord,
              results,
              currentIndex,
              decorations: buildDecorations(newState.doc, results, currentIndex),
            };
          },
        },

        props: {
          decorations(state: EditorState) {
            return findReplacePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): any {
    return {
      setFindTerm:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (term: string, opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined }) => {
          if (dispatch) {
            tr.setMeta(findReplacePluginKey, {
              searchTerm: term,
              caseSensitive: opts.caseSensitive ?? false,
              wholeWord: opts.wholeWord ?? false,
              currentIndex: 0,
            });
            dispatch(tr);
          }
          return true;
        },

      findNext:
        () =>
        ({ tr, dispatch, state }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined; state: EditorState }) => {
          const ps = findReplacePluginKey.getState(state);
          if (!ps || ps.results.length === 0) return false;
          const nextIndex = (ps.currentIndex + 1) % ps.results.length;
          if (dispatch) {
            const match = ps.results[nextIndex];
            tr.setMeta(findReplacePluginKey, { currentIndex: nextIndex });
            tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
            tr.scrollIntoView();
            dispatch(tr);
          }
          return true;
        },

      findPrev:
        () =>
        ({ tr, dispatch, state }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined; state: EditorState }) => {
          const ps = findReplacePluginKey.getState(state);
          if (!ps || ps.results.length === 0) return false;
          const prevIndex = (ps.currentIndex - 1 + ps.results.length) % ps.results.length;
          if (dispatch) {
            const match = ps.results[prevIndex];
            tr.setMeta(findReplacePluginKey, { currentIndex: prevIndex });
            tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
            tr.scrollIntoView();
            dispatch(tr);
          }
          return true;
        },

      replaceOne:
        (replacement: string) =>
        ({ tr, dispatch, state }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined; state: EditorState }) => {
          const ps = findReplacePluginKey.getState(state);
          if (!ps || ps.results.length === 0 || ps.currentIndex < 0) return false;
          if (dispatch) {
            const match = ps.results[ps.currentIndex];
            const node = state.schema.text(replacement);
            tr.replaceWith(match.from, match.to, node);
            dispatch(tr);
          }
          return true;
        },

      replaceAll:
        (replacement: string) =>
        ({ tr, dispatch, state }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined; state: EditorState }) => {
          const ps = findReplacePluginKey.getState(state);
          if (!ps || ps.results.length === 0) return false;
          if (dispatch) {
            const sorted = [...ps.results].sort((a, b) => b.from - a.from);
            for (const match of sorted) {
              tr.replaceWith(match.from, match.to, state.schema.text(replacement));
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
