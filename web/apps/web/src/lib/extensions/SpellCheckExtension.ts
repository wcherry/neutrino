import { Extension } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { NspellHandle } from '@/hooks/useNspell';
import {
  DECORATION_WINDOW_META,
  buildAll,
  forEachText,
  mapWindow,
  moveWindow,
  observeDecorationWindow,
  sameWindow,
  settleWindow,
  updateForTransaction,
  withinWindow,
  type DecorationWindow,
} from './incrementalDecorations';

// ── Plugin key (exported for external access) ──────────────────────────────────

export const spellCheckPluginKey = new PluginKey<SpellPluginState>('spellCheck');

// ── Types ──────────────────────────────────────────────────────────────────────

interface SpellPluginState {
  enabled: boolean;
  nspell: NspellHandle | null;
  decorations: DecorationSet;
  /** Where misspellings are drawn: around the viewport in a long document (incrementalDecorations.ts). */
  window: DecorationWindow;
}

interface SpellCheckMeta {
  enabled?: boolean;
  nspell?: NspellHandle | null;
  window?: DecorationWindow;
  /** Answers arrived from the worker that flag words already drawn as correct. */
  recheck?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Matches words (2+ letters, supports contractions like "don't")
const WORD_RE = /[a-zA-Z]{2,}(?:'[a-zA-Z]+)*/g;

// Treat a word as correct if nspell knows it, or if the lowercased form is known
// (so "The" at sentence start and capitalised proper nouns aren't flagged).
function isCorrect(nspell: NspellHandle, word: string): boolean {
  if (nspell.check(word)) return true;
  if (word !== word.toLowerCase() && nspell.check(word.toLowerCase())) return true;
  return false;
}

/** The misspellings in one textblock. Code blocks are skipped: spell-checking code is noise. */
function blockDecorations(nspell: NspellHandle, block: PmNode, pos: number): Decoration[] {
  if (block.type.name === 'codeBlock') return [];
  const out: Decoration[] = [];
  forEachText(block, pos, (text, at) => {
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      if (!isCorrect(nspell, m[0])) {
        out.push(Decoration.inline(at + m.index, at + m.index + m[0].length, { class: 'spell-error' }));
      }
    }
  });
  return out;
}


// ── Command type augmentation ─────────────────────────────────────────────────

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    spellCheck: {
      updateSpellCheck: (opts: { enabled?: boolean; nspell?: NspellHandle | null }) => ReturnType;
    };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────────

export const SpellCheckExtension = Extension.create({
  name: 'spellCheck',

  addProseMirrorPlugins() {
    return [
      new Plugin<SpellPluginState>({
        key: spellCheckPluginKey,

        state: {
          init(_config: unknown, state: EditorState): SpellPluginState {
            return { enabled: false, nspell: null, decorations: DecorationSet.empty, window: settleWindow(state.doc, null) };
          },

          apply(tr: Transaction, old: SpellPluginState, _oldState: EditorState, newState: EditorState): SpellPluginState {
            const meta = tr.getMeta(spellCheckPluginKey) as SpellCheckMeta | undefined;
            if (!meta && !tr.docChanged) return old;

            const enabled = meta?.enabled !== undefined ? meta.enabled : old.enabled;
            const nspell = meta?.nspell !== undefined ? meta.nspell : old.nspell;
            const mapped = tr.docChanged ? mapWindow(old.window, tr) : old.window;
            const window = settleWindow(newState.doc, meta?.window !== undefined ? meta.window : mapped);
            if (!enabled || !nspell) return { enabled, nspell, decorations: DecorationSet.empty, window };
            const build = (block: PmNode, pos: number) => blockDecorations(nspell, block, pos);

            // A setting changed: the window is re-checked once. A document change re-checks only
            // the paragraphs it touched (incrementalDecorations.ts) — rebuilding the whole set on
            // every keystroke was the largest cost of typing in a long document — and a scroll only
            // the paragraphs it brought near the screen.
            if (meta?.enabled !== undefined || meta?.nspell !== undefined || meta?.recheck || !old.enabled || !old.nspell) {
              return { enabled, nspell, decorations: buildAll(newState.doc, build, window), window };
            }
            let decorations = old.decorations;
            if (tr.docChanged) decorations = updateForTransaction(decorations, tr, withinWindow(mapped, build));
            if (!sameWindow(mapped, window)) decorations = moveWindow(decorations, newState.doc, mapped, window, build);
            return { enabled, nspell, decorations, window };
          },
        },

        props: {
          decorations(state: EditorState) {
            const ps = spellCheckPluginKey.getState(state);
            if (!ps?.enabled) return DecorationSet.empty;
            return ps.decorations;
          },
        },

        view(view) {
          const observer = observeDecorationWindow(view, (window) => {
            const current = spellCheckPluginKey.getState(view.state);
            if (!current || sameWindow(current.window, settleWindow(view.state.doc, window))) return;
            // Mid-composition the selection belongs to the IME; the next edit asks again.
            if (view.composing) return;
            view.dispatch(
              view.state.tr.setMeta(spellCheckPluginKey, { window }).setMeta(DECORATION_WINDOW_META, true),
            );
          });
          // The worker's answers come after the pass that asked for them; when one turns out to be a
          // misspelling, the window is drawn again from the answers now known.
          let subscribed: NspellHandle | null = null;
          let unsubscribe: (() => void) | undefined;
          const follow = () => {
            const handle = spellCheckPluginKey.getState(view.state)?.nspell ?? null;
            if (handle === subscribed) return;
            unsubscribe?.();
            subscribed = handle;
            unsubscribe = handle?.onChange?.(() => {
              if (view.isDestroyed || view.composing) return;
              view.dispatch(
                view.state.tr.setMeta(spellCheckPluginKey, { recheck: true }).setMeta(DECORATION_WINDOW_META, true),
              );
            });
          };
          follow();
          return {
            update: (updated, prevState) => {
              follow();
              if (updated.state.doc !== prevState.doc) observer.update();
            },
            destroy: () => {
              unsubscribe?.();
              observer.destroy();
            },
          };
        },
      }),
    ];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): any {
    return {
      updateSpellCheck:
        (opts: { enabled?: boolean; nspell?: NspellHandle | null }) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined }) => {
          if (dispatch) {
            tr.setMeta(spellCheckPluginKey, opts);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
