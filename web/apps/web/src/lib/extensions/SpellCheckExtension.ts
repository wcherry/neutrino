import { Extension } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { NspellHandle } from '@/hooks/useNspell';

// ── Plugin key (exported for external access) ──────────────────────────────────

export const spellCheckPluginKey = new PluginKey<SpellPluginState>('spellCheck');

// ── Types ──────────────────────────────────────────────────────────────────────

interface SpellPluginState {
  enabled: boolean;
  nspell: NspellHandle | null;
  decorations: DecorationSet;
}

interface SpellCheckMeta {
  enabled?: boolean;
  nspell?: NspellHandle | null;
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

function buildDecorations(doc: PmNode, nspell: NspellHandle | null): DecorationSet {
  if (!nspell) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    // Skip text inside code blocks/inline code where spell-checking is noise.
    if (parent?.type.name === 'codeBlock' || parent?.type.name === 'code') return;

    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(node.text)) !== null) {
      if (!isCorrect(nspell, m[0])) {
        decorations.push(
          Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
            class: 'spell-error',
          }),
        );
      }
    }
  });

  return DecorationSet.create(doc, decorations);
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
          init(_config: unknown, _state: EditorState): SpellPluginState {
            return { enabled: false, nspell: null, decorations: DecorationSet.empty };
          },

          apply(tr: Transaction, old: SpellPluginState, _oldState: EditorState, newState: EditorState): SpellPluginState {
            const meta = tr.getMeta(spellCheckPluginKey) as SpellCheckMeta | undefined;

            const enabled = meta?.enabled !== undefined ? meta.enabled : old.enabled;
            const nspell = meta?.nspell !== undefined ? meta.nspell : old.nspell;

            // Rebuild decorations when the doc changed or state settings changed.
            const shouldRebuild = tr.docChanged || meta !== undefined;
            if (!shouldRebuild) return old;

            const decorations = enabled ? buildDecorations(newState.doc, nspell) : DecorationSet.empty;
            return { enabled, nspell, decorations };
          },
        },

        props: {
          decorations(state: EditorState) {
            const ps = spellCheckPluginKey.getState(state);
            if (!ps?.enabled) return DecorationSet.empty;
            return ps.decorations;
          },
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
