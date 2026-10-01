import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileItem } from '@neutrino/api-drive';

// API modules are always mocked — no real HTTP in tests.
vi.mock('@neutrino/api-drive', () => ({
  storageApi: { listFiles: vi.fn() },
}));

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  // Minimal stand-in that mirrors the real helper: drop empty values,
  // emit `?k=v&...` so we can assert the filtered path's URL.
  buildQuery: (params: Record<string, unknown>) => {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== '',
    );
    if (entries.length === 0) return '';
    return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  },
  ApiClientError: class ApiClientError extends Error {},
}));

import { photosApi, type PhotoResponse } from '../index';
import { storageApi } from '@neutrino/api-drive';
import { request } from '@neutrino/api-core';

const listFiles = vi.mocked(storageApi.listFiles);
const mockRequest = vi.mocked(request);

function fileItem(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'file-1',
    name: 'sunset.jpg',
    sizeBytes: 2048,
    mimeType: 'image/jpeg',
    folderId: null,
    isStarred: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    coverThumbnailUrl: '/api/v1/drive/files/file-1/thumbnail?v=1767312000000',
    ...overrides,
  };
}

function listing(items: FileItem[], total = items.length) {
  return { items, total, page: 1, pageSize: 200, totalPages: 1 };
}

function photoRecord(overrides: Partial<PhotoResponse> = {}): PhotoResponse {
  return {
    id: 'photo-1',
    fileId: 'file-1',
    fileName: 'sunset.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    contentUrl: '/api/v1/drive/files/file-1',
    thumbnailUrl: null,
    isStarred: false,
    isArchived: false,
    captureDate: '2019-06-27T13:02:16',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    deletedAt: null,
    metadata: null,
    ...overrides,
  };
}

describe('photosApi.ensureRegistered', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a registered photo straight through', async () => {
    const photo = photoRecord();
    expect(await photosApi.ensureRegistered(photo)).toBe(photo);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('registers a Drive-only picture by its file id and answers with the record', async () => {
    mockRequest.mockResolvedValue(photoRecord({ id: 'photo-new', fileId: 'file-7' }));

    const registered = await photosApi.ensureRegistered(
      { ...photoRecord({ id: 'file-7', fileId: 'file-7' }), isDriveOnly: true },
    );

    expect(mockRequest).toHaveBeenCalledWith('/api/v1/photos', {
      method: 'POST',
      body: JSON.stringify({ fileId: 'file-7' }),
    });
    expect(registered.id).toBe('photo-new');
  });
});

