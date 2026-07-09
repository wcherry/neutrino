import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileItem } from '@neutrino/api-drive';

// API modules are always mocked — no real HTTP in tests.
vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: { getRootContents: vi.fn() },
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

import { photosApi } from '../index';
import { filesystemApi } from '@neutrino/api-drive';
import { request } from '@neutrino/api-core';

const getRootContents = vi.mocked(filesystemApi.getRootContents);
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
    coverThumbnail: 'dGh1bWI=',
    coverThumbnailMimeType: 'image/jpeg',
    ...overrides,
  };
}

function rootContents(files: FileItem[]) {
  return { folder: null, folders: [], files, shortcuts: [] };
}

describe('photosApi.listPhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes the unfiltered listing to the Drive endpoint via type=photo', async () => {
    getRootContents.mockResolvedValue(rootContents([fileItem()]));

    await photosApi.listPhotos();

    expect(getRootContents).toHaveBeenCalledWith({ type: 'photo' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps Drive FileItems into PhotoResponses', async () => {
    getRootContents.mockResolvedValue(rootContents([fileItem()]));

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
        thumbnail: 'dGh1bWI=',
        thumbnailMimeType: 'image/jpeg',
        isStarred: true,
        isArchived: false,
        captureDate: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        metadata: null,
      },
    ]);
  });

  it('returns an empty list when the drive has no photos', async () => {
    getRootContents.mockResolvedValue(rootContents([]));

    const result = await photosApi.listPhotos();

    expect(result).toEqual({ photos: [], total: 0 });
  });

  it('keeps the starredOnly filter on the dedicated photos endpoint', async () => {
    mockRequest.mockResolvedValue({ photos: [], total: 0 });

    await photosApi.listPhotos({ starredOnly: true });

    expect(getRootContents).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/photos?starredOnly=true');
  });

  it('keeps the archivedOnly filter on the dedicated photos endpoint', async () => {
    mockRequest.mockResolvedValue({ photos: [], total: 0 });

    await photosApi.listPhotos({ archivedOnly: true });

    expect(getRootContents).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/photos?archivedOnly=true');
  });

  it('keeps person filters on the dedicated photos endpoint', async () => {
    mockRequest.mockResolvedValue({ photos: [], total: 0 });

    await photosApi.listPhotos({ personIds: ['p1', 'p2'], excludePersonIds: ['p3'] });

    expect(getRootContents).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/photos?personIds=p1%2Cp2&excludePersonIds=p3',
    );
  });

  it('treats empty person-id arrays as unfiltered and uses Drive', async () => {
    getRootContents.mockResolvedValue(rootContents([]));

    await photosApi.listPhotos({ personIds: [], excludePersonIds: [] });

    expect(getRootContents).toHaveBeenCalledWith({ type: 'photo' });
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
