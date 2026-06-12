/**
 * AdvancedImageExtension — extends TipTap's Image with additional formatting attrs.
 *
 * Additional attributes beyond src/alt/title:
 *   width      — CSS dimension string (e.g. "300px", "50%", "auto")
 *   alignment  — "none" | "left" | "center" | "right" | "float-left" | "float-right"
 *   caption    — plain text caption shown below the image in the editor
 *   border     — CSS border shorthand (e.g. "2px solid #333"); stored in data-border
 *   shadow     — preset: "none" | "sm" | "md" | "lg"; stored in data-shadow + inline style
 *   imageFilter— CSS filter string (e.g. "brightness(80%) contrast(110%)"); stored in data-image-filter
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

const SHADOW_VALUES: Record<string, string> = {
  sm: '0 1px 4px rgba(0,0,0,0.22)',
  md: '0 4px 10px rgba(0,0,0,0.28)',
  lg: '0 10px 28px rgba(0,0,0,0.38)',
};

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

      border: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.dataset.border || null,
        renderHTML: (attrs: Record<string, unknown>) => {
          const b = attrs.border as string | null;
          if (!b) return {};
          return { 'data-border': b, style: `border: ${b}` };
        },
      },

      shadow: {
        default: 'none' as string,
        parseHTML: (el: HTMLElement) => el.dataset.shadow || 'none',
        renderHTML: (attrs: Record<string, unknown>) => {
          const s = attrs.shadow as string;
          if (!s || s === 'none') return {};
          const boxShadow = SHADOW_VALUES[s];
          return boxShadow
            ? { 'data-shadow': s, style: `box-shadow: ${boxShadow}` }
            : {};
        },
      },

      imageFilter: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.dataset.imageFilter || null,
        renderHTML: (attrs: Record<string, unknown>) => {
          const f = attrs.imageFilter as string | null;
          if (!f) return {};
          return { 'data-image-filter': f, style: `filter: ${f}` };
        },
      },
    };
  },
});
