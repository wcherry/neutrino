/**
 * A spreadsheet stored as `.xlsx` loses nothing across a save (issues #127,
 * #169).
 *
 * This used to be a test about the `neutrino/model.json` part: what the editor
 * could write was a value per cell, so the package carried a second, complete
 * copy of the model and the load path preferred it. `ooxml/xlsx/` writes the
 * spreadsheet as real SpreadsheetML now, so there is no second copy — and this
 * is what says the seam still holds without one.
 *
 * These drive `usePersistence` end to end over a real zip, because the thing
 * that can break is exactly that seam: something written and then not read back
 * is indistinguishable, from inside either half, from working correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEK = new Uint8Array(32).fill(6);

const getSheet = vi.fn();
const getFileMetadata = vi.fn();
const downloadFile = vi.fn();
// The office-mode read goes through `driveReadBytes`, which reads a file whose
// body was never written as zero bytes rather than letting its 409 throw.
const readBytes = vi.fn();
const driveAutosaveEncryptedBytes = vi.fn();

vi.mock('@/lib/api', () => ({
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  sheetsApi: { getSheet: (...a: unknown[]) => getSheet(...a), saveSheet: vi.fn() },
  driveReadContent: vi.fn(),
  driveReadBytes: (...a: unknown[]) => readBytes(...a),
  driveCreateEncryptedVersion: vi.fn(),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve({ contentVersion: 2 })),
  driveAutosaveEncryptedBytes: (...a: unknown[]) => driveAutosaveEncryptedBytes(...a),
  driveCreateEncryptedVersionBytes: vi.fn(),
  extractSheetText: () => '',
  storageApi: {
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    downloadFile: (...a: unknown[]) => downloadFile(...a),
  },
  filesystemApi: { updateFile: vi.fn() },
}));

// The bytes on the wire are plaintext here — real zips, which is how the load
// path knows they have not been encrypted yet — so decryption is a pass-through.
vi.mock('@neutrino/e2e-crypto', () => ({ decryptFile: (b: Uint8Array) => b }));
vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));
vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: vi.fn() }));
vi.mock('@/hooks/useContentVersionGuard', () => ({
  useContentVersionGuard: () => ({
    observe: vi.fn(), check: () => undefined, handleError: () => false,
  }),
}));
vi.mock('@neutrino/ui', () => ({
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: DEK },
    dekResolved: true,
    awaitDek: async () => DEK,
  }),
}));

import JSZip from 'jszip';
import { usePersistence } from '../../app/(apps)/sheets/editor/hooks/usePersistence';
import { packNeutrinoModel } from '@/lib/ooxmlContainer';
import { writeXlsx } from '@/lib/ooxml/xlsx/write';
import { NEUTRINO_MODEL_PART } from '@/lib/ooxmlContainer';
import { ApiClientError } from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A spreadsheet carrying the things a value-per-cell workbook could not: a tab
 * colour, a column width, a row height and a conditional format. Every one of
 * them is real SpreadsheetML now, and every one used to need the model part.
 */
const MODEL = {
  sheets: [{
    name: 'Q1',
    color: '#ff0000',
    cells: { A1: { id: 'A1', raw: '7', value: '7', cellStyle: { backgroundColor: '#00ff00' } } },
    colWidths: { '1': 240 },
    rowHeights: { '1': 44 },
    conditionalFormats: [{
      id: 'cf-0-0',
      range: 'A1:A9',
      rule: { kind: 'singleColor', condition: 'greaterThan', value: '5', format: { color: '#111111' } },
    }],
  }],
};

async function emptyWorkbookZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://x"/>');
  zip.file('xl/workbook.xml', '<workbook/>');
  return zip.generateAsync({ type: 'uint8array' });
}

/** A workbook from another tool, with a tab name nothing here would invent. */
function foreignWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['from', 'excel']]), 'FromWorkbook');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}

/**
 * `SheetEditor` keeps its per-sheet refs in step with the state the setters
 * write, and `serialize()` reads the refs — so a harness whose setters only
 * record calls would serialise the *initial* refs on save and make a
 * round-trip test pass or fail for reasons that have nothing to do with the
 * format. These setters therefore write through, as the editor does.
 */
function setupHook() {
  const props = {
    sheetId: 'file-1',
    dirtyRef: { current: false },
    sheetsDataRef: { current: [new Map()] },
    sheetsColWidthsRef: { current: [new Map()] },
    sheetsRowHeightsRef: { current: [new Map()] },
    activeSheetIndexRef: { current: 0 },
    sheetNamesRef: { current: ['Sheet1'] },
    sheetColorsRef: { current: [null] },
    flushActiveSheet: vi.fn(),
    setData: vi.fn(),
    setColWidths: vi.fn(),
    setRowHeights: vi.fn(),
    setSheetNames: vi.fn(),
    setSheetColors: vi.fn(),
    sheetsConditionalFormatsRef: { current: [[]] as unknown[][] },
    flushActiveConditionalFormats: vi.fn(),
    setConditionalFormats: vi.fn(),
  };
  const setSheetNames = vi.fn((names: string[]) => { props.sheetNamesRef.current = names; });
  const setSheetColors = vi.fn((colors: (string | null)[]) => { props.sheetColorsRef.current = colors; });
  const setColWidths = vi.fn();
  const setData = vi.fn();
  const setConditionalFormats = vi.fn();
  Object.assign(props, { setSheetNames, setSheetColors, setColWidths, setData, setConditionalFormats });

  const hook = renderHook(() => usePersistence(props as never));
  return { hook, props, setSheetNames, setData, setColWidths, setSheetColors, setConditionalFormats };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSheet.mockRejectedValue(new ApiClientError(404, 'not_found', 'not bespoke JSON'));
  getFileMetadata.mockResolvedValue({ id: 'file-1', name: 'Budget.xlsx', mimeType: XLSX_MIME });
});

