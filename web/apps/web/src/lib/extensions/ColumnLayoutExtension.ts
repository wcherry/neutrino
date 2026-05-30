/**
 * ColumnLayoutExtension — custom Tiptap block node for multi-column layouts.
 *
 * Wraps child block content in a CSS multi-column container.  Supports 2 or 3
 * columns via the `columns` attribute.
 *
 * NOTE: CSS `column-count` does not break at explicit positions — content flows
 * naturally across columns.  For precise column control (e.g. independent
 * column editing) a more complex sub-document architecture would be needed.
 *
 * TODO: Add explicit column break support via a `columnBreak` inline node.
 */

import { Node, mergeAttributes } from '@tiptap/react';

export const ColumnLayoutExtension = Node.create({
  name: 'columnLayout',

  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      columns: {
        default: 2,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-columns')) || 2,
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-columns': attrs.columns,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="column-layout"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes as Record<string, string>, {
        'data-type': 'column-layout',
        class: 'column-layout',
      }),
      0,
    ];
  },
});
