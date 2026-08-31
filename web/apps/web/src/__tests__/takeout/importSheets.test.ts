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
const driveAutosaveEncryptedBytes = vi.fn();

vi.mock('@/lib/api', () => ({
  get sheetsApi() { return sheetsApi; },
  get filesystemApi() { return filesystemApi; },
  get encryptionApi() { return encryptionApi; },
  get storageApi() { return storageApi; },
  driveAutosaveEncryptedBytes: (...args: unknown[]) => driveAutosaveEncryptedBytes(...args),
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
import type { SheetFile } from '@/app/(apps)/sheets/editor/types';
import { readXlsx } from '@/lib/ooxml/xlsx/read';

const KEY_PAIR = { publicKey: new Uint8Array([9]), secretKey: new Uint8Array([8]) };

/**
 * Real .xlsx bytes for a one-cell workbook.
 *
 * `formula` puts something in it that a workbook rebuilt from the model would
 * not have — `buildWorkbook` writes a value per cell — so a test can tell the
 * export's own workbook from a reconstruction of it.
 */
function workbookBytes(value: string, formula?: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[value]]);
  if (formula) {
    ws.B1 = { t: 'n', v: 3, f: formula };
    ws['!ref'] = 'A1:B1';
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
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

/**
 * The spreadsheet read back out of the `.xlsx` the save call was handed.
 *
 * Read rather than asserted against the argument: the whole point of issue #169
 * is that what is stored has to be a workbook the editor's own reader opens,
 * and `readXlsx` is that reader.
 */
async function savedContent(call = 0): Promise<SheetFile> {
  return readXlsx(driveAutosaveEncryptedBytes.mock.calls[call][1] as Uint8Array);
}

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
      driveAutosaveEncryptedBytes.mock.invocationCallOrder[0],
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
    expect((await savedContent()).sheets[0].cells.A1).toMatchObject({ id: 'A1', raw: 'Name' });
  });

  it('converts a .xlsx from the archive’s bytes', async () => {
    await run([
      sheet('Budget.xlsx', { format: 'xlsx', entry: takeoutEntry('Budget.xlsx', '', workbookBytes('Total')) }),
    ]);

    const stored = await savedContent();
    expect(stored.sheets[0]).toMatchObject({ name: 'Data' });
    expect(stored.sheets[0].cells.A1).toMatchObject({ raw: 'Total' });
  });

  it('registers a DEK before uploading the ciphertext, as the editor does', async () => {
    await run([sheet('A.csv')]);

    expect(encryptionApi.setFileKey).toHaveBeenCalledWith('id-A', { encryptedFileKey: 'encrypted-dek', keyVersion: 1 });
    expect(encryptionApi.setFileKey.mock.invocationCallOrder[0]).toBeLessThan(
      driveAutosaveEncryptedBytes.mock.invocationCallOrder[0],
    );
  });

  /**
   * Issue #169. A spreadsheet is stored as an `.xlsx` now, and the editor reads
   * the model out of that package — so an import that wrote the bespoke
   * `sheet.json` body left a file the editor could only parse as a workbook,
   * and SheetJS reads JSON text as a one-row CSV: the imported spreadsheet
   * opened as its own source code spread across row 1.
   */
  it('stores the spreadsheet as an .xlsx package, not as sheet.json', async () => {
    await run([sheet('A.csv')]);

    const [fileId, bytes, filename] = driveAutosaveEncryptedBytes.mock.calls[0];
    expect(fileId).toBe('id-A');
    expect(filename).toBe('A.xlsx');
    // A zip's local file header — what is stored really is a package.
    expect([...(bytes as Uint8Array).slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  /**
   * A Google Sheet is exported *as* an `.xlsx` and stored as an `.xlsx`, so
   * there is nothing to convert. Taking it apart and rebuilding it would drop
   * everything the model does not carry — the styling, the charts, the pivot
   * tables — for no gain, which is the round trip docs stopped doing.
   */
  it('stores a .xlsx export byte for byte, without rewriting it', async () => {
    const exported = workbookBytes('Total', 'SUM(1,2)');
    await run([
      sheet('Budget.xlsx', { format: 'xlsx', entry: takeoutEntry('Budget.xlsx', '', exported) }),
    ]);

    const bytes = driveAutosaveEncryptedBytes.mock.calls[0][1] as Uint8Array;
    expect([...bytes]).toEqual([...new Uint8Array(exported)]);
  });

  /**
   * A `.csv` has no workbook to keep, so one is written — by the same writer
   * the editor saves with, which is what makes the result a spreadsheet rather
   * than a grid of values.
   */
  it('writes a workbook for an export that is not one', async () => {
    await run([sheet('A.csv')]);

    const bytes = driveAutosaveEncryptedBytes.mock.calls[0][1] as Uint8Array;
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['A']);
    expect(wb.Sheets.A.A1).toMatchObject({ v: 'Name' });
    expect(wb.Sheets.A.B2).toMatchObject({ v: 2 });
  });

  /**
   * Excel rejects a tab name that is empty, over 31 characters, duplicated or
   * holds one of `[]:*?/\` — and a converted `.csv` is named after the file,
   * which is named by whoever made it. Repairing it is what stops one such file
   * failing the whole import.
   */
  it('repairs a tab name the workbook format will not take', async () => {
    await run([sheet('Q1 draft.csv', { title: 'Q1/Q2 [draft]' })]);

    const bytes = driveAutosaveEncryptedBytes.mock.calls[0][1] as Uint8Array;
    expect(XLSX.read(bytes, { type: 'array' }).SheetNames).toEqual(['Q1 Q2  draft']);
  });

  // Issue #95. This used to assert the opposite: that the run went ahead and
  // wrote every item as plaintext, on the reasoning that a half-imported
  // library is worse than a plaintext one. The cost was backwards — a plaintext
  // import is thousands of files with no key ref, none of which anything comes
  // back to encrypt, while a declined import can be re-run in full the moment
  // the vault is unlocked.
  it('imports nothing when the device has no key pair', async () => {
    loadKeyPair.mockReturnValue(null);
    const summary = await run([sheet('A.csv')]);

    expect(summary).toMatchObject({ imported: 0, unencrypted: true, cancelled: true });
    expect(sheetsApi.createSheet).not.toHaveBeenCalled();
    expect(encryptionApi.setFileKey).not.toHaveBeenCalled();
    expect(driveAutosaveEncryptedBytes).not.toHaveBeenCalled();
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

    expect((await savedContent()).sheets[0].cells.A2.raw).not.toMatch(/^=/);
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
