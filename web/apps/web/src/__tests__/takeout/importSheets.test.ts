/**
 * Tests for the Sheets import runner (`lib/takeout/importSheets.ts`).
 *
 * The API and crypto layers are mocked, as everywhere else in this suite —
 * what is under test is the sequencing: that each spreadsheet gets a DEK
 * registered before its ciphertext is uploaded, that the export's folder tree
 * is recreated once rather than per file, and that a failure on one file
 * doesn't abandon the rest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

const sheetsApi = {
  listSheets: vi.fn(),
  createSheet: vi.fn(),
};
const filesystemApi = {
  getFolderContents: vi.fn(),
  createFolder: vi.fn(),
};
const encryptionApi = {
  setFileKey: vi.fn(),
};
const storageApi = {
  setImportMetadata: vi.fn(),
};
const driveAutosaveContent = vi.fn();
const driveAutosaveEncryptedContent = vi.fn();

vi.mock('@/lib/api', () => ({
  get sheetsApi() { return sheetsApi; },
  get filesystemApi() { return filesystemApi; },
  get encryptionApi() { return encryptionApi; },
  get storageApi() { return storageApi; },
  driveAutosaveContent: (...args: unknown[]) => driveAutosaveContent(...args),
  driveAutosaveEncryptedContent: (...args: unknown[]) => driveAutosaveEncryptedContent(...args),
  // The folder resolver (`lib/takeout/folders.ts`) uses this to address the
  // drive root — a user's root folder id is their own user id.
  getCurrentUserId: () => 'user-1',
}));

const indexOnSave = vi.fn();
vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: (...args: unknown[]) => indexOnSave(...args) }));

const loadKeyPair = vi.fn();
vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn().mockResolvedValue(undefined),
  loadKeyPair: (...args: unknown[]) => loadKeyPair(...args),
  generateFileKey: () => new Uint8Array([1, 2, 3]),
  encryptFileKey: () => 'encrypted-dek',
  activeKeyVersion: () => 1,
}));

vi.mock('@neutrino/api-sheets', () => ({ extractSheetText: (raw: string) => `text:${raw.length}` }));

import { runSheetsImport, DEFAULT_SHEETS_IMPORT_OPTIONS } from '@/lib/takeout/importSheets';
import type { DriveSheetEntry } from '@/lib/takeout/driveSheets';
import type { TakeoutEntry } from '@/lib/takeout/archive';

const KEY_PAIR = { publicKey: new Uint8Array([9]), secretKey: new Uint8Array([8]) };

/** Real .xlsx bytes for a one-cell workbook. */
function workbookBytes(value: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[value]]), 'Data');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

function takeoutEntry(
  path: string,
  text = '',
  bytes?: ArrayBuffer,
  lastModified: Date | null = null,
): TakeoutEntry {
  return {
    path,
    fullPath: `Takeout/Drive/${path}`,
    ext: path.slice(path.lastIndexOf('.') + 1),
    size: 0,
    lastModified,
    text: async () => text,
    // jsdom's Blob has no arrayBuffer() in this environment, and the runner
    // only ever asks for the bytes.
    blob: async () => ({ arrayBuffer: async () => bytes ?? new ArrayBuffer(0) }) as unknown as Blob,
  };
}

/** A spreadsheet in the export. Defaults to a one-cell `.csv`, which needs no bytes. */
function sheet(path: string, overrides: Partial<DriveSheetEntry> = {}): DriveSheetEntry {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const slash = path.lastIndexOf('/');
  return {
    entry: takeoutEntry(path, 'Name,Qty\nWidget,2\n'),
    format: 'csv',
    title: base.slice(0, base.lastIndexOf('.')),
    path: slash === -1 ? [] : path.slice(0, slash).split('/'),
    ...overrides,
  };
}

const run = (sheets: DriveSheetEntry[], options = {}) =>
  runSheetsImport({
    sheets,
    options: { ...DEFAULT_SHEETS_IMPORT_OPTIONS, folderName: null, ...options },
    userId: 'user-1',
  });

