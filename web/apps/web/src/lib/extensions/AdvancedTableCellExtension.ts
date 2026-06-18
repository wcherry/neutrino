/**
 * AdvancedTableCellExtension — extends TipTap's TableCell with per-cell formatting.
 *
 * Additional attributes beyond the built-in colspan/rowspan:
 *   backgroundColor  — CSS color string (background-color)
 *   borderColor      — CSS color string applied to all four borders
 *   borderWidth      — CSS length string (e.g. "2px")
 *
 * These are rendered as inline styles on the <td> element and parse back from
 * the style attribute, so they survive HTML serialisation / HTML import.
 *
 * Usage:
 *   editor.chain().focus().updateAttributes('tableCell', {
 *     backgroundColor: '#fef08a',
 *     borderColor: '#1a73e8',
 *     borderWidth: '2px',
 *   }).run();
 */

import TableCell from '@tiptap/extension-table-cell';

export const AdvancedTableCell = TableCell.extend({
  addAttributes() {
    return {
      // Inherit colspan, rowspan, colwidth from parent TableCell
      ...this.parent?.(),

      backgroundColor: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
      },

      borderColor: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.style.borderColor || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.borderColor ? { style: `border-color: ${attrs.borderColor}` } : {},
      },

      borderWidth: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.style.borderWidth || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.borderWidth ? { style: `border-width: ${attrs.borderWidth}` } : {},
      },
    };
  },
});
