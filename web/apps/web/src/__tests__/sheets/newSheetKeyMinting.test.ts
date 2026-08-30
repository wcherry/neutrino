/**
 * Creating a spreadsheet must not warn that the changes were not saved
 * (issue #157).
 *
 * A new sheet is a Drive row with no body and no key. `useEncryptedDocumentContent`
 * mints one on open, and `dekResolved` — which the editor gates its load on —
 * means only that the resolution *attempt* has finished: for a brand-new file
 * it flips true, back to false, and true again as the mint runs. So the load
 * effect fires while the key is still being minted, and `usePersistence` used
 * to sample `dekRef.current` there. It read null, took the "no key, no write"
 * branch, and the first thing a user saw after clicking New → Sheet was
 * "Changes not saved — encryption key unavailable".
 *
 * The fix is the rule docs, slides, notes and drawing already follow: await the
 * resolution rather than sampling the ref.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEK = new Uint8Array(32).fill(9);

const getSheet = vi.fn();
const getFileMetadata = vi.fn();
const readBytes = vi.fn();
const driveAutosaveEncryptedBytes = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();

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
    downloadFile: vi.fn(),
  },
  filesystemApi: { updateFile: vi.fn() },
}));

vi.mock('@neutrino/e2e-crypto', () => ({ decryptFile: (b: Uint8Array) => b }));
vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));
vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: vi.fn() }));
vi.mock('@/hooks/useContentVersionGuard', () => ({
  useContentVersionGuard: () => ({
    observe: vi.fn(), check: () => undefined, handleError: () => false,
  }),
}));
vi.mock('@neutrino/ui', () => ({
  useToast: () => ({
    warning: toastWarning, error: toastError, success: vi.fn(), info: vi.fn(),
  }),
}));

/**
 * The hook as the editor sees it mid-mint: the attempt is "resolved" as far as
 * the flag is concerned, the ref is still empty, and only awaiting the
 * resolution produces the key.
 */
let mintedDek: Uint8Array | null = null;
let mint: Promise<void>;
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { get current() { return mintedDek; } },
    dekResolved: true,
    awaitDek: async () => { await mint; return mintedDek; },
  }),
}));

vi.mock('@/lib/ooxmlContainer', () => ({
  packNeutrinoModel: (ooxml: Uint8Array) => Promise.resolve(ooxml),
  readNeutrinoModel: () => Promise.resolve(null),
}));

vi.mock('xlsx', () => ({
  read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
  write: () => new ArrayBuffer(8),
  utils: {
    decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }),
    encode_cell: () => 'A1',
    book_new: () => ({}),
    book_append_sheet: () => {},
  },
}));

import { usePersistence } from '../../app/(apps)/sheets/editor/hooks/usePersistence';
import { ApiClientError } from '@/lib/api';

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
  };
  return renderHook(() => usePersistence(props as never));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Locked by default; the tests below that hold a key mint one.
  mintedDek = null;
  mint = Promise.resolve();
  getSheet.mockRejectedValue(new ApiClientError(404, 'not_found', 'not bespoke JSON'));
  getFileMetadata.mockResolvedValue({ id: 'file-1', name: 'Untitled spreadsheet.xlsx', mimeType: XLSX_MIME });
  // What `driveReadBytes` reports for a file whose body was never written.
  readBytes.mockResolvedValue(new Uint8Array(0));
});

/**
 * The key lands a round trip after the load starts — the window issue #157
 * lived in. A macrotask, not a microtask: the mocked reads below settle
 * immediately, and a key that arrives before them would leave nothing for the
 * load to be racing.
 */
function mintKeyOnNextTurn() {
  mint = new Promise<void>(resolve => setTimeout(resolve, 0))
    .then(() => { mintedDek = DEK; });
}

describe('opening a spreadsheet created a moment ago', () => {
  it('seals the blank workbook instead of warning that nothing was saved', async () => {
    mintKeyOnNextTurn();
    const { result } = setupHook();

    await act(async () => { await result.current.load(); });
    await waitFor(() => expect(result.current.officeMode).toBe(true));

    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(driveAutosaveEncryptedBytes).toHaveBeenCalledTimes(1);
    // Encrypted with the key that was still being minted when load() began.
    expect(driveAutosaveEncryptedBytes.mock.calls[0][3]).toBe(DEK);
  });

  it('still warns when the session is genuinely locked', async () => {
    const { result } = setupHook();

    await act(async () => { await result.current.load(); });

    expect(driveAutosaveEncryptedBytes).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  /**
   * The editor's load effect is keyed on `dekResolved`, which toggles twice
   * while the key is minted — so it asks for the same file twice. The second
   * read must not land after the first load's opening save and paint the blank
   * workbook back over whatever was typed in between.
   */
  it('coalesces a second load fired while the first is still running', async () => {
    mintKeyOnNextTurn();
    const { result } = setupHook();

    await act(async () => {
      await Promise.all([result.current.load(), result.current.load()]);
    });

    expect(readBytes).toHaveBeenCalledTimes(1);
    expect(driveAutosaveEncryptedBytes).toHaveBeenCalledTimes(1);
  });

  /** A version restore reloads long after; nothing is in flight to join. */
  it('reloads for real once the first load has finished', async () => {
    mintKeyOnNextTurn();
    const { result } = setupHook();

    await act(async () => { await result.current.load(); });
    await act(async () => { await result.current.load(); });

    expect(readBytes).toHaveBeenCalledTimes(2);
  });
});
