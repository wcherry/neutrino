/**
 * Tests for the Docs import runner (`lib/takeout/importDocs.ts`).
 *
 * The API, crypto and OOXML layers are mocked, as everywhere else in this suite
 * — what is under test is the sequencing: that each document gets a DEK
 * registered before its ciphertext is uploaded, that the export's folder tree
 * is recreated once rather than per file, and that a failure on one document
 * doesn't abandon the rest.
 *
 * The one thing here that is about content rather than sequencing is which
 * bytes get stored: a `.docx` export is stored as itself and only `.html` and
 * `.txt` go through the writer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const docsApi = {
  listDocs: vi.fn(),
  createDoc: vi.fn(),
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
  get docsApi() { return docsApi; },
  get filesystemApi() { return filesystemApi; },
  get encryptionApi() { return encryptionApi; },
  get storageApi() { return storageApi; },
  driveAutosaveEncryptedBytes: (...args: unknown[]) => driveAutosaveEncryptedBytes(...args),
  // The folder resolver (`lib/takeout/folders.ts`) uses this to address the
  // drive root — a user's root folder id is their own user id.
  getCurrentUserId: () => 'user-1',
}));

// The OOXML writer and reader are the editor's own and are tested there
// (`__tests__/ooxml/docxRoundTrip.test.ts`, and `importDocsPackage.test.ts` for
// what this runner feeds them); what matters here is the model the writer is
// handed and that the reader is pointed at the stored bytes, so they stand in.
const writeDocx = vi.fn();
const readDocx = vi.fn();
vi.mock('@/lib/ooxml/docx/write', () => ({
  writeDocx: (...args: unknown[]) => writeDocx(...args),
}));
vi.mock('@/lib/ooxml/docx/read', () => ({
  readDocx: (...args: unknown[]) => readDocx(...args),
}));
vi.mock('@/lib/ooxml/docx/images', () => ({
  collectImageBytes: vi.fn(async () => new Map()),
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

vi.mock('@neutrino/api-docs', () => ({
  extractDocText: (raw: string) => `text:${raw.length}`,
  DEFAULT_PAGE_SETUP: { margin: 96, orientation: 'portrait', pageSize: 'letter' },
}));

import { runDocsImport, DEFAULT_DOCS_IMPORT_OPTIONS } from '@/lib/takeout/importDocs';
import type { DriveDocEntry } from '@/lib/takeout/driveDocs';
import type { TakeoutEntry } from '@/lib/takeout/archive';

const KEY_PAIR = { publicKey: new Uint8Array([9]), secretKey: new Uint8Array([8]) };

/** Stand-in for the bytes of an exported `.docx`, distinct per file. */
const EXPORTED_DOCX = (path: string) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, path.length]);

function takeoutEntry(
  path: string,
  text = '',
  lastModified: Date | null = null,
  bytes: Uint8Array = EXPORTED_DOCX(path),
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
    blob: async () => ({
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }) as unknown as Blob,
  };
}

function doc(path: string, overrides: Partial<DriveDocEntry> = {}): DriveDocEntry {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const slash = path.lastIndexOf('/');
  return {
    entry: takeoutEntry(path),
    format: 'docx',
    title: base.slice(0, base.lastIndexOf('.')),
    path: slash === -1 ? [] : path.slice(0, slash).split('/'),
    ...overrides,
  };
}

const run = (docs: DriveDocEntry[], options = {}) =>
  runDocsImport({
    docs,
    options: { ...DEFAULT_DOCS_IMPORT_OPTIONS, folderName: null, ...options },
    userId: 'user-1',
  });

/** The document model an `.html`/`.txt` export was written out from. */
const savedContent = (call = 0) => writeDocx.mock.calls[call][0].doc;

/** The bytes stored for one document. */
const savedBytes = (call = 0) => driveAutosaveEncryptedBytes.mock.calls[call][1] as Uint8Array;

beforeEach(() => {
  vi.clearAllMocks();
  writeDocx.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]));
  readDocx.mockResolvedValue({ doc: { type: 'doc', content: [] }, meta: null });
  loadKeyPair.mockReturnValue(KEY_PAIR);
  docsApi.listDocs.mockResolvedValue({ docs: [] });
  docsApi.createDoc.mockImplementation(async ({ title }: { title: string }) => ({ id: `id-${title}`, title }));
  filesystemApi.getFolderContents.mockResolvedValue({ folders: [], files: [] });
  storageApi.setImportMetadata.mockResolvedValue({});
});

