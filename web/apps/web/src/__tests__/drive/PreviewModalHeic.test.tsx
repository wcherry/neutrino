/**
 * Drive previews a HEIC (issue #210).
 *
 * No browser but Safari decodes HEIC, so an `<img>` pointed at one showed the
 * broken-image glyph and the file's name, with nothing in the console to say
 * why. Photos had already solved this for its own editor; Drive's preview now
 * runs the same transcode, and these tests pin down the three things that made
 * it a bug rather than a missing feature: that the conversion happens at all,
 * that it happens for a HEIC the upload left typed `application/octet-stream`,
 * and that nothing else is dragged through libheif on the way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const fetchPreviewBlob = vi.fn();
const downloadAndDecryptFile = vi.fn();
const getZipContents = vi.fn();

vi.mock('@/lib/api', () => ({
  storageApi: {
    fetchPreviewBlob: (...a: unknown[]) => fetchPreviewBlob(...a),
    fetchPreviewBlobUrl: vi.fn(),
    fetchPreviewText: vi.fn(),
    getZipContents: (...a: unknown[]) => getZipContents(...a),
    downloadFile: vi.fn(),
  },
  authApi: { getProfile: vi.fn(async () => ({ id: 'user-1' })) },
  downloadAndDecryptFile: (...a: unknown[]) => downloadAndDecryptFile(...a),
}));

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));
vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(async () => {}),
  loadKeyPair: vi.fn(() => ({ publicKey: 'pk', privateKey: 'sk' })),
}));

vi.mock('@neutrino/ui', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Spinner: () => <div data-testid="spinner" />,
}));

vi.mock('../../app/(apps)/drive/PreviewModal.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

/**
 * `heic-to` is the real subject here — the assertion is on whether it was
 * reached — so it is mocked at the same boundary `lib/heic.ts` imports it from,
 * leaving the byte sniffing in front of it as the code under test.
 */
const heicTo = vi.fn(
  async (_opts: { blob: Blob; type: string }) => new Blob([bytes([0x89, 0x50])], { type: 'image/png' }),
);
vi.mock('heic-to', () => ({ heicTo: (opts: { blob: Blob; type: string }) => heicTo(opts) }));

import { PreviewModal } from '../../app/(apps)/drive/PreviewModal';
import type { FileItem } from '@/lib/api';

/** Bytes backed by a plain `ArrayBuffer`, which is what `BlobPart` accepts. */
function bytes(values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(values.length));
  out.set(values);
  return out;
}

/** An ISO-BMFF `ftyp` box carrying the brands an iPhone writes. */
function heicBytes(): Uint8Array<ArrayBuffer> {
  const brands = ['heic', 'mif1'];
  const boxSize = 8 + brands.length * 4;
  const out = bytes(new Array(boxSize + 8).fill(0));
  new DataView(out.buffer).setUint32(0, boxSize);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) out[offset + i] = s.charCodeAt(i);
  };
  write(4, 'ftyp');
  brands.forEach((b, i) => write(8 + i * 4, b));
  return out;
}

const PNG_BYTES = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function aFile(over: Partial<FileItem> = {}): FileItem {
  return {
    id: 'file-1',
    name: 'IMG_2506.HEIC',
    mimeType: 'image/heic',
    encryptedMetadata: null,
    ...over,
  } as FileItem;
}

function show(file: FileItem) {
  return render(<PreviewModal file={file} onClose={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('Drive preview of a HEIC', () => {
  it('transcodes it rather than handing HEIC bytes to an <img>', async () => {
    fetchPreviewBlob.mockResolvedValue(new Blob([heicBytes()], { type: 'image/heic' }));

    show(aFile());

    const img = await screen.findByAltText('IMG_2506.HEIC');
    expect(heicTo).toHaveBeenCalledTimes(1);
    // What the <img> gets is the PNG the transcode produced, not the download.
    expect(img).toHaveAttribute('src', 'blob:preview-1');
    expect(heicTo.mock.calls[0][0]).toMatchObject({ type: 'image/png' });
  });

  it('decrypts first, so the transcode sees plaintext and not ciphertext', async () => {
    downloadAndDecryptFile.mockResolvedValue(heicBytes());

    show(aFile({ encryptedMetadata: 'sealed' }));

    await screen.findByAltText('IMG_2506.HEIC');
    expect(downloadAndDecryptFile).toHaveBeenCalledWith('file-1', 'user-1');
    expect(fetchPreviewBlob).not.toHaveBeenCalled();
    expect(heicTo).toHaveBeenCalledTimes(1);
  });

  /**
   * Chrome outside macOS reads `File.type` as empty for a `.heic`, so the
   * upload sends no `mime_type` and the server records the octet-stream the
   * *ciphertext* was posted as. That file used to miss the image branch
   * entirely and report "Preview not available for this file type."
   */
  it('previews one the upload left typed application/octet-stream', async () => {
    fetchPreviewBlob.mockResolvedValue(
      new Blob([heicBytes()], { type: 'application/octet-stream' }),
    );

    show(aFile({ mimeType: 'application/octet-stream' }));

    await screen.findByAltText('IMG_2506.HEIC');
    expect(heicTo).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary image alone', async () => {
    fetchPreviewBlob.mockResolvedValue(new Blob([PNG_BYTES], { type: 'image/png' }));

    show(aFile({ name: 'holiday.png', mimeType: 'image/png' }));

    await screen.findByAltText('holiday.png');
    expect(heicTo).not.toHaveBeenCalled();
  });

  /**
   * The name routes the fetch; the bytes decide the decode. Something misnamed
   * `.heic` is reported rather than pushed through libheif, whose complaint
   * ("HEIF image not found") describes the decoder's disappointment instead of
   * the file.
   */
  it('does not decode a non-HEIC file that merely ends in .heic', async () => {
    fetchPreviewBlob.mockResolvedValue(
      new Blob([bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], {
        type: 'application/octet-stream',
      }),
    );

    show(aFile({ name: 'notes.heic', mimeType: 'application/octet-stream' }));

    await screen.findByText('Preview not available for this file type.');
    expect(heicTo).not.toHaveBeenCalled();
  });

  it('reports what the decoder said instead of a bare failure', async () => {
    fetchPreviewBlob.mockResolvedValue(new Blob([heicBytes()], { type: 'image/heic' }));
    // The worker rejects with a string, not an Error.
    heicTo.mockRejectedValueOnce('Error: HEIF image not found');

    show(aFile());

    await screen.findByText('Failed to load preview. (HEIF image not found)');
  });

  it('says so when the browser still cannot display what it was given', async () => {
    fetchPreviewBlob.mockResolvedValue(new Blob([PNG_BYTES], { type: 'image/png' }));

    show(aFile({ name: 'holiday.png', mimeType: 'image/png' }));

    fireEvent.error(await screen.findByAltText('holiday.png'));

    expect(
      screen.getByText('This browser could not display this image.'),
    ).toBeInTheDocument();
  });

  it('throws the object URL away when the preview closes mid-transcode', async () => {
    fetchPreviewBlob.mockResolvedValue(new Blob([heicBytes()], { type: 'image/heic' }));
    let finish: (blob: Blob) => void = () => {};
    heicTo.mockReturnValueOnce(
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
    );

    const { unmount } = show(aFile());
    await screen.findByTestId('spinner');
    unmount();
    finish(new Blob([PNG_BYTES], { type: 'image/png' }));

    await waitFor(() => expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1'));
  });
});
