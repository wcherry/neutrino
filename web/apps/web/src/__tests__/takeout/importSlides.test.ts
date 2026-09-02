/**
 * Tests for the Slides import runner (`lib/takeout/importSlides.ts`).
 *
 * The API and crypto layers are mocked, as everywhere else in this suite —
 * what is under test is the sequencing: that the exported deck is stored as it
 * came out of the archive, that each presentation gets a DEK registered before
 * its ciphertext is uploaded, that the export's folder tree is recreated once
 * rather than per file, and that a failure on one file doesn't abandon the rest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const slidesApi = {
  listSlides: vi.fn(),
  createSlide: vi.fn(),
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
  get slidesApi() { return slidesApi; },
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

vi.mock('@neutrino/api-slides', () => ({ extractSlideText: (raw: string) => `text:${raw.length}` }));

// The index text is read back with the editor's own PowerPoint reader, which
// pulls JSZip and the whole parser; what this suite cares about is that it is
// handed the stored bytes and that a deck it cannot read costs the file its
// search text rather than its import.
const importFromPptx = vi.fn();
vi.mock('@/app/(apps)/slides/editor/pptxImport', () => ({
  importFromPptx: (...args: unknown[]) => importFromPptx(...args),
}));

import { runSlidesImport, DEFAULT_SLIDES_IMPORT_OPTIONS } from '@/lib/takeout/importSlides';
import type { DriveSlideEntry } from '@/lib/takeout/driveSlides';
import type { TakeoutEntry } from '@/lib/takeout/archive';

const KEY_PAIR = { publicKey: new Uint8Array([9]), secretKey: new Uint8Array([8]) };

/** Something shaped like a zip, which is what a `.pptx` is. */
const deckBytes = (tail = 1) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, tail]);

function takeoutEntry(path: string, bytes?: Uint8Array, lastModified: Date | null = null): TakeoutEntry {
  return {
    path,
    fullPath: `Takeout/Drive/${path}`,
    ext: path.slice(path.lastIndexOf('.') + 1),
    size: 0,
    lastModified,
    text: async () => '',
    // jsdom's Blob has no arrayBuffer() in this environment, and the runner
    // only ever asks for the bytes.
    blob: async () =>
      ({
        arrayBuffer: async () => (bytes ?? deckBytes()).slice().buffer,
      }) as unknown as Blob,
  };
}

/** A presentation in the export. */
function slide(path: string, overrides: Partial<DriveSlideEntry> = {}): DriveSlideEntry {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const slash = path.lastIndexOf('/');
  return {
    entry: takeoutEntry(path),
    format: 'pptx',
    title: base.slice(0, base.lastIndexOf('.')),
    path: slash === -1 ? [] : path.slice(0, slash).split('/'),
    ...overrides,
  };
}

const run = (slides: DriveSlideEntry[], options = {}) =>
  runSlidesImport({
    slides,
    options: { ...DEFAULT_SLIDES_IMPORT_OPTIONS, folderName: null, ...options },
    userId: 'user-1',
  });

beforeEach(() => {
  vi.clearAllMocks();
  loadKeyPair.mockReturnValue(KEY_PAIR);
  slidesApi.listSlides.mockResolvedValue({ slides: [] });
  slidesApi.createSlide.mockImplementation(async ({ title }: { title: string }) => ({ id: `id-${title}`, title }));
  filesystemApi.getFolderContents.mockResolvedValue({ folders: [], files: [] });
  storageApi.setImportMetadata.mockResolvedValue({});
  importFromPptx.mockResolvedValue({ slides: [{ elements: [], notes: '' }] });
});

