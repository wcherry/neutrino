/**
 * A slide background is part of the presentation, so it is stored the same way
 * an image element is — as a reference to a Drive file. These cover the read
 * side: turning that reference back into a CSS background every surface can
 * paint, and leaving anything that isn't a reference alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getFileMetadata = vi.fn();

vi.mock('@/lib/api', () => ({
  storageApi: {
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    downloadFile: vi.fn(),
    getFileDownloadUrl: (id: string) => `https://drive.test/files/${id}?token=t`,
    uploadFile: vi.fn(),
    listFiles: vi.fn(),
  },
  filesystemApi: { getFolderContents: vi.fn(), createFolder: vi.fn() },
  encryptionApi: { getFileKey: vi.fn() },
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  loadKeyPair: () => ({ publicKey: 'pk', secretKey: 'sk' }),
  decryptFileKey: () => 'dek',
  decryptFile: () => new Uint8Array([1]),
}));

import { useSlideBackgroundStyle } from '@/app/(apps)/slides/editor/useSlideBackgroundStyle';
import { slideBackgroundStyle } from '@/app/(apps)/slides/editor/slideEditorHelpers';
import { clearDriveImageCache, driveImageRef } from '@/lib/driveImages';

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveImageCache();
  localStorage.setItem('access_token', `header.${btoa(JSON.stringify({ sub: 'user-1' }))}.sig`);
  getFileMetadata.mockImplementation(async (id: string) => ({
    id, name: 'sky.png', mimeType: 'image/png', encryptedMetadata: null,
  }));
});

describe('slide background images', () => {
  it('resolves a referenced background into a paintable url()', async () => {
    const { result } = renderHook(() =>
      useSlideBackgroundStyle({ type: 'image', value: driveImageRef('bg-1'), objectFit: 'cover' }),
    );

    await waitFor(() =>
      expect(result.current.backgroundImage).toBe('url(https://drive.test/files/bg-1?token=t)'),
    );
    expect(result.current.backgroundSize).toBe('cover');
  });

  it('never paints the raw reference', async () => {
    const { result } = renderHook(() =>
      useSlideBackgroundStyle({ type: 'image', value: driveImageRef('bg-2'), objectFit: 'cover' }),
    );

    // Including on the very first render, before resolution finishes.
    expect(result.current.backgroundImage).not.toContain('neutrino-drive:');
    await waitFor(() => expect(getFileMetadata).toHaveBeenCalled());
    expect(result.current.backgroundImage).not.toContain('neutrino-drive:');
  });

  it('leaves a legacy data-URL background alone', () => {
    const value = 'data:image/png;base64,AAA';
    const { result } = renderHook(() =>
      useSlideBackgroundStyle({ type: 'image', value, objectFit: 'contain' }),
    );

    expect(result.current.backgroundImage).toBe(`url(${value})`);
    expect(result.current.backgroundSize).toBe('contain');
    expect(getFileMetadata).not.toHaveBeenCalled();
  });

  it('leaves colour and gradient backgrounds alone', () => {
    const colour = renderHook(() => useSlideBackgroundStyle({ type: 'color', value: '#ff0000' }));
    expect(colour.result.current.background).toBe('#ff0000');

    const gradient = renderHook(() =>
      useSlideBackgroundStyle({ type: 'gradient', value: 'linear-gradient(90deg, #000, #fff)' }),
    );
    expect(gradient.result.current.background).toBe('linear-gradient(90deg, #000, #fff)');
    expect(getFileMetadata).not.toHaveBeenCalled();
  });

  it('maps objectFit onto backgroundSize', () => {
    expect(slideBackgroundStyle({ type: 'image', value: 'x', objectFit: 'fill' }).backgroundSize)
      .toBe('100% 100%');
    expect(slideBackgroundStyle({ type: 'image', value: 'x', objectFit: 'contain' }).backgroundSize)
      .toBe('contain');
    expect(slideBackgroundStyle({ type: 'image', value: 'x' }).backgroundSize).toBe('cover');
  });
});
