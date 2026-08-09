/**
 * Tests for the Keep import runner (`lib/takeout/importKeep.ts`).
 *
 * The API and crypto layers are mocked, as everywhere else in this suite — what
 * is under test is the sequencing: which notes are skipped, that each one gets
 * a DEK registered before its ciphertext is uploaded, and that a failure on one
 * note doesn't abandon the rest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const notesApi = {
  listNotes: vi.fn(),
  createNote: vi.fn(),
  saveNote: vi.fn(),
};
const filesystemApi = {
  getRootContents: vi.fn(),
  createFolder: vi.fn(),
};
const encryptionApi = {
  setFileKey: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  get notesApi() { return notesApi; },
  get filesystemApi() { return filesystemApi; },
  get encryptionApi() { return encryptionApi; },
}));

const indexOnSave = vi.fn();
vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: (...args: unknown[]) => indexOnSave(...args) }));

const loadKeyPair = vi.fn();
vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn().mockResolvedValue(undefined),
  loadKeyPair: (...args: unknown[]) => loadKeyPair(...args),
  generateFileKey: () => new Uint8Array([1, 2, 3]),
  encryptFileKey: () => 'encrypted-dek',
  encryptFile: (bytes: Uint8Array) => bytes,
  toBase64url: (bytes: Uint8Array) => `b64:${new TextDecoder().decode(bytes)}`,
}));

vi.mock('@neutrino/api-notes', () => ({ extractNoteText: (raw: string) => raw }));

import { runKeepImport, findKeepNotes, DEFAULT_KEEP_IMPORT_OPTIONS } from '@/lib/takeout/importKeep';
import type { TakeoutArchive, TakeoutEntry } from '@/lib/takeout/archive';
import type { KeepNote } from '@/lib/takeout/keep';

const KEY_PAIR = { publicKey: new Uint8Array([9]), secretKey: new Uint8Array([8]) };

function entry(path: string, note: KeepNote | string): TakeoutEntry {
  return {
    path,
    fullPath: `Takeout/Keep/${path}`,
    ext: path.slice(path.lastIndexOf('.') + 1),
    size: 0,
    text: async () => (typeof note === 'string' ? note : JSON.stringify(note)),
    blob: async () => new Blob([]),
  };
}

function archiveOf(products: Record<string, TakeoutEntry[]>): TakeoutArchive {
  const list = Object.entries(products).map(([name, entries]) => ({ name, entries }));
  return {
    root: 'Takeout/',
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
  notesApi.listNotes.mockResolvedValue({ notes: [] });
  notesApi.createNote.mockImplementation(async ({ title }: { title: string }) => ({
    id: `id-${title}`,
    title,
  }));
  notesApi.saveNote.mockResolvedValue({ updatedAt: '2026-01-01T00:00:00Z' });
  filesystemApi.getRootContents.mockResolvedValue({ folders: [], files: [] });
});

describe('runKeepImport', () => {
  it('creates a note per Keep file and saves its content', async () => {
    const summary = await run([
      entry('a.json', { title: 'A', textContent: 'first' }),
      entry('b.json', { title: 'B', textContent: 'second' }),
    ]);

    expect(summary).toMatchObject({ total: 2, imported: 2, skipped: 0, failed: 0 });
    expect(notesApi.createNote).toHaveBeenCalledTimes(2);
    expect(notesApi.createNote).toHaveBeenCalledWith({ title: 'A', folderId: null });
    expect(notesApi.saveNote).toHaveBeenCalledTimes(2);
  });

  it('registers a DEK for each note and uploads base64url ciphertext', async () => {
    await run([entry('a.json', { title: 'A', textContent: 'first' })]);

    expect(encryptionApi.setFileKey).toHaveBeenCalledWith('id-A', { encryptedFileKey: 'encrypted-dek' });
    const [, body] = notesApi.saveNote.mock.calls[0];
    // The editor decodes with fromBase64url before decrypting, so the upload
    // has to be the base64url text and not raw bytes.
    expect(body.content).toMatch(/^b64:/);
    expect(JSON.parse(body.content.slice(4))[0]).toMatchObject({ type: 'paragraph', content: 'first' });
    // contentEncoding tells the server to decode this back to raw ciphertext
    // bytes before writing to storage — without it the base64url text itself
    // gets written verbatim and no reader can decrypt the note again.
    expect(body.contentEncoding).toBe('base64url');
  });

  it('sends an empty link list, since the server cannot read ciphertext', async () => {
    await run([entry('a.json', { title: 'A', textContent: 'x' })]);
    expect(notesApi.saveNote.mock.calls[0][1].linkedTitles).toEqual([]);
  });

  it('saves plaintext and flags it when the device has no key pair', async () => {
    loadKeyPair.mockReturnValue(null);
    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })]);

    expect(summary.unencrypted).toBe(true);
    expect(encryptionApi.setFileKey).not.toHaveBeenCalled();
    expect(notesApi.saveNote.mock.calls[0][1].content).not.toMatch(/^b64:/);
    expect(notesApi.saveNote.mock.calls[0][1].contentEncoding).toBeUndefined();
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
    notesApi.listNotes.mockResolvedValue({ notes: [{ title: 'a' }] });
    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })]);

    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toMatch(/already exists/);
    expect(notesApi.createNote).not.toHaveBeenCalled();
  });

  it('imports over an existing title when the check is turned off', async () => {
    notesApi.listNotes.mockResolvedValue({ notes: [{ title: 'A' }] });
    expect((await run([entry('a.json', { title: 'A', textContent: 'x' })], { skipExisting: false })).imported).toBe(1);
    expect(notesApi.listNotes).not.toHaveBeenCalled();
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
    notesApi.createNote.mockRejectedValueOnce(new Error('server exploded'));
    const summary = await run([
      entry('a.json', { title: 'A', textContent: 'x' }),
      entry('b.json', { title: 'B', textContent: 'y' }),
    ]);

    expect(summary).toMatchObject({ imported: 1, failed: 1 });
    expect(summary.items[0]).toMatchObject({ title: 'A', status: 'failed', reason: 'server exploded' });
    expect(summary.items[1].status).toBe('imported');
  });

  it('reuses a destination folder that already exists', async () => {
    filesystemApi.getRootContents.mockResolvedValue({ folders: [{ id: 'f1', name: 'google keep' }], files: [] });
    const summary = await run([entry('a.json', { title: 'A', textContent: 'x' })], { folderName: 'Google Keep' });

    expect(filesystemApi.createFolder).not.toHaveBeenCalled();
    expect(summary.folderId).toBe('f1');
    expect(notesApi.createNote).toHaveBeenCalledWith({ title: 'A', folderId: 'f1' });
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