describe('runSlidesImport', () => {
  it('creates a presentation per file and saves its deck', async () => {
    const summary = await run([slide('A.pptx'), slide('B.pptx')]);

    expect(summary).toMatchObject({ total: 2, imported: 2, skipped: 0, failed: 0 });
    expect(slidesApi.createSlide).toHaveBeenCalledWith({ title: 'A', folderId: null });
    expect(driveAutosaveEncryptedBytes).toHaveBeenCalledTimes(2);
  });

  /**
   * A Google Slides deck is exported *as* a `.pptx` and a presentation is
   * stored as a `.pptx`, so the import is a copy. Rebuilding it through the
   * editor's model would cost everything pptxgenjs cannot carry — themes,
   * transitions, gradient backgrounds — for nothing, which is the round trip
   * issue #169 took out of docs and sheets.
   */
  it('stores the exported deck byte for byte, without rewriting it', async () => {
    const exported = deckBytes(42);
    await run([slide('Kickoff.pptx', { entry: takeoutEntry('Kickoff.pptx', exported) })]);

    const [fileId, bytes, filename] = driveAutosaveEncryptedBytes.mock.calls[0];
    expect(fileId).toBe('id-Kickoff');
    expect(filename).toBe('Kickoff.pptx');
    expect([...(bytes as Uint8Array)]).toEqual([...exported]);
  });

  it('registers a DEK before uploading the ciphertext, as the editor does', async () => {
    await run([slide('A.pptx')]);

    expect(encryptionApi.setFileKey).toHaveBeenCalledWith('id-A', { encryptedFileKey: 'encrypted-dek', keyVersion: 1 });
    expect(encryptionApi.setFileKey.mock.invocationCallOrder[0]).toBeLessThan(
      driveAutosaveEncryptedBytes.mock.invocationCallOrder[0],
    );
  });

  // Issue #95: a declined import can be re-run in full the moment the vault is
  // unlocked; a plaintext one cannot be undone.
  it('imports nothing when the device has no key pair', async () => {
    loadKeyPair.mockReturnValue(null);
    const summary = await run([slide('A.pptx')]);

    expect(summary).toMatchObject({ imported: 0, unencrypted: true, cancelled: true });
    expect(slidesApi.createSlide).not.toHaveBeenCalled();
    expect(encryptionApi.setFileKey).not.toHaveBeenCalled();
    expect(driveAutosaveEncryptedBytes).not.toHaveBeenCalled();
  });

  // ── Dates (issue #110) ──────────────────────────────────────────────────

  it('gives a presentation the dates its sidecar recorded', async () => {
    const withSidecar = slide('A.pptx', {
      info: {
        ...takeoutEntry('A.pptx-info.json'),
        text: async () =>
          JSON.stringify({ created_date: '2014-03-01T12:00:00Z', modified_date: '2016-07-04T09:30:00Z' }),
      },
    });

    await run([withSidecar]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Drive/A.pptx',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  it('falls back to the zip entry’s own date when there is no sidecar', async () => {
    await run([
      slide('A.pptx', { entry: takeoutEntry('A.pptx', undefined, new Date('2014-03-01T12:00:00Z')) }),
    ]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('id-A', {
      importSource: 'Takeout/Drive/A.pptx',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2014-03-01T12:00:00.000Z',
    });
  });

  /**
   * Saving the body is what stamps the file with the current time, so dates
   * written before it would not survive the deck being saved.
   */
  it('records the dates after the body, not before', async () => {
    await run([slide('A.pptx')]);

    expect(storageApi.setImportMetadata.mock.invocationCallOrder[0]).toBeGreaterThan(
      driveAutosaveEncryptedBytes.mock.invocationCallOrder[0],
    );
  });

  it('still counts the presentation as imported when its dates cannot be recorded', async () => {
    storageApi.setImportMetadata.mockRejectedValue(new Error('nope'));

    expect(await run([slide('A.pptx')])).toMatchObject({ imported: 1, failed: 0 });
  });

  // ── Titles, folders and re-runs ─────────────────────────────────────────

  it('prefers the title in the metadata sidecar over the filename', async () => {
    const withInfo = slide('Q3_ kickoff(1).pptx', {
      info: { ...takeoutEntry('Q3.pptx-info.json'), text: async () => '{"title":"Q3: kickoff"}' },
    });
    const summary = await run([withInfo]);

    expect(slidesApi.createSlide).toHaveBeenCalledWith({ title: 'Q3: kickoff', folderId: null });
    expect(summary.items[0].title).toBe('Q3: kickoff');
    // The title is what the file is called on disk, extension and all.
    expect(driveAutosaveEncryptedBytes.mock.calls[0][2]).toBe('Q3: kickoff.pptx');
  });

  it('recreates the folders the presentations were in, once each', async () => {
    filesystemApi.createFolder.mockImplementation(async ({ name }: { name: string }) => ({ id: `f-${name}`, name }));
    await run([slide('Work/a.pptx'), slide('Work/b.pptx'), slide('Personal/c.pptx')], {
      folderName: 'Google Slides',
    });

    expect(filesystemApi.createFolder.mock.calls.map(([body]) => body)).toEqual([
      { name: 'Google Slides' },
      { name: 'Work', parentId: 'f-Google Slides' },
      { name: 'Personal', parentId: 'f-Google Slides' },
    ]);
    expect(slidesApi.createSlide).toHaveBeenCalledWith({ title: 'b', folderId: 'f-Work' });
  });

  it('puts everything in the destination folder when the tree is not wanted', async () => {
    filesystemApi.createFolder.mockResolvedValue({ id: 'f1', name: 'Google Slides' });
    const summary = await run([slide('Work/a.pptx')], { folderName: 'Google Slides', preserveFolders: false });

    expect(filesystemApi.createFolder).toHaveBeenCalledTimes(1);
    expect(slidesApi.createSlide).toHaveBeenCalledWith({ title: 'a', folderId: 'f1' });
    expect(summary.folderId).toBe('f1');
  });

  it('skips a title that already exists so a re-run makes no duplicates', async () => {
    slidesApi.listSlides.mockResolvedValue({ slides: [{ title: 'a' }] });
    const summary = await run([slide('A.pptx')]);

    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toMatch(/already exists/);
    expect(slidesApi.createSlide).not.toHaveBeenCalled();
  });

  it('imports over an existing title when the check is turned off', async () => {
    slidesApi.listSlides.mockResolvedValue({ slides: [{ title: 'A' }] });
    expect((await run([slide('A.pptx')], { skipExisting: false })).imported).toBe(1);
    expect(slidesApi.listSlides).not.toHaveBeenCalled();
  });

  // ── Search index ────────────────────────────────────────────────────────

  it('indexes each presentation by the text of the deck that was stored', async () => {
    await run([slide('A.pptx')]);

    expect(importFromPptx).toHaveBeenCalledTimes(1);
    expect((importFromPptx.mock.calls[0][0] as File).name).toBe('A.pptx');
    expect(indexOnSave).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'id-A', type: 'slide', title: 'A' }),
    );
  });

  /**
   * The deck is already saved by the time it is read back, so a file the
   * parser chokes on loses its full-text search, not its import — reporting a
   * stored file as a failed one invites a second import of the whole archive.
   */
  it('still imports a deck it cannot read back for the index', async () => {
    importFromPptx.mockRejectedValue(new Error('not a deck'));

    const summary = await run([slide('A.pptx')]);

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
    expect(indexOnSave).toHaveBeenCalledWith('user-1', expect.objectContaining({ id: 'id-A', content: '' }));
  });

  // ── Failures, progress and stopping ─────────────────────────────────────

  it('records a failure and carries on with the rest', async () => {
    slidesApi.createSlide.mockRejectedValueOnce(Object.assign(new Error('too big'), { statusCode: 413 }));
    const summary = await run([slide('A.pptx'), slide('B.pptx')]);

    expect(summary).toMatchObject({ imported: 1, failed: 1 });
    expect(summary.items[0]).toMatchObject({ title: 'A', status: 'failed', reason: 'HTTP 413: too big' });
    expect(summary.items[1].status).toBe('imported');
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await runSlidesImport({
      slides: [slide('A.pptx'), slide('B.pptx')],
      options: { ...DEFAULT_SLIDES_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1, 2]);
  });

  it('stops when the run is aborted', async () => {
    const controller = new AbortController();
    const summary = await runSlidesImport({
      slides: [slide('A.pptx'), slide('B.pptx')],
      options: { ...DEFAULT_SLIDES_IMPORT_OPTIONS, folderName: null },
      userId: 'user-1',
      onProgress: () => controller.abort(),
      signal: controller.signal,
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.imported).toBe(1);
  });
});
