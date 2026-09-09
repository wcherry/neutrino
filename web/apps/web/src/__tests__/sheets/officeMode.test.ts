/**
 * Tests for how the sheets `usePersistence` hook resolves and loads a file
 * (issue #43 — in-place editing of MS Office docs, plan section 3).
 *
 * There is no existing hook-level test precedent under __tests__/sheets/ (all
 * current sheets tests exercise pure helper functions, not hooks) — this is a
 * judgment call: we use @testing-library/react's `renderHook`, the same
 * pattern already used for packages/hooks/src/__tests__/index.test.ts, since
 * usePersistence.ts (not SheetEditor.tsx) is where the plan places the
 * metadata/content query + save-path integration for office mode.
 *
 * A spreadsheet is an `.xlsx`, so `storageApi.getFileMetadata` is what
 * identifies it: if the metadata says xlsx, the raw bytes are downloaded and
 * parsed (via the `xlsx` package's `XLSX.read`, the same library already used
 * for import/export in SheetEditor.tsx/useExport.ts) and the parsed cells are
 * pushed into the grid via `setData`, instead of leaving the sheet in a blank
 * "start fresh" state that is indistinguishable from a genuinely new/empty
 * sheet. If the metadata 404s, `load()` must leave the sheet in the existing
 * "not loaded" state without ever calling `setData` from XLSX content.
 *
 * This used to describe a fallback: `sheetsApi.getSheet` was asked first and
 * its 404 meant "not bespoke JSON, therefore OOXML". No file was ever stored
 * in that format and it is gone, so there is one path and no probe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const mockGetFileMetadata = vi.fn();
const mockDownloadFile = vi.fn();
// The office-mode read goes through `driveReadBytes` — see its module comment.
const mockReadBytes = vi.fn();

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
  sheetsApi: {
    saveSheet: vi.fn(() => Promise.resolve()),
  },
  driveReadContent: vi.fn(() => Promise.resolve('{"sheets":[]}')),
  driveReadBytes: (...args: unknown[]) => mockReadBytes(...args),
  driveCreateVersion: vi.fn(() => Promise.resolve()),
  driveCreateEncryptedVersion: vi.fn(() => Promise.resolve()),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve()),
  storageApi: {
    getFileMetadata: (...args: unknown[]) => mockGetFileMetadata(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  },
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: vi.fn(() => workbookBytes('the decrypted workbook')),
}));

vi.mock('@neutrino/ui', () => ({
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

/**
 * The key this session holds, if any. Mutable so a test can hand the key over
 * mid-load — which is what an unlock does, the gate being an overlay that
 * settles after the editor has already mounted.
 */
let sessionDek: Uint8Array | null = null;

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: sessionDek },
    dekResolved: true,
    awaitDek: async () => sessionDek,
  }),
}));

// The office-mode load path is expected to parse downloaded xlsx bytes via
// the `xlsx` package, the same library already used by SheetEditor.tsx /
// useExport.ts for import/export. NOTE: usePersistence.ts does not import
// `xlsx` today — this mock (and the assertion built on it) targets where the
// plan places the detection/parse responsibility; if the eventual
// implementation instead parses in SheetEditor.tsx after receiving raw bytes
// from the hook, this specific assertion (not the getFileMetadata
// fallback-call assertions) would need to move accordingly.
const mockReadXlsx = vi.fn(() => Promise.resolve({
  sheets: [{ name: 'Sheet1', cells: {} }],
}));
vi.mock('@/lib/ooxml/xlsx/read', () => ({
  readXlsx: (...args: unknown[]) => mockReadXlsx(...args),
}));

import { usePersistence } from '../../app/(apps)/sheets/editor/hooks/usePersistence';
import { ApiClientError } from '@/lib/api';

/**
 * Stored bytes that read as a workbook rather than as ciphertext.
 *
 * A `.xlsx` is a zip, and that is how the load path tells an unencrypted
 * workbook from bytes it has no key for — bytes with neither the zip header
 * nor a key are ciphertext the session cannot open yet, and are left alone
 * rather than parsed. These tests are about the plaintext-upload path, so the
 * fixtures carry the header a real package would.
 */
function workbookBytes(rest: string): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(rest)]);
}

function setupHook() {
  const setData = vi.fn();
  const props = {
    sheetId: 'test-sheet-id',
    dirtyRef: { current: false },
    sheetsDataRef: { current: [new Map()] },
    sheetsColWidthsRef: { current: [new Map()] },
    sheetsRowHeightsRef: { current: [new Map()] },
    activeSheetIndexRef: { current: 0 },
    sheetNamesRef: { current: ['Sheet1'] },
    sheetColorsRef: { current: [null] },
    flushActiveSheet: vi.fn(),
    setData,
    setColWidths: vi.fn(),
    setRowHeights: vi.fn(),
    setSheetNames: vi.fn(),
    setSheetColors: vi.fn(),
  };
  const { result } = renderHook(() => usePersistence(props as never));
  return { result, setData };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionDek = null;
});

describe('usePersistence — resolving and loading the file (issue #43)', () => {
  it('identifies the spreadsheet through storageApi.getFileMetadata', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-sheet-id', name: 'budget.xlsx', mimeType: XLSX_MIME });
    mockReadBytes.mockResolvedValue(workbookBytes('fake xlsx bytes'));

    const { result } = setupHook();
    await result.current.load();

    expect(mockGetFileMetadata).toHaveBeenCalledWith('test-sheet-id');
  });

  it('applies the parsed workbook for an .xlsx file', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-sheet-id', name: 'budget.xlsx', mimeType: XLSX_MIME });
    mockReadBytes.mockResolvedValue(workbookBytes('fake xlsx bytes'));

    const { result, setData } = setupHook();
    await result.current.load();

    expect(setData).toHaveBeenCalled();
  });

  /**
   * The vault unlocks a moment after the editor mounts, so the first load runs
   * with no key at all. Its bytes are the spreadsheet's ciphertext, and the
   * workbook parser does not refuse those — it reads unknown bytes as text and
   * fills the grid with them. Nothing may be applied from that read, and the
   * caller that arrives with the key has to read the file again rather than
   * being handed the keyless load's promise.
   */
  it('does not read ciphertext as a workbook, and reads again once the key arrives', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-sheet-id', name: 'budget.xlsx', mimeType: XLSX_MIME });
    const ciphertext = new TextEncoder().encode('not a zip — this is E2EE ciphertext');
    let releaseRead: () => void = () => {};
    mockReadBytes.mockImplementationOnce(
      () => new Promise((resolve) => { releaseRead = () => resolve(ciphertext); }),
    );
    mockReadBytes.mockResolvedValue(ciphertext);

    const { result, setData } = setupHook();
    const keyless = result.current.load();
    await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(1));

    // The unlock lands while that read is still in flight.
    sessionDek = new Uint8Array([1, 2, 3]);
    const withKey = result.current.load();
    releaseRead();
    await Promise.all([keyless, withKey]);

    expect(mockReadBytes).toHaveBeenCalledTimes(2);
    expect(setData).toHaveBeenCalled();
  });

  it('applies nothing at all when the key never arrives', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-sheet-id', name: 'budget.xlsx', mimeType: XLSX_MIME });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('not a zip — this is E2EE ciphertext'));

    const { result, setData } = setupHook();
    await result.current.load();

    expect(mockReadXlsx).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it('applies nothing when the file metadata 404s', async () => {
    mockGetFileMetadata.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'File not found'));

    const { result, setData } = setupHook();
    await result.current.load();

    expect(mockReadXlsx).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });
});
