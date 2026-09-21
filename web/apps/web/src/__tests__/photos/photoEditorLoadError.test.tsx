/**
 * A photo that will not open is reported in a dialog.
 *
 * The load path swallows three unrelated failures into one catch — the
 * download, the decryption, and the browser's decode of the bytes — and used to
 * put a bare "Failed to load image" line on an otherwise empty screen. These
 * pin down that the failure now arrives as an error dialog carrying the reason,
 * and that dismissing it leaves the editor rather than stranding the user on a
 * screen with nothing to edit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.mock() calls are hoisted above the import of the module under test.
// ---------------------------------------------------------------------------

const back = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'fileId' ? 'file-1' : null) }),
  useRouter: () => ({ push: vi.fn(), back, replace: vi.fn() }),
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }),
  ZoomSlider: () => null,
  AlertDialog: ({
    open,
    title,
    description,
    variant,
    cancelLabel,
    onClose,
  }: {
    open: boolean;
    title: string;
    description?: React.ReactNode;
    variant?: string;
    cancelLabel?: string;
    onClose: () => void;
  }) =>
    open
      ? React.createElement(
          'div',
          { role: 'alertdialog', 'data-variant': variant },
          React.createElement('h2', null, title),
          React.createElement('p', null, description),
          React.createElement('button', { onClick: onClose }, cancelLabel),
        )
      : null,
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('@neutrino/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

const downloadFile = vi.fn();
const getFileMetadata = vi.fn();
const getFileKey = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  storageApi: {
    downloadFile: (...args: unknown[]) => downloadFile(...args),
    getFileMetadata: (...args: unknown[]) => getFileMetadata(...args),
    uploadFile: vi.fn(),
  },
  filesystemApi: { updateFile: vi.fn() },
  encryptionApi: { getFileKey: (...args: unknown[]) => getFileKey(...args) },
}));

vi.mock('@neutrino/api-photos', () => ({ photosAiApi: {} }));

const openSealedFileKey = vi.fn();

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(async () => {}),
  decryptFileKey: vi.fn(),
  decryptFile: vi.fn(),
  openSealedFileKey: (...args: unknown[]) => openSealedFileKey(...args),
}));

let sessionKeyPair: unknown = null;
vi.mock('@/hooks/useSessionKeyPair', () => ({ useSessionKeyPair: () => sessionKeyPair }));

const toRenderableImageBlob = vi.fn(async (b: Blob) => b);
vi.mock('@/lib/heic', () => ({ toRenderableImageBlob: (b: Blob) => toRenderableImageBlob(b) }));

// The editor's own chrome plays no part here and is expensive to mount.
vi.mock('@/app/(apps)/photos/editor/PhotoCanvas', () => ({
  PhotoCanvas: () => React.createElement('div', { 'data-testid': 'canvas' }),
}));
vi.mock('@/app/(apps)/photos/editor/PhotoTopBar', () => ({ PhotoTopBar: () => null }));
vi.mock('@/app/(apps)/photos/editor/PhotoToolbar', () => ({ PhotoToolbar: () => null }));
vi.mock('@/app/(apps)/photos/editor/AdjustmentsPanel', () => ({ AdjustmentsPanel: () => null }));

import { PhotoEditor } from '@/app/(apps)/photos/editor/PhotoEditor';

describe('PhotoEditor load failure', () => {
  beforeEach(() => {
    back.mockClear();
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
    getFileMetadata.mockReset();
    getFileMetadata.mockResolvedValue({
      name: 'IMG_0042.jpg',
      mimeType: 'image/jpeg',
      folderId: null,
    });
    getFileKey.mockReset();
    getFileKey.mockResolvedValue(null);
    openSealedFileKey.mockReset();
    sessionKeyPair = null;
    toRenderableImageBlob.mockReset();
    toRenderableImageBlob.mockImplementation(async (b: Blob) => b);
  });

  it('names the file and keeps the reason when the bytes will not decode', async () => {
    // Downloaded and decrypted fine; the browser cannot make an image of it.
    toRenderableImageBlob.mockRejectedValue(new Error('HEIC decode failed'));

    render(<PhotoEditor />);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAttribute('data-variant', 'error');
    expect(screen.getByText('Couldn’t open IMG_0042.jpg')).toBeInTheDocument();
    // The underlying cause is kept: a failed download and a format this browser
    // cannot decode ask different things of the user.
    expect(screen.getByText(/HEIC decode failed/)).toBeInTheDocument();
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument();
  });

  it('falls back to a generic title and reason when the download itself failed', async () => {
    // The metadata never arrived either — both requests are one `Promise.all`.
    downloadFile.mockRejectedValue(new Error(''));

    render(<PhotoEditor />);

    expect(await screen.findByText('Couldn’t open this photo')).toBeInTheDocument();
    expect(
      screen.getByText('The file could not be downloaded, decrypted, or decoded by this browser.'),
    ).toBeInTheDocument();
  });

  it('keeps the reason when the rejection is a bare string, as heic-to’s is', async () => {
    // `heic-to` decodes in a worker and rejects with `e.toString()`, not an
    // Error. That string was the only account of the failure and was dropped.
    toRenderableImageBlob.mockRejectedValue('Error: HEIF image not found');

    render(<PhotoEditor />);

    await screen.findByRole('alertdialog');
    expect(screen.getByText(/HEIF image not found/)).toBeInTheDocument();
    // The "Error: " prefix says nothing after the sentence that precedes it.
    expect(screen.queryByText(/\(Error: /)).not.toBeInTheDocument();
  });

  it('reports a locked vault as a locked vault, not as an undecodable file', async () => {
    // Issue #32. An encrypted photo with no key in hand used to fall through to
    // the ciphertext, which then failed to decode — so the dialog blamed the
    // browser for a file that was never decrypted.
    getFileMetadata.mockResolvedValue({
      name: 'IMG_2460.HEIC',
      mimeType: 'image/heic',
      folderId: null,
      encryptedMetadata: 'c2VhbGVk',
    });

    render(<PhotoEditor />);

    expect(await screen.findByText('Couldn’t open IMG_2460.HEIC')).toBeInTheDocument();
    expect(screen.getByText(/Unlock your encryption keys/)).toBeInTheDocument();
    // The bytes were never handed to a decoder: there was nothing to decode.
    expect(toRenderableImageBlob).not.toHaveBeenCalled();
  });

  it('surfaces the key version a rotated account is missing', async () => {
    getFileMetadata.mockResolvedValue({
      name: 'IMG_2460.HEIC',
      mimeType: 'image/heic',
      folderId: null,
      encryptedMetadata: 'c2VhbGVk',
    });
    sessionKeyPair = { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) };
    getFileKey.mockResolvedValue({ encryptedFileKey: 'sealed', keyVersion: 2 });
    openSealedFileKey.mockImplementation(() => {
      throw new Error('This file needs encryption key version 2, which this device does not have.');
    });

    render(<PhotoEditor />);

    await screen.findByRole('alertdialog');
    expect(screen.getByText(/encryption key version 2/)).toBeInTheDocument();
    expect(toRenderableImageBlob).not.toHaveBeenCalled();
  });

  it('goes back when the dialog is dismissed, since there is nothing behind it', async () => {
    toRenderableImageBlob.mockRejectedValue(new Error('boom'));

    render(<PhotoEditor />);

    await userEvent.click(await screen.findByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(back).toHaveBeenCalled());
  });
});
