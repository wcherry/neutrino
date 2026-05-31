/**
 * SectionBreakExtension — custom Tiptap block node.
 *
 * Inserts a visible page/section break marker.  Renders as a dashed horizontal
 * rule with `page-break-after: always` so it acts as a real page break during
 * printing.
 */

import { Node, mergeAttributes } from '@tiptap/react';

export const SectionBreakExtension = Node.create({
  name: 'sectionBreak',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {};
  },

  parseHTML() {
    return [{ tag: 'div[data-type="section-break"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes as Record<string, string>, {
        'data-type': 'section-break',
        class: 'section-break',
      }),
    ];
  },
});
