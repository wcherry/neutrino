// ---------------------------------------------------------------------------
// Core types for the sheet live-embed feature.
// ---------------------------------------------------------------------------

export type CellValue = string | number | boolean | null;

/** The status of a live embed block. */
export type EmbedStatus =
  | 'idle'        // Not yet loaded
  | 'loading'     // Fetch in progress
  | 'ok'          // Data loaded successfully
  | 'stale'       // Showing cached data; live fetch failed or not yet triggered
  | 'error'       // Transient fetch error
  | 'deleted';    // Source sheet or spreadsheet has been deleted

/**
 * Attributes stored in the document node (TipTap) or slide element for a
 * live sheet embed.
 *
 * `cachedData` and `cachedAt` are persisted in the document so that when the
 * source sheet is deleted, the user can still convert the embed to a static
 * table using the last-known data.
 */
export interface SheetEmbedAttrsShape {
  /** The spreadsheet (file) ID. */
  spreadsheetId: string;
  /** The sheet (tab) ID within the spreadsheet. */
  sheetId: string;
  /** The stable named-range GUID returned by the sheets backend. */
  namedRangeId: string;
  /** Last-known cell data — 2-D array of display values. May be null before
   *  the first successful fetch. */
  cachedData: CellValue[][] | null;
  /** ISO 8601 timestamp of the last successful fetch, or null. */
  cachedAt: string | null;
  /** Optional display title shown in the embed header. */
  title: string | null;
}

/**
 * Runtime validator / parser for SheetEmbedAttrsShape.
 * Returns the parsed value (pass-through validation) or throws if required
 * fields are missing.
 */
export const SheetEmbedAttrs = {
  parse(raw: unknown): SheetEmbedAttrsShape {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('SheetEmbedAttrs: expected object');
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.spreadsheetId !== 'string') {
      throw new Error('SheetEmbedAttrs: spreadsheetId must be a string');
    }
    if (typeof obj.sheetId !== 'string') {
      throw new Error('SheetEmbedAttrs: sheetId must be a string');
    }
    if (typeof obj.namedRangeId !== 'string') {
      throw new Error('SheetEmbedAttrs: namedRangeId must be a string');
    }
    // cachedData is either null or a 2-D array of CellValue
    if (obj.cachedData !== null && obj.cachedData !== undefined) {
      if (!Array.isArray(obj.cachedData)) {
        throw new Error('SheetEmbedAttrs: cachedData must be an array or null');
      }
    }
    if (obj.cachedAt !== null && obj.cachedAt !== undefined) {
      if (typeof obj.cachedAt !== 'string') {
        throw new Error('SheetEmbedAttrs: cachedAt must be a string or null');
      }
    }
    return {
      spreadsheetId: obj.spreadsheetId,
      sheetId: obj.sheetId,
      namedRangeId: obj.namedRangeId,
      cachedData: (obj.cachedData as CellValue[][] | null) ?? null,
      cachedAt: (obj.cachedAt as string | null) ?? null,
      title: typeof obj.title === 'string' ? obj.title : null,
    };
  },
};

/** The custom MIME type written to the clipboard when the user copies a
 *  sheet selection from the Sheets editor. */
export const NEUTRINO_SHEET_SELECTION_MIME = 'application/x-neutrino-sheet-selection';

export interface SheetSelectionPayload {
  /** The parent spreadsheet (file) ID. */
  spreadsheetId: string;
  /** The sheet (tab) ID within the spreadsheet. */
  sheetId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** Preview data for the "Paste as table" option — a slice of display values. */
  previewData: CellValue[][];
}

/** Serialise a sheet selection into a clipboard payload string. */
export function buildSheetSelectionPayload(
  spreadsheetId: string,
  sheetId: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  previewData: CellValue[][],
): string {
  const payload: SheetSelectionPayload = {
    spreadsheetId,
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
    previewData,
  };
  return JSON.stringify(payload);
}

/** Parse a clipboard payload string back into a SheetSelectionPayload.
 *  Returns null if the payload is invalid. */
export function parseSheetSelectionPayload(raw: string): SheetSelectionPayload | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof obj.spreadsheetId !== 'string' ||
      typeof obj.sheetId !== 'string' ||
      typeof obj.startRow !== 'number' ||
      typeof obj.startCol !== 'number' ||
      typeof obj.endRow !== 'number' ||
      typeof obj.endCol !== 'number'
    ) {
      return null;
    }
    return {
      spreadsheetId: obj.spreadsheetId,
      sheetId: obj.sheetId,
      startRow: obj.startRow,
      startCol: obj.startCol,
      endRow: obj.endRow,
      endCol: obj.endCol,
      previewData: Array.isArray(obj.previewData)
        ? (obj.previewData as CellValue[][])
        : [],
    };
  } catch {
    return null;
  }
}
