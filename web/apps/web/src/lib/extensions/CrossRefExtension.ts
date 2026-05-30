/**
 * CrossRefExtension — custom Tiptap mark for cross-references.
 *
 * Wraps selected text with a cross-reference link pointing at a heading in the
 * same document.  The target heading is stored as the `headingText` attribute
 * so the reference stays stable even if the heading ID changes.
 *
 * Clicking the rendered anchor scrolls to the matching heading via
 * document.querySelector('[data-heading-text="..."]').  Heading elements must
 * have this attribute, which is added by the `HeadingAnchorExtension` or a
 * simple CSS/JS approach (see DocEditor click handler).
 *
 * TODO: Replace heading-text lookup with a proper anchor-ID scheme that
 *       survives heading renames.
 */

import { Mark, mergeAttributes } from '@tiptap/react';

export const CrossRefExtension = Mark.create({
  name: 'crossRef',

  addAttributes() {
    return {
      headingText: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-cross-ref'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.headingText ? { 'data-cross-ref': attrs.headingText } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-cross-ref]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes as Record<string, string>, {
        class: 'cross-ref',
        href: '#',
      }),
      0,
    ];
  },
});
