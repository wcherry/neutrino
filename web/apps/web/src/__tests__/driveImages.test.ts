/**
 * Unit tests for the image-reference layer.
 *
 * Covers:
 *   - Building and parsing `neutrino-drive:` references
 *   - Attachments folder is reused when present, created when not, memoised
 *   - Local uploads and URL imports land in Attachments, encrypted
 *   - A locked session is refused rather than uploaded in the clear (#95)
 *   - A URL import blocked by CORS reports something actionable
 *   - Unencrypted images resolve to a download URL without being downloaded
 *   - Encrypted images are downloaded and decrypted, and cached across calls
 *   - Export inlining rewrites references to data URLs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listFolderContents = vi.fn();
const createFolder = vi.fn();
const uploadDriveFile = vi.fn();
const downloadFile = vi.fn();
const getFileMetadata = vi.fn();
const getFileKey = vi.fn();
const generateThumbnail = vi.fn();
/** null stands for a locked session — the branch that must refuse to write. */
let keyPair: { publicKey: string; secretKey: string } | null = null;

vi.mock('@/lib/api', () => ({
  storageApi: {
    downloadFile: (...a: unknown[]) => downloadFile(...a),
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    getFileDownloadUrl: (id: string) => `https://drive.test/files/${id}?token=t`,
  },
  filesystemApi: {
    getFolderContents: (...a: unknown[]) => listFolderContents(...a),
    createFolder: (...a: unknown[]) => createFolder(...a),
  },
  encryptionApi: { getFileKey: (...a: unknown[]) => getFileKey(...a) },
  // Stubbed at the boundary. What `uploadDriveFile` itself does — seal a DEK,
  // encrypt the metadata, generate a thumbnail, and throw rather than write
  // plaintext when the vault is locked — is covered in
  // `packages/api-drive/src/__tests__/encryptedWrites.test.ts`. What matters
  // here is that the attachment path goes through it at all, and into
  // Attachments.
  uploadDriveFile: (...a: unknown[]) => uploadDriveFile(...a),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  loadKeyPair: () => keyPair,
  openSealedFileKey: () => 'dek',
  decryptFile: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  generateFileKey: () => new Uint8Array([1, 2, 3]),
  encryptFileKey: () => 'sealed-dek',
  encryptMetadata: (meta: Record<string, unknown>) => `enc(${JSON.stringify(meta)})`,
}));

vi.mock('@neutrino/utils', () => ({
  generateThumbnail: (...a: unknown[]) => generateThumbnail(...a),
  // The phase marks are instrumentation, not behaviour: the stand-in runs the
  // work and reports nothing, so these tests keep asserting on what the code
  // does rather than on how it is measured.
  measurePhase: <T,>(_name: string, fn: () => Promise<T>) => fn(),
  measurePhaseSync: <T,>(_name: string, fn: () => T) => fn(),
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
  uploadDriveFile.mockImplementation(async (file: File) =>
    driveFile({ id: 'up-1', name: file.name, encryptedMetadata: 'enc' }),
  );
  generateThumbnail.mockResolvedValue('thumb-b64');
  keyPair = { publicKey: 'pk', secretKey: 'sk' };
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
  it('uploads a local file into Attachments through the encrypted uploader', async () => {
    const file = new File(['bytes'], 'holiday.png', { type: 'image/png' });
    await uploadAttachment(file);

    const [uploaded, userId, opts] = uploadDriveFile.mock.calls[0];
    expect(uploaded).toBe(file);
    expect(userId).toBe('user-1');
    expect((opts as { folderId: string }).folderId).toBe('attach-1');
  });

  // Issue #95. This used to assert the opposite — that a locked session fell
  // back to `storageApi.uploadFile` — on the reasoning that a stored image
  // beats a failed insert. It doesn't: an image uploaded in the clear has no
  // key ref, so nothing ever comes back to encrypt it, and the document's
  // illustrations sit readable in storage forever. Refusing costs the user one
  // unlock and nothing else.
  it('propagates the refusal when the session holds no key', async () => {
    uploadDriveFile.mockRejectedValueOnce(new Error('no-dek'));
    const file = new File(['bytes'], 'holiday.png', { type: 'image/png' });

    await expect(uploadAttachment(file)).rejects.toThrow('no-dek');
  });

  it('copies a linked image into Attachments, keeping its name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['bytes'], { type: 'image/png' }),
    }));

    await importUrlAttachment('https://example.test/pics/sunset.png?v=2');

    const [uploaded, , opts] = uploadDriveFile.mock.calls[0];
    expect((uploaded as File).name).toBe('sunset.png');
    expect((opts as { folderId: string }).folderId).toBe('attach-1');
  });

  it('explains a cross-origin refusal instead of failing opaquely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(importUrlAttachment('https://example.test/a.png'))
      .rejects.toThrow(/doesn't allow images to be copied/);
    expect(uploadDriveFile).not.toHaveBeenCalled();
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

    expect((uploadDriveFile.mock.calls[0][0] as File).name).toBe('image');
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
