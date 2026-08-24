/**
 * Unit tests for the app-level InsertImageDialog — the wrapper that supplies
 * the Drive plumbing to the shared @neutrino/ui image picker.
 *
 * Covers:
 *   - Only image files from the Drive listing are offered
 *   - Stored cover thumbnails are used for the browse grid
 *   - Paging past a full page of documents to reach the images behind it
 *   - Every source yields a driveFileId, so the caller can store a reference
 *   - Local files and linked images are uploaded into Attachments
 *   - An encrypted image is decrypted for preview; a locked keychain is reported
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { InsertImageDialog } from '@/components/InsertImageDialog';
import { clearDriveImageCache } from '@/lib/driveImages';

const listFiles = vi.fn();
const uploadDriveFile = vi.fn();
const downloadFile = vi.fn();
const getFileMetadata = vi.fn();
const getFileKey = vi.fn();
const getFolderContents = vi.fn();
const createFolder = vi.fn();

vi.mock('@/lib/api', () => ({
  storageApi: {
    listFiles: (...a: unknown[]) => listFiles(...a),
    downloadFile: (...a: unknown[]) => downloadFile(...a),
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    getFileDownloadUrl: (id: string) => `https://drive.test/files/${id}?token=t`,
  },
  filesystemApi: {
    getFolderContents: (...a: unknown[]) => getFolderContents(...a),
    createFolder: (...a: unknown[]) => createFolder(...a),
  },
  encryptionApi: { getFileKey: (...a: unknown[]) => getFileKey(...a) },
  // Every upload goes through the encrypted uploader now; the plaintext
  // `storageApi.uploadFile` this used to stub no longer exists (issue #95).
  uploadDriveFile: (...a: unknown[]) => uploadDriveFile(...a),
}));

const loadKeyPair = vi.fn(() => ({ publicKey: 'pk', secretKey: 'sk' }));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  loadKeyPair: () => loadKeyPair(),
  openSealedFileKey: () => 'dek',
  decryptFile: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
}));

function driveFile(over: Record<string, unknown>) {
  return {
    id: 'x', name: 'x', mimeType: 'image/png', sizeBytes: 1, folderId: null, isStarred: false,
    coverThumbnail: null, coverThumbnailMimeType: null, encryptedMetadata: null, contentVersion: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function tokenFor(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

const insertButton = () => screen.getByRole('button', { name: /^Insert$/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveImageCache();
  localStorage.setItem('access_token', tokenFor('user-1'));
  listFiles.mockResolvedValue({
    items: [
      driveFile({ id: 'img-1', name: 'poster.png', mimeType: 'image/png' }),
      driveFile({ id: 'img-2', name: 'scan.jpg', mimeType: 'image/jpeg', coverThumbnail: 'AAA', coverThumbnailMimeType: 'image/jpeg' }),
      driveFile({ id: 'doc-1', name: 'report.pdf', mimeType: 'application/pdf' }),
    ],
    total: 3, page: 1, pageSize: 50, totalPages: 1,
  });
  getFileMetadata.mockImplementation(async (id: string) => driveFile({ id }));
  getFolderContents.mockResolvedValue({ folder: null, folders: [{ id: 'attach-1', name: 'Attachments' }], files: [] });
  uploadDriveFile.mockImplementation(async (file: File) => driveFile({ id: 'up-1', name: file.name }));
});

describe('InsertImageDialog', () => {
  it('offers only the image files in the caller’s Drive', async () => {
    render(<InsertImageDialog onInsert={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByTitle('poster.png')).toBeInTheDocument();
    expect(screen.getByTitle('scan.jpg')).toBeInTheDocument();
    expect(screen.queryByTitle('report.pdf')).not.toBeInTheDocument();
  });

  it('browses via stored cover thumbnails, falling back to the full image', async () => {
    render(<InsertImageDialog onInsert={vi.fn()} onClose={vi.fn()} />);

    const withThumb = (await screen.findByTitle('scan.jpg')).querySelector('img')!;
    const withoutThumb = screen.getByTitle('poster.png').querySelector('img')!;

    expect(withThumb.getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
    expect(withoutThumb.getAttribute('src')).toBe('https://drive.test/files/img-1?token=t');
  });

  it('pages past a full page of non-images to reach the images behind it', async () => {
    const documents = Array.from({ length: 200 }, (_, i) =>
      driveFile({ id: `doc-${i}`, name: `note-${i}.txt`, mimeType: 'application/x-neutrino-note' }));
    listFiles.mockReset();
    listFiles
      .mockResolvedValueOnce({ items: documents, total: 200, page: 1, pageSize: 200, totalPages: 1 })
      .mockResolvedValueOnce({
        items: [driveFile({ id: 'img-late', name: 'buried.png', mimeType: 'image/png' })],
        total: 1, page: 2, pageSize: 200, totalPages: 1,
      });

    render(<InsertImageDialog onInsert={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByTitle('buried.png')).toBeInTheDocument();
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(listFiles.mock.calls[1][0]).toMatchObject({ offset: 200 });
  });

  it('returns the Drive file id so the caller can store a reference', async () => {
    const onInsert = vi.fn();
    render(<InsertImageDialog onInsert={onInsert} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTitle('poster.png'));
    fireEvent.load(await screen.findByAltText('Selected image preview'));
    fireEvent.click(insertButton());

    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({
      source: 'drive',
      driveFileId: 'img-1',
    }));
    // Unencrypted, so the preview is the download URL and nothing was fetched.
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('uploads a local file into Attachments and returns its id', async () => {
    const onInsert = vi.fn();
    render(<InsertImageDialog defaultSource="local" onInsert={onInsert} onClose={vi.fn()} />);

    const file = new File(['bytes'], 'holiday.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-picker-file-input'), { target: { files: [file] } });
    fireEvent.load(await screen.findByAltText('Selected image preview'));
    fireEvent.click(insertButton());

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({
      source: 'local',
      driveFileId: 'up-1',
    })));
    expect((uploadDriveFile.mock.calls[0][2] as { folderId: string }).folderId).toBe('attach-1');
  });

  it('copies a linked image into Attachments and returns its id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['bytes'], { type: 'image/png' }),
    }));
    const onInsert = vi.fn();
    render(<InsertImageDialog defaultSource="url" onInsert={onInsert} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Image address'), {
      target: { value: 'https://example.test/sunset.png' },
    });
    fireEvent.load(await screen.findByAltText('Selected image preview'));
    fireEvent.click(insertButton());

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({
      source: 'url',
      driveFileId: 'up-1',
    })));
    expect((uploadDriveFile.mock.calls[0][2] as { folderId: string }).folderId).toBe('attach-1');
  });

  it('decrypts an E2EE Drive image rather than previewing its ciphertext', async () => {
    listFiles.mockReset();
    listFiles.mockResolvedValue({
      items: [driveFile({ id: 'enc-1', name: 'Twilight Sky.jpg', mimeType: 'image/jpeg', encryptedMetadata: 'blob' })],
      total: 1, page: 1, pageSize: 50, totalPages: 1,
    });
    getFileMetadata.mockResolvedValue(driveFile({ id: 'enc-1', mimeType: 'image/jpeg', encryptedMetadata: 'blob' }));
    downloadFile.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3, 4])]));
    getFileKey.mockResolvedValue({ encryptedFileKey: 'wrapped' });

    render(<InsertImageDialog onInsert={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTitle('Twilight Sky.jpg'));

    const img = await screen.findByAltText('Selected image preview');
    await waitFor(() => expect(img.getAttribute('src')!.startsWith('blob:')).toBe(true));
    expect(downloadFile).toHaveBeenCalledWith('enc-1');
  });

  it('reports a locked keychain instead of previewing nothing', async () => {
    listFiles.mockReset();
    listFiles.mockResolvedValue({
      items: [driveFile({ id: 'enc-2', name: 'locked.jpg', mimeType: 'image/jpeg', encryptedMetadata: 'blob' })],
      total: 1, page: 1, pageSize: 50, totalPages: 1,
    });
    getFileMetadata.mockResolvedValue(driveFile({ id: 'enc-2', encryptedMetadata: 'blob' }));
    loadKeyPair.mockReturnValueOnce(null as never);

    render(<InsertImageDialog onInsert={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTitle('locked.jpg'));

    expect(await screen.findByText(/Unlock your encryption keys/)).toBeInTheDocument();
    expect(insertButton().disabled).toBe(true);
  });
});
