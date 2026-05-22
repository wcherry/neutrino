'use client';

/**
 * TipTap custom node extension for live sheet embeds.
 *
 * The node stores: spreadsheetId, sheetId, namedRangeId, cachedData (JSON
 * string), cachedAt (ISO timestamp), title.  cachedData is stored as a JSON
 * string attribute because TipTap attributes must be primitive scalars.
 *
 * The React node view renders a <SheetEmbedRenderer> which handles loading,
 * error, and deleted-source states.
 */

import React, { useCallback } from 'react';
import { Node, mergeAttributes } from '@tiptap/react';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { SheetEmbedRenderer } from '@neutrino/sheet-embed';
import type { CellValue } from '@neutrino/sheet-embed';

// ---------------------------------------------------------------------------
// Node view component
// ---------------------------------------------------------------------------

function SheetEmbedNodeView({
  node,
  updateAttributes,
  deleteNode,
}: ReactNodeViewProps) {
  const rawAttrs = node.attrs as Record<string, string | null>;
  const { spreadsheetId, sheetId, namedRangeId, cachedData, cachedAt, title } = rawAttrs;

  const parsedCachedData: CellValue[][] | null = (() => {
    try {
      return cachedData ? (JSON.parse(cachedData) as CellValue[][]) : null;
    } catch {
      return null;
    }
  })();

  const embedAttrs = {
    spreadsheetId: spreadsheetId ?? '',
    sheetId: sheetId ?? '',
    namedRangeId: namedRangeId ?? '',
    cachedData: parsedCachedData,
    cachedAt: cachedAt ?? null,
    title: title ?? null,
  };

  const handleCacheUpdate = useCallback(
    (rows: CellValue[][], fetchedAt: string) => {
      updateAttributes({
        cachedData: JSON.stringify(rows),
        cachedAt: fetchedAt,
      });
    },
    [updateAttributes],
  );

  const handleConvertToStatic = useCallback(
    (data: CellValue[][]) => {
      // Build an HTML table from the cached data and insert it as a TipTap
      // table node, then remove this embed node.
      const rows = data
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${cell !== null && cell !== undefined ? String(cell) : ''}</td>`).join('')}</tr>`,
        )
        .join('');
      const html = `<table><tbody>${rows}</tbody></table>`;
      // We use a custom event to signal the DocEditor to insert the HTML
      // at the node's position and then delete this node.
      const event = new CustomEvent('sheet-embed-convert', {
        detail: { html },
        bubbles: true,
      });
      document.dispatchEvent(event);
      deleteNode();
    },
    [deleteNode],
  );

  return (
    <NodeViewWrapper data-type="sheet-embed">
      <SheetEmbedRenderer
        attrs={embedAttrs}
        onCacheUpdate={handleCacheUpdate}
        onConvertToStatic={handleConvertToStatic}
        onRemove={deleteNode}
      />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// TipTap extension
// ---------------------------------------------------------------------------

export const SheetEmbedExtension = Node.create({
  name: 'sheetEmbed',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      spreadsheetId: { default: null },
      sheetId: { default: null },
      namedRangeId: { default: null },
      cachedData: { default: null },
      cachedAt: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sheet-embed"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes as Record<string, string>, { 'data-type': 'sheet-embed' }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SheetEmbedNodeView);
  },
});
