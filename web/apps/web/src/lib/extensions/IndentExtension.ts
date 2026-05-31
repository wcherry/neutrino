/**
 * IndentExtension — adds indent / outdent commands to paragraphs and headings.
 *
 * Each indent level adds 24 px of left margin.  Maximum depth is 8 levels.
 *
 * Tab key in a paragraph → indent
 * Shift+Tab in a paragraph → outdent
 *
 * When the cursor is inside a list, Tab / Shift+Tab delegate to TipTap's
 * built-in sinkListItem / liftListItem commands instead.
 *
 * The indent attribute is stored on the node itself (renderHTML produces an
 * inline style) so it round-trips through HTML serialisation correctly.
 */

import { Extension } from '@tiptap/react';

const MAX_INDENT = 8;
const PX_PER_LEVEL = 24;

/**
 * Shared helper that adjusts the indent level on all paragraph/heading nodes
 * in the current selection.
 *
 * Returns `true` if at least one node was changed.
 */
function adjustIndent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { tr, state, dispatch }: { tr: any; state: any; dispatch?: (t: any) => void },
  delta: number,
): boolean {
  const { from, to } = state.selection;
  let changed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
    const current: number = (node.attrs.indent as number) || 0;
    const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
    if (next === current) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
    changed = true;
  });

  if (changed && dispatch) dispatch(tr);
  return changed;
}

export const IndentExtension = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const ml = el.style.marginLeft;
              if (!ml) return 0;
              const px = parseInt(ml, 10);
              return isNaN(px) ? 0 : Math.round(px / PX_PER_LEVEL);
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const level = (attrs.indent as number) || 0;
              return level > 0 ? { style: `margin-left: ${level * PX_PER_LEVEL}px` } : {};
            },
          },
        },
      },
    ];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): Record<string, (...args: any[]) => any> {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      indent: () => (context: any) => adjustIndent(context, +1),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      outdent: () => (context: any) => adjustIndent(context, -1),
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (
          this.editor.isActive('bulletList') ||
          this.editor.isActive('orderedList')
        ) {
          return this.editor.commands.sinkListItem('listItem');
        }
        // @ts-expect-error — indent command registered by this extension
        return this.editor.commands.indent();
      },
      'Shift-Tab': () => {
        if (
          this.editor.isActive('bulletList') ||
          this.editor.isActive('orderedList')
        ) {
          return this.editor.commands.liftListItem('listItem');
        }
        // @ts-expect-error — outdent command registered by this extension
        return this.editor.commands.outdent();
      },
    };
  },
});
