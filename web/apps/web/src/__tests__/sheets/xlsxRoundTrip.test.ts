/**
 * A spreadsheet stored as `.xlsx` loses nothing across a save (issue #127).
 *
 * SheetJS writes values and nothing else — no column widths, no cell fills, no
 * charts, no conditional formats, no sheet colours. So a workbook that stored
 * only what SheetJS can write would delete all of that on the first autosave
 * tick, three seconds after the file was opened. The package therefore carries
 * the editor's own model beside the workbook, and the load path prefers it.
 *
 * These tests drive `usePersistence` end to end over a real zip, because the
 * thing that can break is the seam: a model written and then not read back is
 * indistinguishable, from inside either half, from working correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEK = new Uint8Array(32).fill(6);

const getSheet = vi.fn();
const getFileMetadata = vi.fn();
const downloadFile = vi.fn();
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

// The bytes on the wire are plaintext here: `isNewEncryption` is true, which is
// the hook's signal that the stored bytes have not been encrypted yet.
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
    isNewEncryption: true,
  }),
}));

/**
 * Stand in for SheetJS. `write` hands back a real (if minimal) zip so the
 * container has something to pack into — synchronously, as the real one does —
 * and `read` reports a workbook whose sheet name is deliberately *not* what the
 * model says, which is how a test can tell which of the two the editor read.
 */
vi.mock('xlsx', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://x"/>');
  zip.file('xl/workbook.xml', '<workbook/>');
  const workbookBytes = await zip.generateAsync({ type: 'arraybuffer' });
  return {
    read: () => ({ SheetNames: ['FromWorkbook'], Sheets: { FromWorkbook: {} } }),
    write: () => workbookBytes,
    utils: {
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }),
      encode_cell: () => 'A1',
      book_new: () => ({}),
      book_append_sheet: () => {},
    },
  };
});

import JSZip from 'jszip';
import { usePersistence } from '../../app/(apps)/sheets/editor/hooks/usePersistence';
import { packNeutrinoModel, readNeutrinoModel } from '@/lib/ooxmlContainer';
import { ApiClientError } from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A model carrying exactly the things SheetJS cannot write. If the editor reads
 * the workbook instead of the model, every one of these comes back empty.
 */
const MODEL = JSON.stringify({
  sheets: [{
    name: 'Q1',
    color: '#ff0000',
    cells: { A1: { id: 'A1', raw: '7', value: '7', cellStyle: { bg: '#00ff00' } } },
    colWidths: { '1': 240 },
    rowHeights: { '1': 44 },
    conditionalFormats: [{ id: 'cf-1', range: 'A1:A9' }],
  }],
});

async function emptyWorkbookZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://x"/>');
  zip.file('xl/workbook.xml', '<workbook/>');
  return zip.generateAsync({ type: 'uint8array' });
}

