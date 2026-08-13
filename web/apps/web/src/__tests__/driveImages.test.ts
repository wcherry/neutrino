/**
 * Unit tests for the image-reference layer.
 *
 * Covers:
 *   - Building and parsing `neutrino-drive:` references
 *   - Attachments folder is reused when present, created when not, memoised
 *   - Local uploads and URL imports land in Attachments
 *   - A URL import blocked by CORS reports something actionable
 *   - Unencrypted images resolve to a download URL without being downloaded
 *   - Encrypted images are downloaded and decrypted, and cached across calls
 *   - Export inlining rewrites references to data URLs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listFolderContents = vi.fn();
const createFolder = vi.fn();
const uploadFile = vi.fn();
const downloadFile = vi.fn();
const getFileMetadata = vi.fn();
const getFileKey = vi.fn();

vi.mock('@/lib/api', () => ({
  storageApi: {
    uploadFile: (...a: unknown[]) => uploadFile(...a),
    downloadFile: (...a: unknown[]) => downloadFile(...a),
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    getFileDownloadUrl: (id: string) => `https://drive.test/files/${id}?token=t`,
  },
  filesystemApi: {
    getFolderContents: (...a: unknown[]) => listFolderContents(...a),
    createFolder: (...a: unknown[]) => createFolder(...a),
  },
  encryptionApi: { getFileKey: (...a: unknown[]) => getFileKey(...a) },
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  loadKeyPair: () => ({ publicKey: 'pk', secretKey: 'sk' }),
  decryptFileKey: () => 'dek',
  decryptFile: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
}));

import {
  ATTACHMENTS_FOLDER_NAME,
  clearDriveImageCache,
  driveImageRef,
  ensureAttachmentsFolder,
  importUrlAttachment,
  inlineDriveImagesInHtml,
  parseDriveImageRef,
  peekDriveImageUrl,
  resolveDriveImageUrl,
  uploadAttachment,
} from '@/lib/driveImages';

// `sub` is the user id the module reads for the Drive root and for key lookup.
function tokenFor(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

function driveFile(over: Record<string, unknown> = {}) {
  return {
    id: 'f1', name: 'photo.png', mimeType: 'image/png', sizeBytes: 1,
    folderId: null, isStarred: false, coverThumbnail: null, coverThumbnailMimeType: null,
    encryptedMetadata: null, contentVersion: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveImageCache();
  localStorage.setItem('access_token', tokenFor('user-1'));
  listFolderContents.mockResolvedValue({ folder: null, folders: [], files: [] });
  createFolder.mockResolvedValue({ id: 'attach-1', name: ATTACHMENTS_FOLDER_NAME });
  uploadFile.mockImplementation(async (file: File) => driveFile({ id: 'up-1', name: file.name }));
});

describe('image references', () => {
  it('round-trips a file id', () => {
    expect(parseDriveImageRef(driveImageRef('abc-123'))).toBe('abc-123');
  });

  it('treats anything that is not a reference as a plain src', () => {
    expect(parseDriveImageRef('https://example.test/a.png')).toBeNull();
    expect(parseDriveImageRef('data:image/png;base64,AAA')).toBeNull();
    expect(parseDriveImageRef(undefined)).toBeNull();
    expect(parseDriveImageRef('neutrino-drive:')).toBeNull();
  });

});

describe('Attachments folder', () => {
  it('reuses the folder the account already has', async () => {
    listFolderContents.mockResolvedValue({
      folder: null,
      folders: [{ id: 'existing', name: 'Attachments' }, { id: 'other', name: 'Photos' }],
      files: [],
    });

    await expect(ensureAttachmentsFolder()).resolves.toBe('existing');
    expect(createFolder).not.toHaveBeenCalled();
    // The Drive root is addressed by the user's own id.
    expect(listFolderContents).toHaveBeenCalledWith('user-1');
  });

  it('creates it for accounts that predate it', async () => {
    await expect(ensureAttachmentsFolder()).resolves.toBe('attach-1');
    expect(createFolder).toHaveBeenCalledWith({ name: 'Attachments' });
  });

  it('looks it up once per session', async () => {
    await ensureAttachmentsFolder();
    await ensureAttachmentsFolder();
    expect(listFolderContents).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure', async () => {
    listFolderContents.mockRejectedValueOnce(new Error('offline'));
    await expect(ensureAttachmentsFolder()).rejects.toThrow('offline');

    await expect(ensureAttachmentsFolder()).resolves.toBe('attach-1');
  });
});

describe('getting images into Drive', () => {
  it('uploads a local file into Attachments', async () => {
    const file = new File(['bytes'], 'holiday.png', { type: 'image/png' });
    await uploadAttachment(file);
    expect(uploadFile).toHaveBeenCalledWith(file, undefined, 'attach-1');
  });

  it('copies a linked image into Attachments, keeping its name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['bytes'], { type: 'image/png' }),
    }));

    await importUrlAttachment('https://example.test/pics/sunset.png?v=2');

    const [uploaded, , folderId] = uploadFile.mock.calls[0];
    expect((uploaded as File).name).toBe('sunset.png');
    expect(folderId).toBe('attach-1');
  });

  it('explains a cross-origin refusal instead of failing opaquely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(importUrlAttachment('https://example.test/a.png'))
      .rejects.toThrow(/doesn't allow images to be copied/);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects an address that is not an image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['<html>'], { type: 'text/html' }),
    }));

    await expect(importUrlAttachment('https://example.test/page'))
      .rejects.toThrow(/does not point at an image/);
  });

  it('falls back to a generic name when the URL has no usable path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['bytes'], { type: 'image/png' }),
    }));

    await importUrlAttachment('https://example.test/');

    expect((uploadFile.mock.calls[0][0] as File).name).toBe('image');
  });
});

describe('resolving a reference', () => {
  it('links an unencrypted image rather than downloading it', async () => {
    getFileMetadata.mockResolvedValue(driveFile({ id: 'plain-1' }));

    await expect(resolveDriveImageUrl('plain-1')).resolves.toBe('https://drive.test/files/plain-1?token=t');
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('downloads and decrypts an E2EE image', async () => {
    getFileMetadata.mockResolvedValue(driveFile({ id: 'enc-1', encryptedMetadata: 'blob' }));
    downloadFile.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
    getFileKey.mockResolvedValue({ encryptedFileKey: 'wrapped' });

    const url = await resolveDriveImageUrl('enc-1');

    expect(url.startsWith('blob:')).toBe(true);
    expect(downloadFile).toHaveBeenCalledWith('enc-1');
  });

  it('resolves each image once, however many surfaces render it', async () => {
    getFileMetadata.mockResolvedValue(driveFile({ id: 'enc-2', encryptedMetadata: 'blob' }));
    downloadFile.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
    getFileKey.mockResolvedValue({ encryptedFileKey: 'wrapped' });

    const [a, b] = await Promise.all([resolveDriveImageUrl('enc-2'), resolveDriveImageUrl('enc-2')]);
    const c = await resolveDriveImageUrl('enc-2');

    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it('exposes a resolved src synchronously for render paths', async () => {
    getFileMetadata.mockResolvedValue(driveFile({ id: 'plain-2' }));

    expect(peekDriveImageUrl('plain-2')).toBeUndefined();
    await resolveDriveImageUrl('plain-2');
    expect(peekDriveImageUrl('plain-2')).toBe('https://drive.test/files/plain-2?token=t');
  });

  it('lets a failed resolve be retried', async () => {
    getFileMetadata.mockRejectedValueOnce(new Error('locked'));
    await expect(resolveDriveImageUrl('flaky')).rejects.toThrow('locked');

    getFileMetadata.mockResolvedValue(driveFile({ id: 'flaky' }));
    await expect(resolveDriveImageUrl('flaky')).resolves.toContain('flaky');
  });
});

describe('inlining for export', () => {
  it('replaces references with data URLs and leaves other srcs alone', async () => {
    getFileMetadata.mockResolvedValue(driveFile({ id: 'exp-1', mimeType: 'image/png' }));
    downloadFile.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));

    const html = `<p><img src="${driveImageRef('exp-1')}"><img src="https://example.test/a.png"></p>`;
    const out = await inlineDriveImagesInHtml(html);

    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toContain('neutrino-drive:');
    expect(out).toContain('https://example.test/a.png');
  });

  it('leaves an unreadable image as a reference rather than failing the export', async () => {
    getFileMetadata.mockRejectedValue(new Error('gone'));

    const html = `<img src="${driveImageRef('missing')}">`;
    await expect(inlineDriveImagesInHtml(html)).resolves.toBe(html);
  });

  it('does no work for HTML with no references', async () => {
    const html = '<p><img src="data:image/png;base64,AAA"></p>';
    await expect(inlineDriveImagesInHtml(html)).resolves.toBe(html);
    expect(getFileMetadata).not.toHaveBeenCalled();
  });
});
