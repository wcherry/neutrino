/**
 * Tests for the Photos import runner (`lib/takeout/importPhotos.ts`).
 *
 * The API, crypto and thumbnail layers are mocked, as everywhere else in this
 * suite — what is under test is the sequencing: that a photo is uploaded
 * encrypted with a preview the server could not have made itself, that it is
 * registered with the date it was taken, that its albums are created once and
 * reused, and that one bad file doesn't abandon the rest of the library.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const albumsApi = {
  listAlbums: vi.fn(),
  createAlbum: vi.fn(),
  addPhoto: vi.fn(),
};
const photosApi = {
  registerPhoto: vi.fn(),
  updatePhoto: vi.fn(),
};
const filesystemApi = {
  getFolderContents: vi.fn(),
  createFolder: vi.fn(),
};
const storageApi = {
  uploadFile: vi.fn(),
  setImportMetadata: vi.fn(),
};
const uploadEncryptedFile = vi.fn();

vi.mock('@/lib/api', () => ({
  get albumsApi() { return albumsApi; },
  get photosApi() { return photosApi; },
  get filesystemApi() { return filesystemApi; },
  get storageApi() { return storageApi; },
  uploadEncryptedFile: (...args: unknown[]) => uploadEncryptedFile(...args),
  // The folder resolver (`lib/takeout/folders.ts`) uses this to address the
  // drive root — a user's root folder id is their own user id.
  getCurrentUserId: () => 'user-1',
}));

const generateThumbnail = vi.fn();
vi.mock('@neutrino/api-photos', () => ({
  generateThumbnail: (...args: unknown[]) => generateThumbnail(...args),
}));

const loadKeyPair = vi.fn();
vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn().mockResolvedValue(undefined),
  loadKeyPair: (...args: unknown[]) => loadKeyPair(...args),
  generateFileKey: () => new Uint8Array([1, 2, 3]),
  encryptFileKey: () => 'encrypted-dek',
  activeKeyVersion: () => 1,
  encryptMetadata: (metadata: unknown) => `encrypted:${JSON.stringify(metadata)}`,
}));

import { runPhotosImport, DEFAULT_PHOTOS_IMPORT_OPTIONS } from '@/lib/takeout/importPhotos';
import type { TakeoutPhoto } from '@/lib/takeout/photos';
import type { TakeoutEntry } from '@/lib/takeout/archive';

const KEY_PAIR = { publicKey: new Uint8Array([9]), secretKey: new Uint8Array([8]) };

const TAKEN = Date.UTC(2019, 7, 13, 12, 0, 0) / 1000;

function takeoutEntry(path: string, text = '', lastModified: Date | null = null): TakeoutEntry {
  return {
    path,
    fullPath: `Takeout/Google Photos/${path}`,
    ext: path.slice(path.lastIndexOf('.') + 1).toLowerCase(),
    size: 1024,
    lastModified,
    text: async () => text,
    blob: async () => new Blob(['bytes']),
  };
}

function photo(path: string, overrides: Partial<TakeoutPhoto> = {}): TakeoutPhoto {
  return {
    entry: takeoutEntry(path),
    kind: 'image',
    mimeType: 'image/jpeg',
    title: path.slice(path.lastIndexOf('/') + 1),
    albums: [],
    archived: false,
    trashed: false,
    ...overrides,
  };
}

/** A photo with the sidecar Google would have written beside it. */
function withInfo(path: string, info: Record<string, unknown>, overrides: Partial<TakeoutPhoto> = {}) {
  return photo(path, { info: takeoutEntry(`${path}.json`, JSON.stringify(info)), ...overrides });
}

const run = (photos: TakeoutPhoto[], options = {}) =>
  runPhotosImport({
    photos,
    options: { ...DEFAULT_PHOTOS_IMPORT_OPTIONS, folderName: null, skipExisting: false, ...options },
    userId: 'user-1',
  });

beforeEach(() => {
  vi.clearAllMocks();
  loadKeyPair.mockReturnValue(KEY_PAIR);
  generateThumbnail.mockResolvedValue('thumb-b64');
  uploadEncryptedFile.mockImplementation(async (file: File) => ({ id: `file-${file.name}` }));
  storageApi.uploadFile.mockImplementation(async (file: File) => ({ id: `file-${file.name}` }));
  photosApi.registerPhoto.mockImplementation(async ({ fileId }: { fileId: string }) => ({
    id: `photo-${fileId}`,
  }));
  photosApi.updatePhoto.mockResolvedValue({});
  albumsApi.listAlbums.mockResolvedValue({ albums: [] });
  albumsApi.createAlbum.mockImplementation(async ({ title }: { title: string }) => ({
    id: `album-${title}`,
    title,
  }));
  filesystemApi.getFolderContents.mockResolvedValue({ folders: [], files: [] });
  storageApi.setImportMetadata.mockResolvedValue({});
});

