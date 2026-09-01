/**
 * Tests for the sheets `usePersistence` hook's office-mode detection/fallback
 * contract (issue #43 — in-place editing of MS Office docs, plan section 3).
 *
 * There is no existing hook-level test precedent under __tests__/sheets/ (all
 * current sheets tests exercise pure helper functions, not hooks) — this is a
 * judgment call: we use @testing-library/react's `renderHook`, the same
 * pattern already used for packages/hooks/src/__tests__/index.test.ts, since
 * usePersistence.ts (not SheetEditor.tsx) is where the plan places the
 * metadata/content query + save-path integration for office mode.
 *
 * Mirrors the Docs/Slides office-mode contract: when `sheetsApi.getSheet`
 * 404s (no `sheets` row exists for this file id — it's a raw .xlsx), the hook
 * must fall back to `storageApi.getFileMetadata`. If that metadata identifies
 * an xlsx file, office mode is entered: the raw bytes are downloaded and
 * parsed (via the `xlsx` package's `XLSX.read`, the same library already used
 * for import/export in SheetEditor.tsx/useExport.ts) and the parsed cells are
 * pushed into the grid via `setData`, instead of leaving the sheet in a blank
 * "start fresh" state that is indistinguishable from a genuinely new/empty
 * sheet. If the fallback ALSO 404s, `load()` must leave the sheet in the
 * existing "not loaded" state without ever calling `setData` from XLSX
 * content (today's behavior for a truly missing sheet).
 *
 * Expected to fail right now (red phase): usePersistence.ts has no fallback
 * path today, so `storageApi.getFileMetadata` is never called on a 404 from
 * `sheetsApi.getSheet`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const mockGetSheet = vi.fn();
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
    getSheet: (...args: unknown[]) => mockGetSheet(...args),
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
// implementation instead does the XLSX.read call in SheetEditor.tsx after
// receiving raw bytes from the hook, this specific assertion (not the
// getFileMetadata fallback-call assertions) would need to move accordingly.
const mockXlsxRead = vi.fn(() => ({
  SheetNames: ['Sheet1'],
  Sheets: { Sheet1: {} },
}));
vi.mock('xlsx', () => ({
  read: (...args: unknown[]) => mockXlsxRead(...args),
  utils: {
    decode_range: vi.fn(() => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })),
    encode_cell: vi.fn(() => 'A1'),
  },
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

describe('usePersistence — office-mode detection/fallback (issue #43)', () => {
  it('falls back to storageApi.getFileMetadata when sheetsApi.getSheet 404s', async () => {
    mockGetSheet.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Spreadsheet not found'));
    mockGetFileMetadata.mockResolvedValue({ id: 'test-sheet-id', name: 'budget.xlsx', mimeType: XLSX_MIME });
    mockReadBytes.mockResolvedValue(workbookBytes('fake xlsx bytes'));

    const { result } = setupHook();
    await result.current.load();

    expect(mockGetFileMetadata).toHaveBeenCalledWith('test-sheet-id');
  });

  it('enters office mode and parses xlsx content via setData for a raw .xlsx file', async () => {
    mockGetSheet.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Spreadsheet not found'));
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
    mockGetSheet.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Spreadsheet not found'));
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
    mockGetSheet.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Spreadsheet not found'));
    mockGetFileMetadata.mockResolvedValue({ id: 'test-sheet-id', name: 'budget.xlsx', mimeType: XLSX_MIME });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('not a zip — this is E2EE ciphertext'));

    const { result, setData } = setupHook();
    await result.current.load();

    expect(mockXlsxRead).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it('does not call getFileMetadata when sheetsApi.getSheet succeeds (native sheet, unaffected)', async () => {
    mockGetSheet.mockResolvedValue({
      id: 'test-sheet-id',
      title: 'My Sheet',
      contentUrl: '/api/v1/drive/files/test-sheet-id',
      contentWriteUrl: '/api/v1/drive/files/test-sheet-id/versions',
      folderId: null,
      createdAt: '',
      updatedAt: '',
      yourRole: 'owner',
    });

    const { result } = setupHook();
    await result.current.load();

    expect(mockGetFileMetadata).not.toHaveBeenCalled();
  });

  it('does NOT enter office mode when the storage fallback ALSO 404s', async () => {
    mockGetSheet.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Spreadsheet not found'));
    mockGetFileMetadata.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'File not found'));

    const { result, setData } = setupHook();
    await result.current.load();

    expect(mockXlsxRead).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });
});
