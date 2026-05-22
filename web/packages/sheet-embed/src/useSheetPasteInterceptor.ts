'use client';

import { useCallback, useState } from 'react';
import { sheetsApi } from '@neutrino/api-sheets';
import {
  NEUTRINO_SHEET_SELECTION_MIME,
  parseSheetSelectionPayload,
} from './types';
import type { SheetEmbedAttrsShape, CellValue, SheetSelectionPayload } from './types';

export interface UseSheetPasteInterceptorOptions {
  /** Called with the resolved embed attrs when a valid sheet selection is
   *  detected in the clipboard and the user chooses "Paste as live view". The
   *  caller is responsible for inserting the node into the document. */
  onEmbed: (attrs: SheetEmbedAttrsShape) => void;
  /** Called with preview data and callbacks when the user chooses "Paste as
   *  table". The caller is responsible for inserting a static HTML table. */
  onPasteAsTable?: (previewData: CellValue[][], html: string) => void;
}

export interface PasteDialogState {
  previewData: CellValue[][];
  onPasteAsTable: () => void;
  onPasteAsEmbed: () => void;
  onClose: () => void;
}

/**
 * Returns a paste-event handler that detects the custom
 * `application/x-neutrino-sheet-selection` MIME type in the clipboard and,
 * when found, exposes a dialog state so the caller can render
 * `<PasteChoiceDialog>` with two options:
 *   - "Paste as table"    — build an HTML table from the preview data
 *   - "Paste as live view" — call `createNamedRange` and invoke `onEmbed`
 *
 * The handler returns `true` when it consumed the event (caller should call
 * `preventDefault`), `false` when the event should fall through to default
 * paste handling.
 */
export function useSheetPasteInterceptor(
  options: UseSheetPasteInterceptorOptions,
) {
  const { onEmbed, onPasteAsTable } = options;

  const [dialogState, setDialogState] = useState<PasteDialogState | null>(null);

  const handlePaste = useCallback(
    async (e: ClipboardEvent): Promise<boolean> => {
      const data = e.clipboardData;
      if (!data) return false;

      const raw = data.getData(NEUTRINO_SHEET_SELECTION_MIME);
      if (!raw) return false;

      const selection = parseSheetSelectionPayload(raw);
      if (!selection) return false;

      // Build a static HTML table from the preview data for the "Paste as
      // table" option. This is synchronous and doesn't require an API call.
      const staticHtml = buildStaticTable(selection.previewData);

      const handlePasteAsTable = () => {
        setDialogState(null);
        if (onPasteAsTable) {
          onPasteAsTable(selection.previewData, staticHtml);
        }
      };

      const handlePasteAsEmbed = async () => {
        setDialogState(null);
        try {
          const range = await sheetsApi.createNamedRange(selection.spreadsheetId, {
            sheetDbId: selection.spreadsheetId,
            sheetId: selection.sheetId,
            startRow: selection.startRow,
            startCol: selection.startCol,
            endRow: selection.endRow,
            endCol: selection.endCol,
          });

          // Use the previewData from the clipboard as the initial cachedData so
          // the embed renders immediately without a loading state.
          let cachedData: CellValue[][] | null = selection.previewData.length > 0
            ? selection.previewData
            : null;
          let cachedAt: string | null = null;

          // Attempt a live fetch to get fresher data and a server-generated timestamp.
          try {
            const embedData = await sheetsApi.getSheetEmbed(
              selection.spreadsheetId,
              range.id,
            );
            cachedData = embedData.rows as CellValue[][];
            cachedAt = embedData.fetchedAt;
          } catch {
            // Non-fatal — the embed will fetch on mount.
          }

          onEmbed({
            spreadsheetId: selection.spreadsheetId,
            sheetId: selection.sheetId,
            namedRangeId: range.id,
            cachedData,
            cachedAt,
            title: null,
          });
        } catch {
          // Silently fail — the paste is consumed but no embed is inserted.
        }
      };

      setDialogState({
        previewData: selection.previewData,
        onPasteAsTable: handlePasteAsTable,
        onPasteAsEmbed: handlePasteAsEmbed,
        onClose: () => setDialogState(null),
      });

      return true;
    },
    [onEmbed, onPasteAsTable],
  );

  return { handlePaste, dialogState };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildStaticTable(rows: CellValue[][]): string {
  if (rows.length === 0) return '';
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${cell !== null && cell !== undefined ? String(cell) : ''}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table><tbody>${bodyRows}</tbody></table>`;
}
