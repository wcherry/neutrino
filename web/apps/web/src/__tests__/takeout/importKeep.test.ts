/**
 * Tests for the Keep import runner (`lib/takeout/importKeep.ts`).
 *
 * The API and crypto layers are mocked, as everywhere else in this suite — what
 * is under test is the sequencing: which notes are skipped, that each one gets
 * a DEK registered before its ciphertext is uploaded, and that a failure on one
 * note doesn't abandon the rest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createNote = vi.fn();
const listAllNotes = vi.fn();
const extractNoteText = vi.fn((raw: string) => raw);

vi.mock('@/lib/noteFiles', () => ({
  createNote: (...args: unknown[]) => createNote(...args),
  listAllNotes: (...args: unknown[]) => listAllNotes(...args),
  extractNoteText: (...args: [string]) => extractNoteText(...args),
}));

const driveAutosaveContent = vi.fn();
const driveAutosaveEncryptedContent = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  driveAutosaveContent: (...args: unknown[]) => driveAutosaveContent(...args),
  driveAutosaveEncryptedContent: (...args: unknown[]) => driveAutosaveEncryptedContent(...args),
}));

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

vi.mock('@/lib/api', () => ({
  get filesystemApi() { return filesystemApi; },
  get encryptionApi() { return encryptionApi; },
  get storageApi() { return storageApi; },
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

import { runKeepImport, findKeepNotes, DEFAULT_KEEP_IMPORT_OPTIONS } from '@/lib/takeout/importKeep';
import type { TakeoutArchive, TakeoutEntry } from '@/lib/takeout/archive';
import type { KeepNote } from '@/lib/takeout/keep';

const KEY_PAIR = { publicKey: new Uint8Array([9]), secretKey: new Uint8Array([8]) };

function entry(path: string, note: KeepNote | string, lastModified: Date | null = null): TakeoutEntry {
  return {
    path,
    fullPath: `Takeout/Keep/${path}`,
    ext: path.slice(path.lastIndexOf('.') + 1),
    size: 0,
    lastModified,
    text: async () => (typeof note === 'string' ? note : JSON.stringify(note)),
    blob: async () => new Blob([]),
  };
}

function archiveOf(products: Record<string, TakeoutEntry[]>): TakeoutArchive {
  const list = Object.entries(products).map(([name, entries]) => ({ name, entries }));
  return {
    root: 'Takeout/',
    partCount: 1,
    products: list,
    product: (name) => list.find((p) => p.name.toLowerCase() === name.toLowerCase()),
    close: async () => {},
  };
}

const run = (entries: TakeoutEntry[], options = {}) =>
  runKeepImport({
    entries,
    options: { ...DEFAULT_KEEP_IMPORT_OPTIONS, folderName: null, ...options },
    userId: 'user-1',
  });

beforeEach(() => {
  vi.clearAllMocks();
  loadKeyPair.mockReturnValue(KEY_PAIR);
  listAllNotes.mockResolvedValue([]);
  createNote.mockImplementation(async (title: string) => ({
    id: `id-${title}`,
    name: title,
  }));
  driveAutosaveContent.mockResolvedValue({ updatedAt: '2026-01-01T00:00:00Z' });
  driveAutosaveEncryptedContent.mockResolvedValue({ updatedAt: '2026-01-01T00:00:00Z' });
  filesystemApi.getFolderContents.mockResolvedValue({ folders: [], files: [] });
  storageApi.setImportMetadata.mockResolvedValue({});
});

describe('runKeepImport', () => {
  it('creates a note per Keep file and saves its content', async () => {
    const summary = await run([
      entry('a.json', { title: 'A', textContent: 'first' }),
      entry('b.json', { title: 'B', textContent: 'second' }),
    ]);

    expect(summary).toMatchObject({ total: 2, imported: 2, skipped: 0, failed: 0 });
    expect(createNote).toHaveBeenCalledTimes(2);
    expect(createNote).toHaveBeenCalledWith('A', null);
    expect(driveAutosaveEncryptedContent).toHaveBeenCalledTimes(2);
  });

  // ── Dates (issue #110) ──────────────────────────────────────────────────

  /**
   * Keep records both timestamps on every note, in microseconds — the most
   * complete dates of any product in the export, and the reason a Keep note
   * should never end up dated to the day it was imported.
   */
  it('gives a note the created and edited dates Keep recorded', async () => {
    await run([
      entry('a.json', {
        title: 'A',
        textContent: 'first',
        createdTimestampUsec: 1393675200000000,
        userEditedTimestampUsec: 1467624600000000,
      }),
    ]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Keep/a.json',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  /**
   * Microseconds read as seconds would date the note to the year 46,138 —
   * `isoFromEpoch` takes the unit as a parameter for exactly this reason.
   */
  it('does not mistake Keep’s microseconds for seconds', async () => {
    await run([entry('a.json', { title: 'A', textContent: 'x', createdTimestampUsec: 1393675200000000 })]);

    const { createdAt } = storageApi.setImportMetadata.mock.calls[0][1];
    expect(new Date(createdAt).getUTCFullYear()).toBe(2014);
  });

  it('falls back to the zip entry’s date for a note with no timestamps', async () => {
    await run([entry('a.json', { title: 'A', textContent: 'x' }, new Date('2014-03-01T12:00:00Z'))]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Keep/a.json',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2014-03-01T12:00:00.000Z',
    });
  });

  it('still counts the note as imported when its dates cannot be recorded', async () => {
    storageApi.setImportMetadata.mockRejectedValue(new Error('nope'));

    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })]);

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
  });

  it('registers a DEK for each note and uploads the plaintext content encrypted', async () => {
    await run([entry('a.json', { title: 'A', textContent: 'first' })]);

    expect(encryptionApi.setFileKey).toHaveBeenCalledWith('id-A', { encryptedFileKey: 'encrypted-dek', keyVersion: 1 });
    expect(driveAutosaveEncryptedContent).toHaveBeenCalledTimes(1);
    const [noteId, content, filename, dek] = driveAutosaveEncryptedContent.mock.calls[0];
    expect(noteId).toBe('id-A');
    expect(filename).toBe('note.json');
    expect(dek).toEqual(new Uint8Array([1, 2, 3]));
    // The content passed in is plaintext — driveAutosaveEncryptedContent does
    // the encrypting itself, so the import never handles ciphertext directly.
    expect(JSON.parse(content)[0]).toMatchObject({ type: 'paragraph', content: 'first' });
  });

  it('saves plaintext (unencrypted) when the device has no key pair', async () => {
    loadKeyPair.mockReturnValue(null);
    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })]);

    expect(summary.unencrypted).toBe(true);
    expect(encryptionApi.setFileKey).not.toHaveBeenCalled();
    expect(driveAutosaveEncryptedContent).not.toHaveBeenCalled();
    expect(driveAutosaveContent).toHaveBeenCalledTimes(1);
    const [noteId, content, filename] = driveAutosaveContent.mock.calls[0];
    expect(noteId).toBe('id-A');
    expect(filename).toBe('note.json');
    expect(JSON.parse(content)[0]).toMatchObject({ type: 'paragraph', content: 'x' });
  });

  it('adds each imported note to the search index', async () => {
    await run([entry('a.json', { title: 'A', textContent: 'x' })]);
    expect(indexOnSave).toHaveBeenCalledWith('user-1', expect.objectContaining({ id: 'id-A', type: 'note', title: 'A' }));
  });

  it('skips trashed notes by default and imports them when asked', async () => {
    const trashed = [entry('a.json', { title: 'A', textContent: 'x', isTrashed: true })];

    expect(await run(trashed)).toMatchObject({ imported: 0, skipped: 1 });
    expect((await run(trashed, { includeTrashed: true })).imported).toBe(1);
  });

  it('imports archived notes by default and skips them when asked', async () => {
    const archived = [entry('a.json', { title: 'A', textContent: 'x', isArchived: true })];

    expect((await run(archived)).imported).toBe(1);
    expect(await run(archived, { includeArchived: false })).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('skips a title that already exists so a re-run makes no duplicates', async () => {
    listAllNotes.mockResolvedValue([{ id: 'x', title: 'a', updatedAt: '2026-01-01T00:00:00Z' }]);
    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })]);

    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toMatch(/already exists/);
    expect(createNote).not.toHaveBeenCalled();
  });

  it('imports over an existing title when the check is turned off', async () => {
    listAllNotes.mockResolvedValue([{ id: 'x', title: 'A', updatedAt: '2026-01-01T00:00:00Z' }]);
    expect((await run([entry('a.json', { title: 'A', textContent: 'x' })], { skipExisting: false })).imported).toBe(1);
    expect(listAllNotes).not.toHaveBeenCalled();
  });

  it('still imports two Keep notes that share a title', async () => {
    const summary = await run([
      entry('a.json', { title: 'Same', textContent: 'one' }),
      entry('b.json', { title: 'Same', textContent: 'two' }),
    ]);
    expect(summary.imported).toBe(2);
  });

  it('skips files in the folder that are not Keep notes', async () => {
    const summary = await run([entry('Labels.txt', 'work\nideas')]);
    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toBe('Not a Keep note');
  });

  it('records a failure and carries on with the rest', async () => {
    createNote.mockRejectedValueOnce(new Error('server exploded'));
    const summary = await run([
      entry('a.json', { title: 'A', textContent: 'x' }),
      entry('b.json', { title: 'B', textContent: 'y' }),
    ]);

    expect(summary).toMatchObject({ imported: 1, failed: 1 });
    expect(summary.items[0]).toMatchObject({ title: 'A', status: 'failed', reason: 'server exploded' });
    expect(summary.items[1].status).toBe('imported');
  });

  it('reuses a destination folder that already exists', async () => {
    filesystemApi.getFolderContents.mockResolvedValue({ folders: [{ id: 'f1', name: 'google keep' }], files: [] });
    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })], { folderName: 'Google Keep' });

    expect(filesystemApi.createFolder).not.toHaveBeenCalled();
    expect(summary.folderId).toBe('f1');
    expect(createNote).toHaveBeenCalledWith('A', 'f1');
  });

  it('creates the destination folder when it is missing', async () => {
    filesystemApi.createFolder.mockResolvedValue({ id: 'f2', name: 'Google Keep' });
    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })], { folderName: 'Google Keep' });

    expect(filesystemApi.createFolder).toHaveBeenCalledWith({ name: 'Google Keep' });
    expect(summary.folderId).toBe('f2');
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await runKeepImport({
      entries: [entry('a.json', { title: 'A', textContent: 'x' }), entry('b.json', { title: 'B', textContent: 'y' })],
      options: { ...DEFAULT_KEEP_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1, 2]);
  });

  it('stops when the run is aborted', async () => {
    const controller = new AbortController();
    const summary = await runKeepImport({
      entries: [entry('a.json', { title: 'A', textContent: 'x' }), entry('b.json', { title: 'B', textContent: 'y' })],
      options: { ...DEFAULT_KEEP_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: () => controller.abort(),
      signal: controller.signal,
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.imported).toBe(1);
  });
});

describe('findKeepNotes', () => {
  it('finds the Keep folder and returns only its JSON', async () => {
    const found = await findKeepNotes(
      archiveOf({ Keep: [entry('a.json', { title: 'A', textContent: 'x' }), entry('a.html', 'x')] }),
    );
    expect(found).toMatchObject({ directory: 'Keep' });
    expect(found!.entries.map((e) => e.path)).toEqual(['a.json']);
  });

  it('recognises a Keep folder Google localised, by its contents', async () => {
    const found = await findKeepNotes(archiveOf({ Notizen: [entry('a.json', { title: 'A', textContent: 'x' })] }));
    expect(found).toMatchObject({ directory: 'Notizen' });
  });

  it('returns null when the archive has no Keep notes', async () => {
    const found = await findKeepNotes(archiveOf({ Calendar: [entry('a.ics', 'BEGIN:VCALENDAR')] }));
    expect(found).toBeNull();
  });
});