async function storedBytes(bytes: Uint8Array) {
  readBytes.mockResolvedValue(bytes);
  downloadFile.mockResolvedValue(new Blob([bytes.buffer as ArrayBuffer]));
}

/** Load a stored package through the hook and hand back the harness. */
async function open(bytes: Uint8Array) {
  await storedBytes(bytes);
  const harness = setupHook();
  await act(async () => { await harness.hook.result.current.load(); });
  await waitFor(() => expect(harness.hook.result.current.officeMode).toBe(true));
  return harness;
}

// ---------------------------------------------------------------------------

describe('opening an .xlsx Neutrino wrote', () => {
  it('brings back everything a value-per-cell workbook could not carry', async () => {
    const { setSheetNames, setColWidths, setSheetColors, setConditionalFormats } =
      await open(await writeXlsx(MODEL as never));

    expect(setSheetNames).toHaveBeenCalledWith(['Q1']);
    expect(setColWidths).toHaveBeenCalledWith(new Map([[1, 240]]));
    expect(setSheetColors).toHaveBeenCalledWith(['#ff0000']);
    expect(setConditionalFormats).toHaveBeenCalledWith([
      expect.objectContaining({ range: 'A1:A9' }),
    ]);
  });
});

describe('opening an .xlsx from somewhere else', () => {
  it('reads the workbook itself', async () => {
    const { setSheetNames } = await open(foreignWorkbook());
    expect(setSheetNames).toHaveBeenCalledWith(['FromWorkbook']);
  });
});

/**
 * A spreadsheet saved before the OOXML writer was complete carries the model in
 * a `neutrino/model.json` part beside a workbook that was only a projection of
 * it. Reading that workbook would lose everything the projection dropped, so
 * the part still wins where it exists — and its first save here migrates it.
 */
describe('opening an .xlsx saved before the writer was complete', () => {
  it('prefers the model part over the workbook beside it', async () => {
    const legacy = await packNeutrinoModel(
      foreignWorkbook(), 'sheets', JSON.stringify(MODEL),
    );
    const { setSheetNames } = await open(legacy);

    // 'FromWorkbook' is what the workbook says; 'Q1' is what the model says.
    expect(setSheetNames).toHaveBeenCalledWith(['Q1']);
  });
});

describe('saving', () => {
  it('writes a workbook and no second copy of the model', async () => {
    const { hook } = await open(await writeXlsx(MODEL as never));

    await act(async () => { await hook.result.current.save(); });

    const written = driveAutosaveEncryptedBytes.mock.calls.at(-1)![1] as Uint8Array;
    const zip = await JSZip.loadAsync(written);
    expect(zip.file('xl/workbook.xml')).not.toBeNull();
    expect(zip.file('xl/worksheets/sheet1.xml')).not.toBeNull();
    // The whole point of the rewrite: the spreadsheet is the OOXML.
    expect(zip.file(NEUTRINO_MODEL_PART)).toBeNull();
  });

  it('what it writes is what it reads back', async () => {
    const { hook } = await open(await writeXlsx(MODEL as never));
    await act(async () => { await hook.result.current.save(); });
    const written = driveAutosaveEncryptedBytes.mock.calls.at(-1)![1] as Uint8Array;

    const second = await open(written);

    expect(second.setSheetNames).toHaveBeenCalledWith(['Q1']);
    expect(second.setColWidths).toHaveBeenCalledWith(new Map([[1, 240]]));
    expect(second.setSheetColors).toHaveBeenCalledWith(['#ff0000']);
  });

  /**
   * A workbook that has been through Excel can carry pivot tables and images
   * this editor has no notion of. Dropping them on every autosave tick would
   * make Neutrino the tool that quietly deletes your pivot table.
   */
  it('carries forward the parts of the stored package it does not model', async () => {
    const base = await writeXlsx(MODEL as never);
    const zip = await JSZip.loadAsync(base);
    zip.file('xl/pivotTables/pivotTable1.xml', '<pivotTableDefinition/>');
    const { hook } = await open(await zip.generateAsync({ type: 'uint8array' }));

    await act(async () => { await hook.result.current.save(); });

    const written = driveAutosaveEncryptedBytes.mock.calls.at(-1)![1] as Uint8Array;
    const out = await JSZip.loadAsync(written);
    expect(await out.file('xl/pivotTables/pivotTable1.xml')!.async('string'))
      .toBe('<pivotTableDefinition/>');
  });
});

describe('a spreadsheet that was just created', () => {
  /**
   * `POST /drive/files` writes no body for an OOXML type — a zip is not
   * something the server can build, and a seed would sit in the clear until the
   * first save anyway. So the editor opens zero bytes as a blank spreadsheet
   * and its first save is what makes the file a real workbook.
   */
  it('opens a zero-byte file as blank and saves a real workbook immediately', async () => {
    await storedBytes(new Uint8Array(0));
    const { hook } = setupHook();

    await act(async () => { await hook.result.current.load(); });
    await waitFor(() => expect(driveAutosaveEncryptedBytes).toHaveBeenCalled());

    const written = driveAutosaveEncryptedBytes.mock.calls.at(-1)![1] as Uint8Array;
    const zip = await JSZip.loadAsync(written);
    expect(zip.file('xl/workbook.xml')).not.toBeNull();
  });

  it('does not mistake an empty package for an empty file', async () => {
    const { hook } = await open(await emptyWorkbookZip());
    expect(hook.result.current.officeMode).toBe(true);
  });
});
