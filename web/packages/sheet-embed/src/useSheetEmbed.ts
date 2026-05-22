'use client';

import { useState, useCallback, useRef } from 'react';
import { sheetsApi } from '@neutrino/api-sheets';
import type { CellValue, EmbedStatus, SheetEmbedAttrsShape } from './types';

export interface UseSheetEmbedResult {
  status: EmbedStatus;
  rows: CellValue[][] | null;
  fetchedAt: string | null;
  /** Re-fetch from the backend. Caller should update cachedData/cachedAt in
   *  the document node after a successful refresh. */
  refresh: () => Promise<{ rows: CellValue[][]; fetchedAt: string } | null>;
}

/**
 * Hook that fetches live cell data for a named range embed.
 *
 * Initialises from `attrs.cachedData` so the embed renders immediately from
 * the document's cached copy, then optionally triggers a live fetch.
 *
 * When the source sheet has been deleted (backend returns 404), status
 * transitions to 'deleted' and the last-known cachedData is preserved so
 * the user can convert to a static table.
 *
 * When the live fetch fails but cached data is available, status transitions
 * to 'stale' rather than 'error' so the user can still see the last-known data.
 */
export function useSheetEmbed(attrs: SheetEmbedAttrsShape): UseSheetEmbedResult {
  const [status, setStatus] = useState<EmbedStatus>(
    attrs.cachedData ? 'ok' : 'idle',
  );
  const [rows, setRows] = useState<CellValue[][] | null>(attrs.cachedData);
  const [fetchedAt, setFetchedAt] = useState<string | null>(attrs.cachedAt);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setStatus('loading');
    try {
      const result = await sheetsApi.getSheetEmbed(
        attrs.spreadsheetId,
        attrs.namedRangeId,
      );
      const newRows = result.rows as CellValue[][];
      const newFetchedAt = result.fetchedAt;
      setRows(newRows);
      setFetchedAt(newFetchedAt);
      setStatus('ok');
      return { rows: newRows, fetchedAt: newFetchedAt };
    } catch (err: unknown) {
      const httpStatus = (err as { status?: number }).status;
      if (httpStatus === 404) {
        setStatus('deleted');
      } else if (rows !== null) {
        // Transient error but we have cached data — show stale rather than error
        setStatus('stale');
      } else {
        setStatus('error');
      }
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [attrs.spreadsheetId, attrs.namedRangeId, rows]);

  return { status, rows, fetchedAt, refresh };
}
