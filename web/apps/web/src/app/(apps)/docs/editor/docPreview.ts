/**
 * What Docs gives `useDocumentPreview`: page one's signature, and its picture.
 *
 * Page one is the top-level blocks whose top edge is above the first page
 * boundary — read off the laid-out DOM, since only the pagination plugin knows
 * where a page ends — and the signature is those blocks' JSON plus everything
 * else drawn on the sheet (page setup, header and footer, watermark, theme).
 * It is the model, not the DOM, so a spell-check squiggle or a comment
 * highlight appearing does not count as the page changing.
 */
import type { Editor } from '@tiptap/react';
import { renderElementPreview } from '@/lib/documentPreview';

export function docFirstPageSignature(
  editor: Editor,
  page: HTMLElement,
  pageHeightPx: number,
  zoom: number,
  decoration: unknown,
): string {
  const pageTop = page.getBoundingClientRect().top;
  const blocks: unknown[] = [];
  let past = false;
  editor.state.doc.forEach((node, offset) => {
    if (past) return;
    const dom = editor.view.nodeDOM(offset);
    if (dom instanceof HTMLElement && blocks.length > 0) {
      const top = (dom.getBoundingClientRect().top - pageTop) / zoom;
      if (top >= pageHeightPx) {
        past = true;
        return;
      }
    }
    blocks.push(node.toJSON());
  });
  return JSON.stringify([decoration, blocks]);
}

/** Page one of the sheet stack, at 100% and without the grey gaps between pages. */
export function renderDocFirstPage(
  page: HTMLElement,
  widthPx: number,
  heightPx: number,
): Promise<Blob | null> {
  return renderElementPreview(page, {
    width: widthPx,
    height: heightPx,
    style: { transform: 'none', backgroundImage: 'none' },
  });
}