/** The spreadsheet JSON handed to the save call, decoded. */
const savedContent = (call = 0) => JSON.parse(driveAutosaveEncryptedContent.mock.calls[call][1]);

beforeEach(() => {
  vi.clearAllMocks();
  loadKeyPair.mockReturnValue(KEY_PAIR);
  sheetsApi.listSheets.mockResolvedValue({ sheets: [] });
  sheetsApi.createSheet.mockImplementation(async ({ title }: { title: string }) => ({ id: `id-${title}`, title }));
  filesystemApi.getFolderContents.mockResolvedValue({ folders: [], files: [] });
  storageApi.setImportMetadata.mockResolvedValue({});
});

describe('runSheetsImport', () => {
  // ── Dates (issue #110) ──────────────────────────────────────────────────

  it('gives a spreadsheet the dates its sidecar recorded', async () => {
    const withSidecar = sheet('A.csv', {
      info: takeoutEntry(
        'A.csv-info.json',
        JSON.stringify({ created_date: '2014-03-01T12:00:00Z', modified_date: '2016-07-04T09:30:00Z' }),
      ),
    });

    await run([withSidecar]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Drive/A.csv',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  it('falls back to the zip entry’s own date when there is no sidecar', async () => {
    await run([
      sheet('A.csv', {
        entry: takeoutEntry('A.csv', 'Name,Qty\nWidget,2\n', undefined, new Date('2014-03-01T12:00:00Z')),
      }),
    ]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Drive/A.csv',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2014-03-01T12:00:00.000Z',
    });
  });

  /**
   * Saving the body is what stamps the file with the current time, so dates
   * written before it would not survive their own workbook being saved.
   */
  it('records the dates after the body, not before', async () => {
    await run([sheet('A.csv')]);

    expect(storageApi.setImportMetadata.mock.invocationCallOrder[0]).toBeGreaterThan(
      driveAutosaveEncryptedContent.mock.invocationCallOrder[0],
    );
  });

  it('still counts the spreadsheet as imported when its dates cannot be recorded', async () => {
    storageApi.setImportMetadata.mockRejectedValue(new Error('nope'));

    const summary = await run([sheet('A.csv')]);

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
  });

  it('creates a spreadsheet per file and saves its converted content', async () => {
    const summary = await run([sheet('A.csv'), sheet('B.csv')]);

    expect(summary).toMatchObject({ total: 2, imported: 2, skipped: 0, failed: 0 });
    expect(sheetsApi.createSheet).toHaveBeenCalledWith({ title: 'A', folderId: null });
    expect(savedContent().sheets[0].cells.A1).toMatchObject({ id: 'A1', raw: 'Name' });
  });

  it('converts a .xlsx from the archive’s bytes', async () => {
    await run([
      sheet('Budget.xlsx', { format: 'xlsx', entry: takeoutEntry('Budget.xlsx', '', workbookBytes('Total')) }),
    ]);

    expect(savedContent().sheets[0]).toMatchObject({ name: 'Data' });
    expect(savedContent().sheets[0].cells.A1).toMatchObject({ raw: 'Total' });
  });

  it('registers a DEK before uploading the ciphertext, as the editor does', async () => {
    await run([sheet('A.csv')]);

    expect(encryptionApi.setFileKey).toHaveBeenCalledWith('id-A', { encryptedFileKey: 'encrypted-dek', keyVersion: 1 });
    expect(encryptionApi.setFileKey.mock.invocationCallOrder[0]).toBeLessThan(
      driveAutosaveEncryptedContent.mock.invocationCallOrder[0],
    );
    // The editor reads the body back from sheet.json; another name would leave
    // the spreadsheet looking empty.
    expect(driveAutosaveEncryptedContent.mock.calls[0][2]).toBe('sheet.json');
  });

  it('saves plaintext and flags it when the device has no key pair', async () => {
    loadKeyPair.mockReturnValue(null);
    const summary = await run([sheet('A.csv')]);

    expect(summary.unencrypted).toBe(true);
    expect(encryptionApi.setFileKey).not.toHaveBeenCalled();
    expect(driveAutosaveEncryptedContent).not.toHaveBeenCalled();
    expect(driveAutosaveContent).toHaveBeenCalledWith('id-A', expect.any(String), 'sheet.json');
  });

  it('adds each imported spreadsheet to the search index', async () => {
    await run([sheet('A.csv')]);
    expect(indexOnSave).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'id-A', type: 'spreadsheet', title: 'A' }),
    );
  });

  it('passes the formula choice through to the conversion', async () => {
    const withFormula = sheet('A.csv', { entry: takeoutEntry('A.csv', 'x\n=1+1\n') });
    await run([withFormula], { importFormulas: false });

    expect(savedContent().sheets[0].cells.A2.raw).not.toMatch(/^=/);
  });

  it('prefers the title in the metadata sidecar over the filename', async () => {
    const withInfo = sheet('Q3_ budget(1).csv', {
      info: takeoutEntry('Q3.csv-info.json', '{"title":"Q3: budget"}'),
    });
    const summary = await run([withInfo]);

    expect(sheetsApi.createSheet).toHaveBeenCalledWith({ title: 'Q3: budget', folderId: null });
    expect(summary.items[0].title).toBe('Q3: budget');
  });

  it('recreates the folders the spreadsheets were in, once each', async () => {
    filesystemApi.createFolder.mockImplementation(async ({ name }: { name: string }) => ({ id: `f-${name}`, name }));
    await run([sheet('Work/a.csv'), sheet('Work/b.csv'), sheet('Personal/c.csv')], {
      folderName: 'Google Sheets',
    });

    expect(filesystemApi.createFolder.mock.calls.map(([body]) => body)).toEqual([
      { name: 'Google Sheets' },
      { name: 'Work', parentId: 'f-Google Sheets' },
      { name: 'Personal', parentId: 'f-Google Sheets' },
    ]);
    expect(sheetsApi.createSheet).toHaveBeenCalledWith({ title: 'b', folderId: 'f-Work' });
  });

  it('puts everything in the destination folder when the tree is not wanted', async () => {
    filesystemApi.createFolder.mockResolvedValue({ id: 'f1', name: 'Google Sheets' });
    const summary = await run([sheet('Work/a.csv')], { folderName: 'Google Sheets', preserveFolders: false });

    expect(filesystemApi.createFolder).toHaveBeenCalledTimes(1);
    expect(sheetsApi.createSheet).toHaveBeenCalledWith({ title: 'a', folderId: 'f1' });
    expect(summary.folderId).toBe('f1');
  });

  it('skips a title that already exists so a re-run makes no duplicates', async () => {
    sheetsApi.listSheets.mockResolvedValue({ sheets: [{ title: 'a' }] });
    const summary = await run([sheet('A.csv')]);

    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toMatch(/already exists/);
    expect(sheetsApi.createSheet).not.toHaveBeenCalled();
  });

  it('imports over an existing title when the check is turned off', async () => {
    sheetsApi.listSheets.mockResolvedValue({ sheets: [{ title: 'A' }] });
    expect((await run([sheet('A.csv')], { skipExisting: false })).imported).toBe(1);
    expect(sheetsApi.listSheets).not.toHaveBeenCalled();
  });

  it('records a failure and carries on with the rest', async () => {
    sheetsApi.createSheet.mockRejectedValueOnce(Object.assign(new Error('too big'), { statusCode: 413 }));
    const summary = await run([sheet('A.csv'), sheet('B.csv')]);

    expect(summary).toMatchObject({ imported: 1, failed: 1 });
    expect(summary.items[0]).toMatchObject({ title: 'A', status: 'failed', reason: 'HTTP 413: too big' });
    expect(summary.items[1].status).toBe('imported');
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await runSheetsImport({
      sheets: [sheet('A.csv'), sheet('B.csv')],
      options: { ...DEFAULT_SHEETS_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1, 2]);
  });

  it('stops when the run is aborted', async () => {
    const controller = new AbortController();
    const summary = await runSheetsImport({
      sheets: [sheet('A.csv'), sheet('B.csv')],
      options: { ...DEFAULT_SHEETS_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: () => controller.abort(),
      signal: controller.signal,
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.imported).toBe(1);
  });
});
