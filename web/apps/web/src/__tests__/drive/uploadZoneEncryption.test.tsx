/**
 * Drive's upload panel never uploads in the clear (issue #95).
 *
 * It used to, as a fallback: encrypt when the keypair resolved, otherwise
 * `storageApi.uploadFile`. The fallback looked kind — the alternative seemed to
 * be losing the user's file — but the file was never at risk. It is still on
 * their disk. What the fallback actually produced was a Drive row with no
 * `file_key_refs` entry, which no later pass can find and encrypt, so the
 * "temporary" plaintext was permanent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const uploadDriveFile = vi.fn();
const getProfile = vi.fn();

vi.mock('@/lib/api', () => ({
  authApi: { getProfile: (...a: unknown[]) => getProfile(...a) },
  uploadDriveFile: (...a: unknown[]) => uploadDriveFile(...a),
  isMissingEncryptionKey: (err: unknown) => err instanceof Error && err.message === 'no-dek',
}));

let currentUser: { id: string } | null = { id: 'user-1' };
vi.mock('@neutrino/auth', () => ({ useUser: () => currentUser }));

vi.mock('@neutrino/ui', () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <input
      type="file"
      data-testid="drop-zone"
      onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
    />
  ),
}));

vi.mock('../../app/(apps)/drive/UploadZone.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

import { UploadZone } from '../../app/(apps)/drive/UploadZone';

function renderZone(initialFiles?: File[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UploadZone onClose={vi.fn()} folderId="folder-1" initialFiles={initialFiles} />
    </QueryClientProvider>,
  );
}

const aFile = () => new File(['bytes'], 'holiday.png', { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: 'user-1' };
  uploadDriveFile.mockResolvedValue({ id: 'file-1' });
  getProfile.mockResolvedValue({ id: 'user-1' });
});

describe('UploadZone', () => {
  it('uploads through the encrypted uploader, into the open folder', async () => {
    await act(async () => { renderZone([aFile()]); });

    await waitFor(() => expect(uploadDriveFile).toHaveBeenCalledTimes(1));
    const [file, userId, opts] = uploadDriveFile.mock.calls[0];
    expect((file as File).name).toBe('holiday.png');
    expect(userId).toBe('user-1');
    expect((opts as { folderId: string }).folderId).toBe('folder-1');
  });

  it('falls back to the profile call for the user id, not to plaintext', async () => {
    // `useUser()` is empty for a moment on a fresh page, and "no user id yet"
    // must not be read as "encryption is not available".
    currentUser = null;

    await act(async () => { renderZone([aFile()]); });

    await waitFor(() => expect(uploadDriveFile).toHaveBeenCalledTimes(1));
    expect(getProfile).toHaveBeenCalled();
    expect(uploadDriveFile.mock.calls[0][1]).toBe('user-1');
  });

  it('reports a locked vault against the file instead of uploading it', async () => {
    uploadDriveFile.mockRejectedValue(new Error('no-dek'));

    await act(async () => { renderZone([aFile()]); });

    // The message has to say what to do about it. A raw 'no-dek' in the upload
    // row is the kind of thing a user reads as "it broke" and retries forever.
    await waitFor(() =>
      expect(screen.getByText(/Unlock your encryption keys/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/never uploaded unencrypted/i)).toBeTruthy();
  });

  it('shows an ordinary transport failure as itself', async () => {
    uploadDriveFile.mockRejectedValue(new Error('Network unreachable'));

    await act(async () => { renderZone([aFile()]); });

    await waitFor(() => expect(screen.getByText('Network unreachable')).toBeTruthy());
  });
});