describe('runPhotosImport', () => {
  it('uploads each photo encrypted and registers it in Photos', async () => {
    const summary = await run([photo('Photos from 2019/IMG_1.jpg')]);

    expect(summary).toMatchObject({ total: 1, imported: 1, failed: 0 });
    const [file, , encryptedKey, encryptedMetadata, , folderId, thumbnail] =
      uploadEncryptedFile.mock.calls[0];
    expect((file as File).name).toBe('IMG_1.jpg');
    expect((file as File).type).toBe('image/jpeg');
    expect(encryptedKey).toBe('encrypted-dek');
    // The real name and type live in the encrypted metadata; the file row
    // itself only carries ciphertext.
    expect(encryptedMetadata).toContain('IMG_1.jpg');
    expect(folderId).toBeNull();
    expect(thumbnail).toBe('thumb-b64');
    expect(photosApi.registerPhoto).toHaveBeenCalledWith({
      fileId: 'file-IMG_1.jpg',
      captureDate: null,
    });
  });

  it('registers it with the date the photo was taken', async () => {
    await run([withInfo('a.jpg', { photoTakenTime: { timestamp: String(TAKEN) } })]);

    expect(photosApi.registerPhoto).toHaveBeenCalledWith({
      fileId: 'file-a.jpg',
      // Naive UTC, which is the only shape the endpoint parses.
      captureDate: '2019-08-13T12:00:00',
    });
  });

  // ── Dates (issue #110) ──────────────────────────────────────────────────

  /**
   * A photo with no sidecar is every picture that reached Drive rather than
   * Photos, and there are a lot of them. Registering those with no capture
   * date is what made the timeline one long undated block.
   */
  it('dates a photo with no sidecar from the zip entry', async () => {
    await run([photo('a.jpg', { entry: takeoutEntry('a.jpg', '', new Date('2019-08-13T12:00:00Z')) })]);

    expect(photosApi.registerPhoto).toHaveBeenCalledWith({
      fileId: 'file-a.jpg',
      captureDate: '2019-08-13T12:00:00',
    });
  });

  /**
   * `photoTakenTime` is when the shutter went; the zip entry's date is when
   * the export was built, at best. The sidecar has to win.
   */
  it('prefers the sidecar’s capture date over the zip entry’s', async () => {
    await run([
      withInfo('a.jpg', { photoTakenTime: { timestamp: String(TAKEN) } }, {
        entry: takeoutEntry('a.jpg', '', new Date('2024-01-01T00:00:00Z')),
      }),
    ]);

    expect(photosApi.registerPhoto).toHaveBeenCalledWith({
      fileId: 'file-a.jpg',
      captureDate: '2019-08-13T12:00:00',
    });
  });

  /**
   * The Drive row behind the photo is dated too, so the file sorts by when it
   * was taken in Drive as well as in the timeline.
   */
  it('dates the Drive file from when the photo was taken', async () => {
    await run([withInfo('a.jpg', { photoTakenTime: { timestamp: String(TAKEN) } })]);

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('file-a.jpg', {
      importSource: 'Takeout/Google Photos/a.jpg',
      createdAt: '2019-08-13T12:00:00Z',
      updatedAt: '2019-08-13T12:00:00Z',
    });
  });

  it('still counts the photo as imported when its dates cannot be recorded', async () => {
    storageApi.setImportMetadata.mockRejectedValue(new Error('nope'));

    const summary = await run([photo('a.jpg')]);

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
  });

  it('makes a preview for a picture but not for a video', async () => {
    await run([photo('a.jpg'), photo('b.mp4', { kind: 'video', mimeType: 'video/mp4' })]);

    expect(generateThumbnail).toHaveBeenCalledTimes(1);
    expect(uploadEncryptedFile.mock.calls[1][6]).toBeNull();
  });

  it('imports a picture the browser cannot decode, just without a preview', async () => {
    generateThumbnail.mockResolvedValue(null);
    const summary = await run([photo('a.heic', { mimeType: 'image/heic' })]);

    expect(summary.imported).toBe(1);
    expect(uploadEncryptedFile.mock.calls[0][6]).toBeNull();
  });

  it('restores the starred and archived state in one call', async () => {
    await run([withInfo('a.jpg', { favorited: true }, { archived: true })]);

    expect(photosApi.updatePhoto).toHaveBeenCalledWith('photo-file-a.jpg', {
      isStarred: true,
      isArchived: true,
    });
  });

  it('leaves an ordinary photo alone after registering it', async () => {
    await run([withInfo('a.jpg', { favorited: false })]);
    expect(photosApi.updatePhoto).not.toHaveBeenCalled();
  });

  it('recreates each album once and puts the photo in all of them', async () => {
    await run([
      photo('a.jpg', { albums: ['Rome', 'Favourites'] }),
      photo('b.jpg', { albums: ['Rome'] }),
    ]);

    expect(albumsApi.createAlbum.mock.calls.map(([body]) => body)).toEqual([
      { title: 'Rome' },
      { title: 'Favourites' },
    ]);
    expect(albumsApi.addPhoto.mock.calls).toEqual([
      ['album-Rome', 'photo-file-a.jpg'],
      ['album-Favourites', 'photo-file-a.jpg'],
      ['album-Rome', 'photo-file-b.jpg'],
    ]);
    // The existing albums are read once, on the first photo that needs one.
    expect(albumsApi.listAlbums).toHaveBeenCalledTimes(1);
  });

  it('reuses an album that already exists rather than making a second one', async () => {
    albumsApi.listAlbums.mockResolvedValue({ albums: [{ id: 'existing', title: 'rome' }] });
    await run([photo('a.jpg', { albums: ['Rome'] })]);

    expect(albumsApi.createAlbum).not.toHaveBeenCalled();
    expect(albumsApi.addPhoto).toHaveBeenCalledWith('existing', 'photo-file-a.jpg');
  });

  it('touches no album API at all when there are no albums to make', async () => {
    await run([photo('a.jpg')]);
    expect(albumsApi.listAlbums).not.toHaveBeenCalled();
  });

  it('imports the photos but not the albums when the user said not to', async () => {
    const summary = await run([photo('a.jpg', { albums: ['Rome'] })], { importAlbums: false });

    expect(summary.imported).toBe(1);
    expect(albumsApi.createAlbum).not.toHaveBeenCalled();
    expect(albumsApi.addPhoto).not.toHaveBeenCalled();
  });

  it('skips Google’s trash by default and says why', async () => {
    const summary = await run([photo('a.jpg', { trashed: true })]);

    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toMatch(/trash/i);
    expect(uploadEncryptedFile).not.toHaveBeenCalled();
  });

  it('imports the trash when asked', async () => {
    expect((await run([photo('a.jpg', { trashed: true })], { includeTrashed: true })).imported).toBe(1);
  });

  it('skips archived photos when the user turns them off', async () => {
    const summary = await run([photo('a.jpg', { archived: true })], { includeArchived: false });

    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(summary.items[0].reason).toMatch(/archived/i);
  });

  it('skips a file already in the destination, reading past the first page', async () => {
    // The listing is paged because a photo library is the one import that
    // really can run past a single page of files.
    const firstPage = Array.from({ length: 500 }, (_, i) => ({ name: `filler-${i}.jpg` }));
    filesystemApi.getFolderContents
      .mockResolvedValueOnce({ folders: [], files: firstPage })
      .mockResolvedValueOnce({ folders: [], files: [{ name: 'IMG_1.JPG' }] });

    const summary = await run([photo('IMG_1.jpg'), photo('new.jpg')], { skipExisting: true });

    expect(filesystemApi.getFolderContents.mock.calls[1][1]).toMatchObject({ offset: 500 });
    expect(summary).toMatchObject({ imported: 1, skipped: 1 });
    expect(summary.items[0]).toMatchObject({ title: 'IMG_1.jpg', status: 'skipped' });
  });

  it('uploads into the folder it was given', async () => {
    filesystemApi.createFolder.mockResolvedValue({ id: 'f1', name: 'Google Photos' });
    const summary = await run([photo('a.jpg')], { folderName: 'Google Photos' });

    expect(uploadEncryptedFile.mock.calls[0][5]).toBe('f1');
    expect(summary.folderId).toBe('f1');
  });

  it('uploads unencrypted and flags it when the device has no key pair', async () => {
    loadKeyPair.mockReturnValue(null);
    const summary = await run([photo('a.jpg')]);

    expect(summary).toMatchObject({ imported: 1, unencrypted: true });
    expect(uploadEncryptedFile).not.toHaveBeenCalled();
    expect(storageApi.uploadFile).toHaveBeenCalledTimes(1);
    expect(photosApi.registerPhoto).toHaveBeenCalledWith({ fileId: 'file-a.jpg', captureDate: null });
  });

  it('records a failure and carries on with the rest', async () => {
    uploadEncryptedFile.mockRejectedValueOnce(Object.assign(new Error('too big'), { statusCode: 413 }));
    const summary = await run([photo('a.jpg'), photo('b.jpg')]);

    expect(summary).toMatchObject({ imported: 1, failed: 1 });
    expect(summary.items[0]).toMatchObject({ title: 'a.jpg', status: 'failed', reason: 'HTTP 413: too big' });
    expect(summary.items[1].status).toBe('imported');
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await runPhotosImport({
      photos: [photo('a.jpg'), photo('b.jpg')],
      options: { ...DEFAULT_PHOTOS_IMPORT_OPTIONS, folderName: null, skipExisting: false },
      userId: 'user-1',
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1, 2]);
  });

  it('stops when the run is aborted', async () => {
    const controller = new AbortController();
    const summary = await runPhotosImport({
      photos: [photo('a.jpg'), photo('b.jpg')],
      options: { ...DEFAULT_PHOTOS_IMPORT_OPTIONS, folderName: null, skipExisting: false },
      userId: 'user-1',
      onProgress: () => controller.abort(),
      signal: controller.signal,
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.imported).toBe(1);
  });
});