describe('runDocsImport', () => {
  it('creates a document per file and saves its content', async () => {
    const summary = await run([doc('A.docx'), doc('B.docx')]);

    expect(summary).toMatchObject({ total: 2, imported: 2, skipped: 0, failed: 0 });
    expect(docsApi.createDoc).toHaveBeenCalledWith({ title: 'A', folderId: null });
    expect(driveAutosaveEncryptedBytes).toHaveBeenCalledTimes(2);
  });

  it('registers a DEK before uploading the ciphertext, as the editor does', async () => {
    await run([doc('A.docx')]);

    expect(encryptionApi.setFileKey).toHaveBeenCalledWith('id-A', { encryptedFileKey: 'encrypted-dek', keyVersion: 1 });
    expect(encryptionApi.setFileKey.mock.invocationCallOrder[0]).toBeLessThan(
      driveAutosaveEncryptedBytes.mock.invocationCallOrder[0],
    );
  });

  /**
   * Issue #169. A document is stored as a `.docx` now, and the editor opens
   * what it finds with `readDocx` — so an import that wrote the bespoke
   * `doc.json` body, through the string transport that would corrupt a zip
   * anyway, produced a library of documents that all failed to open.
   */
  it('stores the document as .docx bytes, not as doc.json', async () => {
    await run([doc('A.docx')]);

    const [fileId, bytes, filename] = driveAutosaveEncryptedBytes.mock.calls[0];
    expect(fileId).toBe('id-A');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(filename).toBe('A.docx');
  });

  /**
   * A Google Doc is exported *as* a `.docx` and stored as a `.docx`, so there
   * is nothing to convert. Taking it apart and rebuilding it — which is what
   * the mammoth → HTML → Tiptap → `writeDocx` chain amounted to — dropped every
   * colour, alignment, indent, header and footnote in the export on the way
   * through, for no gain.
   */
  it('stores a .docx export byte for byte, without rewriting it', async () => {
    await run([doc('A.docx')]);

    expect(writeDocx).not.toHaveBeenCalled();
    expect([...savedBytes()]).toEqual([...EXPORTED_DOCX('A.docx')]);
  });

  it('writes an .html export out as a .docx, since there is nothing else to do with it', async () => {
    await run([doc('A.html', { format: 'html', entry: takeoutEntry('A.html', '<h1>Title</h1>') })]);

    expect(savedContent().content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(writeDocx.mock.calls[0][1]).toMatchObject({ title: 'A' });
    expect([...savedBytes()]).toEqual([0x50, 0x4b, 0x03, 0x04, 0xff]);
  });

  /**
   * The index is built from the stored bytes, read back with the same reader
   * the editor opens them with — for a `.docx` export there is no conversion to
   * take the text from, and this way the index holds what the editor will show.
   */
  it('indexes a document by what the reader finds in the stored bytes', async () => {
    readDocx.mockResolvedValue({ doc: { type: 'doc', content: [] }, meta: null });
    await run([doc('A.docx')]);

    expect([...(readDocx.mock.calls[0][0] as Uint8Array)]).toEqual([...EXPORTED_DOCX('A.docx')]);
  });

  /**
   * The document is stored by the time the index is written, so a reader that
   * cannot parse it costs the document its full-text search and nothing else —
   * reporting a stored file as a failed one invites a second import of the
   * whole archive.
   */
  it('still counts the document as imported when it cannot be read back for the index', async () => {
    readDocx.mockRejectedValue(new Error('not a package'));

    const summary = await run([doc('A.docx')]);

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
    expect(indexOnSave).toHaveBeenCalledWith('user-1', expect.objectContaining({ id: 'id-A', content: '' }));
  });

  // Issue #95. This used to assert the opposite: that the run went ahead and
  // wrote every item as plaintext, on the reasoning that a half-imported
  // library is worse than a plaintext one. The cost was backwards — a plaintext
  // import is thousands of files with no key ref, none of which anything comes
  // back to encrypt, while a declined import can be re-run in full the moment
  // the vault is unlocked.
  it('imports nothing when the device has no key pair', async () => {
    loadKeyPair.mockReturnValue(null);
    const summary = await run([doc('A.docx')]);

    expect(summary).toMatchObject({ imported: 0, unencrypted: true, cancelled: true });
    expect(docsApi.createDoc).not.toHaveBeenCalled();
    expect(encryptionApi.setFileKey).not.toHaveBeenCalled();
    expect(driveAutosaveEncryptedBytes).not.toHaveBeenCalled();
  });

  // ── Dates (issue #110) ──────────────────────────────────────────────────

  /**
   * The sidecar is the best source: it is what Drive itself recorded, and the
   * zip entry beside it can be dated when the export was built.
   */
  it('gives a document the dates its sidecar recorded', async () => {
    const withSidecar = doc('A.docx', {
      info: takeoutEntry(
        'A.docx-info.json',
        JSON.stringify({ created_date: '2014-03-01T12:00:00Z', modified_date: '2016-07-04T09:30:00Z' }),
      ),
    });

    await run([withSidecar]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Drive/A.docx',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  it('falls back to the zip entry’s own date when there is no sidecar', async () => {
    await run([doc('A.docx', { entry: takeoutEntry('A.docx', '', new Date('2014-03-01T12:00:00Z')) })]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Drive/A.docx',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2014-03-01T12:00:00.000Z',
    });
  });

  /**
   * Saving the body is what stamps the file with the current time, so dates
   * written before it would not survive their own document being saved.
   */
  it('records the dates after the body, not before', async () => {
    await run([doc('A.docx')]);

    expect(storageApi.setImportMetadata.mock.invocationCallOrder[0]).toBeGreaterThan(
      driveAutosaveEncryptedBytes.mock.invocationCallOrder[0],
    );
  });

  /**
   * The content is already saved by then: a rejection here means a document
   * with the wrong dates, not one that failed to import.
   */
  it('still counts the document as imported when its dates cannot be recorded', async () => {
    storageApi.setImportMetadata.mockRejectedValue(new Error('nope'));

    const summary = await run([doc('A.docx')]);

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
  });

  it('adds each imported document to the search index', async () => {
    await run([doc('A.docx')]);
    expect(indexOnSave).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'id-A', type: 'document', title: 'A' }),
    );
  });

  it('converts a plain-text export line by line', async () => {
    await run([doc('A.txt', { format: 'text', entry: takeoutEntry('A.txt', 'one\ntwo') })]);
    expect(savedContent().content).toHaveLength(2);
  });

  it('prefers the title in the metadata sidecar over the filename', async () => {
    const withInfo = doc('Q3_ plan(1).docx', { info: takeoutEntry('Q3.docx-info.json', '{"title":"Q3: plan"}') });
    const summary = await run([withInfo]);

    expect(docsApi.createDoc).toHaveBeenCalledWith({ title: 'Q3: plan', folderId: null });
    expect(summary.items[0].title).toBe('Q3: plan');
  });

  it('flattens a title Drive could not store in a filename', async () => {
    await run([doc('a.docx', { info: takeoutEntry('a.docx-info.json', '{"title":"one/two"}') })]);
    expect(docsApi.createDoc).toHaveBeenCalledWith({ title: 'one-two', folderId: null });
  });

  it('recreates the folders the documents were in, once each', async () => {
    filesystemApi.createFolder.mockImplementation(async ({ name }: { name: string }) => ({ id: `f-${name}`, name }));
    await run([doc('Work/a.docx'), doc('Work/b.docx'), doc('Personal/c.docx')], { folderName: 'Google Docs' });

    expect(filesystemApi.createFolder.mock.calls.map(([body]) => body)).toEqual([
      { name: 'Google Docs' },
      { name: 'Work', parentId: 'f-Google Docs' },
      { name: 'Personal', parentId: 'f-Google Docs' },
    ]);
    expect(docsApi.createDoc).toHaveBeenCalledWith({ title: 'b', folderId: 'f-Work' });
  });

  it('puts everything in the destination folder when the tree is not wanted', async () => {
    filesystemApi.createFolder.mockResolvedValue({ id: 'f1', name: 'Google Docs' });
    const summary = await run([doc('Work/a.docx')], { folderName: 'Google Docs', preserveFolders: false });

    expect(filesystemApi.createFolder).toHaveBeenCalledTimes(1);
    expect(docsApi.createDoc).toHaveBeenCalledWith({ title: 'a', folderId: 'f1' });
    expect(summary.folderId).toBe('f1');
  });

  it('reuses a destination folder that already exists', async () => {
    filesystemApi.getFolderContents.mockResolvedValue({ folders: [{ id: 'f1', name: 'google docs' }], files: [] });
    const summary = await run([doc('a.docx')], { folderName: 'Google Docs' });

    expect(filesystemApi.createFolder).not.toHaveBeenCalled();
    expect(summary.folderId).toBe('f1');
  });

  it('skips a title that already exists so a re-run makes no duplicates', async () => {
    docsApi.listDocs.mockResolvedValue({ docs: [{ title: 'a' }] });
    const summary = await run([doc('A.docx')]);

    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toMatch(/already exists/);
    expect(docsApi.createDoc).not.toHaveBeenCalled();
  });

  it('imports over an existing title when the check is turned off', async () => {
    docsApi.listDocs.mockResolvedValue({ docs: [{ title: 'A' }] });
    expect((await run([doc('A.docx')], { skipExisting: false })).imported).toBe(1);
    expect(docsApi.listDocs).not.toHaveBeenCalled();
  });

  it('records a failure and carries on with the rest', async () => {
    // An entry that cannot be inflated out of the zip — a corrupt archive is
    // the one failure that reaches this runner before anything is written.
    const broken = doc('A.docx');
    broken.entry = { ...broken.entry, blob: async () => { throw new Error('not a docx'); } };
    const summary = await run([broken, doc('B.docx')]);

    expect(summary).toMatchObject({ imported: 1, failed: 1 });
    expect(summary.items[0]).toMatchObject({ title: 'A', status: 'failed', reason: 'not a docx' });
    expect(summary.items[1].status).toBe('imported');
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await runDocsImport({
      docs: [doc('A.docx'), doc('B.docx')],
      options: { ...DEFAULT_DOCS_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1, 2]);
  });

  it('stops when the run is aborted', async () => {
    const controller = new AbortController();
    const summary = await runDocsImport({
      docs: [doc('A.docx'), doc('B.docx')],
      options: { ...DEFAULT_DOCS_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: () => controller.abort(),
      signal: controller.signal,
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.imported).toBe(1);
  });
});
