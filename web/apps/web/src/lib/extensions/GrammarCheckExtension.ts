import { Extension } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { applyGrammarRules, type GrammarIssue } from '@/hooks/useGrammarCheck';
import { buildAll, forEachText, updateForTransaction } from './incrementalDecorations';

// ── Plugin key (exported for context-menu read access) ─────────────────────────

export const grammarCheckPluginKey = new PluginKey<GrammarPluginState>('grammarCheck');

// ── Types ──────────────────────────────────────────────────────────────────────

interface GrammarPluginState {
  enabled: boolean;
  decorations: DecorationSet;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** The grammar issues in one textblock, checked a text node at a time as before. */
function blockDecorations(block: PmNode, pos: number): Decoration[] {
  const out: Decoration[] = [];
  forEachText(block, pos, (text, at) => {
    for (const issue of applyGrammarRules(text)) {
      out.push(
        Decoration.inline(at + issue.offset, at + issue.offset + issue.length, {
          class: 'grammar-issue',
          title: issue.message,
          'data-suggestion': issue.suggestion ?? '',
        }),
      );
    }
  });
  return out;
}

function buildDecorations(doc: PmNode): DecorationSet {
  return buildAll(doc, blockDecorations);
}

// ── Command type augmentation ─────────────────────────────────────────────────

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    grammarCheck: {
      setGrammarEnabled: (enabled: boolean) => ReturnType;
    };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────────

export const GrammarCheckExtension = Extension.create({
  name: 'grammarCheck',

  addProseMirrorPlugins() {
    return [
      new Plugin<GrammarPluginState>({
        key: grammarCheckPluginKey,

        state: {
          // Nothing is checked while grammar checking is off — it used to rebuild the whole
          // document's issues on every keystroke whether or not they would be shown.
          init(): GrammarPluginState {
            return { enabled: false, decorations: DecorationSet.empty };
          },

          apply(tr: Transaction, old: GrammarPluginState, _oldState: EditorState, newState: EditorState): GrammarPluginState {
            const meta = tr.getMeta(grammarCheckPluginKey) as { enabled?: boolean } | undefined;
            const enabled = meta?.enabled !== undefined ? meta.enabled : old.enabled;
            if (meta?.enabled !== undefined) {
              return { enabled, decorations: enabled ? buildDecorations(newState.doc) : DecorationSet.empty };
            }
            if (!enabled || !tr.docChanged) return enabled ? old : { enabled, decorations: DecorationSet.empty };
            return { enabled, decorations: updateForTransaction(old.decorations, tr, blockDecorations) };
          },
        },

        props: {
          decorations(state: EditorState) {
            const ps = grammarCheckPluginKey.getState(state);
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
      setGrammarEnabled:
        (enabled: boolean) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch: ((tr: Transaction) => void) | undefined }) => {
          if (dispatch) {
            tr.setMeta(grammarCheckPluginKey, { enabled });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

// ── Utility: get grammar issues at a document position ─────────────────────────

export function getGrammarIssueAt(
  doc: PmNode,
  pos: number,
): (GrammarIssue & { from: number; to: number }) | null {
  let found: (GrammarIssue & { from: number; to: number }) | null = null;

  doc.descendants((node, nodePos) => {
    if (found || !node.isText || !node.text) return;
    const end = nodePos + node.text.length;
    if (pos < nodePos || pos > end) return;

    const localOffset = pos - nodePos;
    const issues = applyGrammarRules(node.text);
    for (const issue of issues) {
      if (localOffset >= issue.offset && localOffset <= issue.offset + issue.length) {
        found = {
          ...issue,
          from: nodePos + issue.offset,
          to: nodePos + issue.offset + issue.length,
        };
        return false; // stop traversal
      }
    }
  });

  return found;
}