describe('photosApi.listPhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No file has a photo record unless a test says otherwise.
    mockRequest.mockResolvedValue({ photos: [], total: 0 });
  });

  /**
   * The listing is drive-wide, not root-scoped. It used to ask the root folder,
   * which made the library empty for anyone whose photos were filed anywhere
   * else — a Google Takeout import puts every picture under a `Google Photos`
   * folder, so a 2,500-photo library listed as nothing at all.
   */
  it('routes the unfiltered listing to the flat Drive listing via type=photo', async () => {
    listFiles.mockResolvedValue(listing([fileItem()]));

    await photosApi.listPhotos();

    expect(listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'photo' }),
    );
    expect(mockRequest).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/v1\/photos\?/));
  });

  /** A photo inside a folder is still the caller's photo. */
  it('lists photos that are not at the drive root', async () => {
    listFiles.mockResolvedValue(
      listing([fileItem({ id: 'filed', folderId: 'google-photos' })]),
    );

    const result = await photosApi.listPhotos();

    expect(result.photos.map((p) => p.id)).toEqual(['filed']);
  });

  /** `total` is the server's count of matches, not the page just returned. */
  it('reports the total the server counted, not the page length', async () => {
    listFiles.mockResolvedValue(listing([fileItem()], 2583));

    const result = await photosApi.listPhotos();

    expect(result.total).toBe(2583);
  });

  it('maps Drive FileItems into PhotoResponses', async () => {
    listFiles.mockResolvedValue(listing([fileItem()]));

    const result = await photosApi.listPhotos();

    expect(result.total).toBe(1);
    expect(result.photos).toEqual([
      {
        id: 'file-1',
        fileId: 'file-1',
        fileName: 'sunset.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        contentUrl: '/api/v1/drive/files/file-1',
        thumbnailUrl: '/api/v1/drive/files/file-1/thumbnail?v=1767312000000',
        isStarred: true,
        isArchived: false,
        captureDate: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        // A Drive listing only returns live files, so an adapted one is never
        // in the trash.
        deletedAt: null,
        metadata: null,
        isDriveOnly: true,
      },
    ]);
  });

  /**
   * A Drive file id is not a photo id. Every star, archive, trash and faces
   * request on this tab used to send the file id and get "Photo not found".
   */
  it('swaps each file for its photo record, so the item carries the photo id', async () => {
    listFiles.mockResolvedValue(listing([fileItem({ id: 'file-1' }), fileItem({ id: 'file-2' })]));
    mockRequest.mockResolvedValue({
      photos: [photoRecord({ id: 'photo-9', fileId: 'file-2' })],
      total: 1,
    });

    const result = await photosApi.listPhotos();

    expect(mockRequest).toHaveBeenCalledWith('/api/v1/photos/by-files', {
      method: 'POST',
      body: JSON.stringify({ fileIds: ['file-1', 'file-2'] }),
    });
    expect(result.photos.map((p) => [p.id, p.fileId, p.isDriveOnly ?? false])).toEqual([
      ['file-1', 'file-1', true],
      ['photo-9', 'file-2', false],
    ]);
  });

  /** The Drive listing knows nothing of archiving; the record does. */
  it('leaves archived photos out of the grid and out of the total', async () => {
    listFiles.mockResolvedValue(listing([fileItem({ id: 'live' }), fileItem({ id: 'shelved' })], 50));
    mockRequest.mockResolvedValue({
      photos: [photoRecord({ id: 'p-shelved', fileId: 'shelved', isArchived: true })],
      total: 1,
    });

    const result = await photosApi.listPhotos();

    expect(result.photos.map((p) => p.fileId)).toEqual(['live']);
    expect(result.total).toBe(49);
  });

  it('asks for records in chunks the server accepts', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `f${i}`);

    await photosApi.listPhotosByFiles(ids);

    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).fileIds.length);
    expect(bodies).toEqual([500, 500, 200]);
  });

  it('returns an empty list when the drive has no photos', async () => {
    listFiles.mockResolvedValue(listing([]));

    const result = await photosApi.listPhotos();

    expect(result).toEqual({ photos: [], total: 0 });
  });

  it('keeps the starredOnly filter on the dedicated photos endpoint', async () => {
    mockRequest.mockResolvedValue({ photos: [], total: 0 });

    await photosApi.listPhotos({ starredOnly: true });

    expect(listFiles).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/photos?starredOnly=true');
  });

  it('keeps the archivedOnly filter on the dedicated photos endpoint', async () => {
    mockRequest.mockResolvedValue({ photos: [], total: 0 });

    await photosApi.listPhotos({ archivedOnly: true });

    expect(listFiles).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/photos?archivedOnly=true');
  });

  it('keeps person filters on the dedicated photos endpoint', async () => {
    mockRequest.mockResolvedValue({ photos: [], total: 0 });

    await photosApi.listPhotos({ personIds: ['p1', 'p2'], excludePersonIds: ['p3'] });

    expect(listFiles).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/photos?personIds=p1%2Cp2&excludePersonIds=p3',
    );
  });

  it('treats empty person-id arrays as unfiltered and uses Drive', async () => {
    listFiles.mockResolvedValue(listing([]));

    await photosApi.listPhotos({ personIds: [], excludePersonIds: [] });

    expect(listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'photo' }),
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  /**
   * The motion half of a Live Photo is `video/%`, which the photo listing does
   * not return, and it is just as likely to be filed in a folder as its still.
   */
  it('fetches motion candidates drive-wide too', async () => {
    listFiles.mockResolvedValue(listing([]));

    await photosApi.listMotionCandidates();

    expect(listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video' }),
    );
  });
});
