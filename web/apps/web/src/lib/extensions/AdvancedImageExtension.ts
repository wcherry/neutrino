/**
 * AdvancedImageExtension — extends TipTap's Image with additional formatting attrs.
 *
 * Additional attributes beyond src/alt/title:
 *   width      — CSS dimension string (e.g. "300px", "50%", "auto")
 *   alignment  — "none" | "left" | "center" | "right" | "float-left" | "float-right"
 *   caption    — plain text caption shown below the image in the editor
 *
 * Alignment is stored as a data attribute and targeted by CSS in page.module.css.
 * Caption is stored as a data attribute; it is surfaced in the ImagePropertiesModal
 * but not rendered as a separate visible element in the editor view (rendering a
 * true caption below an inline image would require a custom React node view —
 * a TODO for a future iteration).
 *
 * TODO: Implement a React NodeViewRenderer that renders the image inside a
 *       <figure> element with a visible <figcaption> below it.
 */

import Image from '@tiptap/extension-image';

export const AdvancedImage = Image.extend({
  addAttributes() {
    return {
      // Inherit src, alt, title from parent Image extension
      ...this.parent?.(),

      width: {
        default: null as string | null,
        parseHTML: (el: HTMLImageElement) =>
          el.style.width || el.getAttribute('width') || null,
        renderHTML: (attrs: Record<string, unknown>) => {
          if (!attrs.width) return {};
          return { style: `width: ${attrs.width}`, width: attrs.width as string };
        },
      },

      alignment: {
        default: 'none' as string,
        parseHTML: (el: HTMLElement) => el.dataset.alignment || 'none',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.alignment && attrs.alignment !== 'none'
            ? { 'data-alignment': attrs.alignment as string }
            : {},
      },

      caption: {
        default: '' as string,
        parseHTML: (el: HTMLElement) => el.dataset.caption || '',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.caption ? { 'data-caption': attrs.caption as string } : {},
      },
    };
  },
});
