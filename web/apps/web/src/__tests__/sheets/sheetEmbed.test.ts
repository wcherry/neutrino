/**
 * Unit tests for the sheet-live-embed feature.
 *
 * Covers:
 *   - SheetEmbedAttrs runtime parser
 *   - NEUTRINO_SHEET_SELECTION_MIME constant
 *   - buildSheetSelectionPayload / parseSheetSelectionPayload round-trip
 *   - api-sheets createNamedRange and getSheetEmbed call the right paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @neutrino/api-core so api-sheets doesn't try to make real HTTP calls.
// vi.mock is hoisted to the top of the file by Vitest's transform.
// ---------------------------------------------------------------------------

const mockRequest = vi.fn();

vi.mock('@neutrino/api-core', () => ({
  request: mockRequest,
  // api-core also exports a config helper used at module init
  getConfig: () => ({ baseUrl: 'http://localhost', retry: false }),
}));

// ---------------------------------------------------------------------------
// SheetEmbedAttrs runtime parser
// ---------------------------------------------------------------------------

describe('SheetEmbedAttrs types', () => {
  it('accepts valid attrs shape', async () => {
    const { SheetEmbedAttrs } = await import('@neutrino/sheet-embed');
    const valid = SheetEmbedAttrs.parse({
      spreadsheetId: 'spreadsheet-1',
      sheetId: 'sheet-1',
      namedRangeId: 'range-uuid-1',
      cachedData: [['A', 'B'], ['1', '2']],
      cachedAt: '2026-05-07T00:00:00.000Z',
      title: null,
    });
    expect(valid.spreadsheetId).toBe('spreadsheet-1');
    expect(valid.sheetId).toBe('sheet-1');
    expect(valid.namedRangeId).toBe('range-uuid-1');
    expect(valid.cachedData).toHaveLength(2);
    expect(valid.cachedAt).toBe('2026-05-07T00:00:00.000Z');
  });

  it('accepts attrs with null cachedData and cachedAt', async () => {
    const { SheetEmbedAttrs } = await import('@neutrino/sheet-embed');
    const valid = SheetEmbedAttrs.parse({
      spreadsheetId: 'spreadsheet-1',
      sheetId: 'sheet-1',
      namedRangeId: 'range-uuid-1',
      cachedData: null,
      cachedAt: null,
      title: null,
    });
    expect(valid.cachedData).toBeNull();
    expect(valid.cachedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NEUTRINO_SHEET_SELECTION_MIME constant
// ---------------------------------------------------------------------------

describe('NEUTRINO_SHEET_SELECTION_MIME', () => {
  it('exports the custom MIME type string', async () => {
    const { NEUTRINO_SHEET_SELECTION_MIME } = await import('@neutrino/sheet-embed');
    expect(NEUTRINO_SHEET_SELECTION_MIME).toBe('application/x-neutrino-sheet-selection');
  });
});

// ---------------------------------------------------------------------------
// buildSheetSelectionPayload
// ---------------------------------------------------------------------------

describe('buildSheetSelectionPayload', () => {
  it('serialises spreadsheetId, sheetId and range into the clipboard payload', async () => {
    const { buildSheetSelectionPayload } = await import('@neutrino/sheet-embed');
    const preview: import('@neutrino/sheet-embed').CellValue[][] = [['A', 'B'], ['1', '2']];
    const payload = buildSheetSelectionPayload('spreadsheet-xyz', 'sheet-abc', 0, 1, 2, 4, preview);
    const parsed = JSON.parse(payload);
    expect(parsed.spreadsheetId).toBe('spreadsheet-xyz');
    expect(parsed.sheetId).toBe('sheet-abc');
    expect(parsed.startRow).toBe(0);
    expect(parsed.startCol).toBe(1);
    expect(parsed.endRow).toBe(2);
    expect(parsed.endCol).toBe(4);
    expect(parsed.previewData).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseSheetSelectionPayload
// ---------------------------------------------------------------------------

describe('parseSheetSelectionPayload', () => {
  it('parses a valid payload back into the selection object', async () => {
    const { buildSheetSelectionPayload, parseSheetSelectionPayload } = await import('@neutrino/sheet-embed');
    const preview: import('@neutrino/sheet-embed').CellValue[][] = [['X']];
    const raw = buildSheetSelectionPayload('spreadsheet-abc', 'sheet-xyz', 1, 2, 5, 6, preview);
    const result = parseSheetSelectionPayload(raw);
    expect(result).not.toBeNull();
    expect(result!.spreadsheetId).toBe('spreadsheet-abc');
    expect(result!.sheetId).toBe('sheet-xyz');
    expect(result!.startRow).toBe(1);
    expect(result!.startCol).toBe(2);
    expect(result!.endRow).toBe(5);
    expect(result!.endCol).toBe(6);
    expect(result!.previewData).toHaveLength(1);
  });

  it('returns null for non-JSON input', async () => {
    const { parseSheetSelectionPayload } = await import('@neutrino/sheet-embed');
    expect(parseSheetSelectionPayload('not-json')).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    const { parseSheetSelectionPayload } = await import('@neutrino/sheet-embed');
    expect(parseSheetSelectionPayload(JSON.stringify({ sheetId: 'x' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// api-sheets: createNamedRange and getSheetEmbed
// ---------------------------------------------------------------------------

describe('sheetsApi named range endpoints', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('createNamedRange POSTs to /api/v1/sheets/:id/named-ranges', async () => {
    mockRequest.mockResolvedValue({
      id: 'nr-1',
      sheetId: 's-1',
      sheetDbId: 'db-1',
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 3,
      createdAt: '',
      updatedAt: '',
    });
    const { sheetsApi } = await import('@neutrino/api-sheets');
    await sheetsApi.createNamedRange('s-1', {
      sheetDbId: 'db-1',
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 3,
    });
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/sheets/s-1/named-ranges',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getSheetEmbed GETs /api/v1/sheets/:id/embed/:namedRangeId', async () => {
    mockRequest.mockResolvedValue({ rows: [], fetchedAt: '' });
    const { sheetsApi } = await import('@neutrino/api-sheets');
    await sheetsApi.getSheetEmbed('s-1', 'nr-abc');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/sheets/s-1/embed/nr-abc',
      undefined,
    );
  });
});