/**
 * `SheetEditor` keeps its per-sheet refs in step with the state the setters
 * write, and `serialize()` reads the refs — so a harness whose setters only
 * record calls would serialise the *initial* refs on save and make a
 * round-trip test pass or fail for reasons that have nothing to do with the
 * container. These setters therefore write through, as the editor does.
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
  downloadFile.mockResolvedValue(new Blob([bytes.buffer as ArrayBuffer]));
}

// ---------------------------------------------------------------------------

describe('opening an .xlsx Neutrino wrote', () => {
  it('reads the packed model rather than re-parsing the workbook', async () => {
    await storedBytes(await packNeutrinoModel(await emptyWorkbookZip(), 'sheets', MODEL));
    const { hook, setSheetNames } = setupHook();

    await act(async () => { await hook.result.current.load(); });
    await waitFor(() => expect(hook.result.current.officeMode).toBe(true));

    // 'FromWorkbook' is what the SheetJS stub reports; 'Q1' is what the model
    // says. Reading the workbook here is the data-loss bug this guards.
    expect(setSheetNames).toHaveBeenCalledWith(['Q1']);
  });

  it('brings back everything the workbook format cannot carry', async () => {
    await storedBytes(await packNeutrinoModel(await emptyWorkbookZip(), 'sheets', MODEL));
    const { hook, setColWidths, setSheetColors, setConditionalFormats } = setupHook();

    await act(async () => { await hook.result.current.load(); });
    await waitFor(() => expect(hook.result.current.officeMode).toBe(true));

    expect(setColWidths).toHaveBeenCalledWith(new Map([[1, 240]]));
    expect(setSheetColors).toHaveBeenCalledWith(['#ff0000']);
    expect(setConditionalFormats).toHaveBeenCalledWith([{ id: 'cf-1', range: 'A1:A9' }]);
  });
});

describe('opening an .xlsx from somewhere else', () => {
  it('falls back to parsing the workbook when there is no model in it', async () => {
    await storedBytes(await emptyWorkbookZip());
    const { hook, setSheetNames } = setupHook();

    await act(async () => { await hook.result.current.load(); });
    await waitFor(() => expect(hook.result.current.officeMode).toBe(true));

    expect(setSheetNames).toHaveBeenCalledWith(['FromWorkbook']);
  });
});

describe('saving', () => {
  it('writes a package holding both the workbook and the model', async () => {
    await storedBytes(await packNeutrinoModel(await emptyWorkbookZip(), 'sheets', MODEL));
    const { hook } = setupHook();
    await act(async () => { await hook.result.current.load(); });
    await waitFor(() => expect(hook.result.current.officeMode).toBe(true));

    await act(async () => { await hook.result.current.save(); });

    const written = driveAutosaveEncryptedBytes.mock.calls.at(-1)![1] as Uint8Array;
    const zip = await JSZip.loadAsync(written);
    // Real workbook parts, so Excel opens it…
    expect(zip.file('xl/workbook.xml')).not.toBeNull();
    // …and the model, so Neutrino reopens it without losing anything.
    expect(await readNeutrinoModel(written, 'sheets')).toBeTruthy();
  });

  it('what it writes is what it reads back', async () => {
    await storedBytes(await packNeutrinoModel(await emptyWorkbookZip(), 'sheets', MODEL));
    const { hook } = setupHook();
    await act(async () => { await hook.result.current.load(); });
    await waitFor(() => expect(hook.result.current.officeMode).toBe(true));

    await act(async () => { await hook.result.current.save(); });
    const written = driveAutosaveEncryptedBytes.mock.calls.at(-1)![1] as Uint8Array;

    // Reload from the bytes just written and the same spreadsheet comes back.
    await storedBytes(written);
    const second = setupHook();
    await act(async () => { await second.hook.result.current.load(); });
    await waitFor(() => expect(second.hook.result.current.officeMode).toBe(true));

    expect(second.setSheetNames).toHaveBeenCalledWith(['Q1']);
    expect(second.setColWidths).toHaveBeenCalledWith(new Map([[1, 240]]));
  });
});

describe('a spreadsheet that was just created', () => {
  /**
   * `POST /drive/files` writes no body for an OOXML type — a zip is not
   * something the server can build, and a seed would sit in the clear until the
   * first save. So the first thing the editor sees is zero bytes, and it has to
   * read that as a blank workbook rather than as a file it failed to open.
   */
  it('opens a zero-byte file as blank and saves a real package immediately', async () => {
    await storedBytes(new Uint8Array(0));
    const { hook, setSheetNames } = setupHook();

    await act(async () => { await hook.result.current.load(); });
    await waitFor(() => expect(hook.result.current.officeMode).toBe(true));
    await waitFor(() => expect(driveAutosaveEncryptedBytes).toHaveBeenCalledTimes(1));

    // Nothing was parsed out of the empty file…
    expect(setSheetNames).not.toHaveBeenCalled();
    // …and what landed in Drive is a valid package, not another zero-byte write.
    const written = driveAutosaveEncryptedBytes.mock.calls[0][1] as Uint8Array;
    expect(await readNeutrinoModel(written, 'sheets')).toBeTruthy();
  });
});
