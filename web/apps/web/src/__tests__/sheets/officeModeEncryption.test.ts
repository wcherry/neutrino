/**
 * Office-mode spreadsheets are encrypted at rest, like everything else in Drive
 * (issue #95).
 *
 * They were the deliberate exception. Issue #43's third acceptance criterion —
 * "downloading the raw file must open in real Excel" — was read as "the bytes
 * in storage must be OOXML", so office mode wrote `driveAutosaveBytes` and
 * `driveCreateVersionBytes`, both plaintext, even when a DEK was sitting right
 * there for the file id. The premise was wrong: Drive's download decrypts in
 * the browser (`downloadAndDecryptFile`), so the .xlsx that lands on the user's
 * disk is byte-identical either way. What the plaintext write actually bought
 * was a readable spreadsheet in object storage, with no key ref and so no way
 * to ever encrypt it.
 *
 * The load side moves with it, and `isNewEncryption` is the hinge: a legacy
 * .xlsx uploaded before this is still plaintext but is handed a freshly minted
 * DEK by `useEncryptedDocumentContent`, so "we have a key" cannot mean "the
 * bytes are ciphertext". Get that backwards and every existing office file
 * opens as an empty grid.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEK = new Uint8Array(32).fill(6);

const getSheet = vi.fn();
const getFileMetadata = vi.fn();
const downloadFile = vi.fn();
// The office-mode read goes through `driveReadBytes` — see the module comment
// on it for why a plain download is not enough.
const readBytes = vi.fn();
const driveAutosaveEncryptedBytes = vi.fn();
const driveCreateEncryptedVersionBytes = vi.fn();
const toastWarning = vi.fn();

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
    getSheet: (...a: unknown[]) => getSheet(...a),
    saveSheet: vi.fn(() => Promise.resolve()),
  },
  driveReadContent: vi.fn(() => Promise.resolve('{"sheets":[]}')),
  driveReadBytes: (...a: unknown[]) => readBytes(...a),
  driveCreateEncryptedVersion: vi.fn(() => Promise.resolve()),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve({ contentVersion: 2 })),
  driveAutosaveEncryptedBytes: (...a: unknown[]) => driveAutosaveEncryptedBytes(...a),
  driveCreateEncryptedVersionBytes: (...a: unknown[]) => driveCreateEncryptedVersionBytes(...a),
  extractSheetText: () => '',
  storageApi: {
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    downloadFile: (...a: unknown[]) => downloadFile(...a),
  },
  filesystemApi: { updateFile: vi.fn() },
}));

/** Decryption strips the 4-byte marker `asCiphertext` adds. */
const decryptFile = vi.fn((bytes: Uint8Array, _dek: Uint8Array) => bytes.slice(4));
vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: (bytes: Uint8Array, dek: Uint8Array) => decryptFile(bytes, dek),
}));

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));
vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: vi.fn() }));
vi.mock('@/hooks/useContentVersionGuard', () => ({
  useContentVersionGuard: () => ({
    observe: vi.fn(), check: () => undefined, handleError: () => false,
  }),
}));

vi.mock('@neutrino/ui', () => ({
  useToast: () => ({
    warning: toastWarning, success: vi.fn(), error: vi.fn(), info: vi.fn(),
  }),
}));

let dekNow: Uint8Array | null = DEK;
let isNewEncryption = false;
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { get current() { return dekNow; } },
    dekResolved: true,
    isNewEncryption,
  }),
}));

/** What the office-mode load hands to XLSX.read, captured for assertion. */
const xlsxRead = vi.fn((_buffer: ArrayBuffer | Uint8Array) => ({
  SheetNames: ['Sheet1'],
  Sheets: { Sheet1: {} },
}));
/**
 * The OOXML container is exercised by `lib/__tests__/ooxmlContainer.test.ts`;
 * here it is stubbed so the fake `RAW_XLSX` bytes below don't have to be a real
 * zip. What this file is about is which transport the bytes go out on and
 * whether they are encrypted, not what is inside the package.
 */
vi.mock('@/lib/ooxmlContainer', () => ({
  packNeutrinoModel: (ooxml: Uint8Array) => Promise.resolve(ooxml),
  readNeutrinoModel: () => Promise.resolve(null),
}));

vi.mock('xlsx', () => ({
  read: (buffer: ArrayBuffer | Uint8Array) => xlsxRead(buffer),
  write: () => new ArrayBuffer(8),
  utils: {
    decode_range: vi.fn(() => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })),
    encode_cell: vi.fn(() => 'A1'),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
}));

import { usePersistence } from '../../app/(apps)/sheets/editor/hooks/usePersistence';
import { ApiClientError } from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RAW_XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]);

function asCiphertext(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 4);
  out.set([0xc1, 0xc2, 0xc3, 0xc4], 0);
  out.set(bytes, 4);
  return out;
}

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

/** Load a raw .xlsx so the hook is sitting in office mode. */
async function loadInOfficeMode() {
  const { result } = setupHook();
  await act(async () => { await result.current.load(); });
  await waitFor(() => expect(result.current.officeMode).toBe(true));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  dekNow = DEK;
  isNewEncryption = false;
  getSheet.mockRejectedValue(new ApiClientError(404, 'not_found', 'no sheets row'));
  getFileMetadata.mockResolvedValue({ id: 'file-1', name: 'Budget.xlsx', mimeType: XLSX_MIME });
  readBytes.mockResolvedValue(asCiphertext(RAW_XLSX));
  downloadFile.mockResolvedValue(new Blob([asCiphertext(RAW_XLSX).buffer as ArrayBuffer]));
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('opening an office-mode file', () => {
  it('decrypts the stored bytes before parsing them', async () => {
    await loadInOfficeMode();

    expect(decryptFile).toHaveBeenCalledTimes(1);
    // XLSX.read must see the original OOXML, not the ciphertext wrapping it.
    const parsed = new Uint8Array(xlsxRead.mock.calls[0][0]);
    expect(Array.from(parsed)).toEqual(Array.from(RAW_XLSX));
  });

  it('reads a legacy plaintext file as-is despite holding a fresh key', async () => {
    isNewEncryption = true;
    readBytes.mockResolvedValue(RAW_XLSX);

    await loadInOfficeMode();

    expect(decryptFile).not.toHaveBeenCalled();
    const parsed = new Uint8Array(xlsxRead.mock.calls[0][0]);
    expect(Array.from(parsed)).toEqual(Array.from(RAW_XLSX));
  });
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

describe('saving an office-mode file', () => {
  it('autosaves the OOXML bytes encrypted, under the file’s own name', async () => {
    const result = await loadInOfficeMode();

    await act(async () => { await result.current.save(); });

    expect(driveAutosaveEncryptedBytes).toHaveBeenCalledTimes(1);
    const [fileId, , filename, dek] = driveAutosaveEncryptedBytes.mock.calls[0];
    expect(fileId).toBe('file-1');
    // The name is what makes the download open in Excel; an .xlsx renamed to
    // sheet.json is a file the OS will not associate with anything.
    expect(filename).toBe('Budget.xlsx');
    expect(dek).toBe(DEK);
  });

  it('snapshots a manual save encrypted too', async () => {
    const result = await loadInOfficeMode();

    await act(async () => { await result.current.manualSave(); });

    expect(driveCreateEncryptedVersionBytes).toHaveBeenCalledTimes(1);
    expect(driveCreateEncryptedVersionBytes.mock.calls[0][3]).toBe(DEK);
  });

  it('writes nothing at all when the vault is locked', async () => {
    const result = await loadInOfficeMode();
    dekNow = null;

    await act(async () => { await result.current.save(); });
    await act(async () => { await result.current.manualSave(); });

    expect(driveAutosaveEncryptedBytes).not.toHaveBeenCalled();
    expect(driveCreateEncryptedVersionBytes).not.toHaveBeenCalled();
    // The key check comes before the office branch, so both shapes of file get
    // the same answer and the user is told why nothing saved.
    expect(toastWarning).toHaveBeenCalledTimes(2);
  });
});
