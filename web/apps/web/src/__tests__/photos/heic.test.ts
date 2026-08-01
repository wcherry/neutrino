import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHeic, toRenderableImageBlob } from '@/lib/heic';

const heicTo = vi.fn(async (_opts: { blob: Blob; type: string }) =>
  new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
);
vi.mock('heic-to', () => ({ heicTo: (opts: { blob: Blob; type: string }) => heicTo(opts) }));

/** Builds an ISO-BMFF `ftyp` box with the given major + compatible brands. */
function ftypBlob(brands: string[], type = ''): Blob {
  const boxSize = 8 + brands.length * 4;
  const bytes = new Uint8Array(boxSize + 8);
  new DataView(bytes.buffer).setUint32(0, boxSize);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  write(4, 'ftyp');
  brands.forEach((b, i) => write(8 + i * 4, b));
  return new Blob([bytes], { type });
}

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('isHeic', () => {
  beforeEach(() => heicTo.mockClear());

  it('accepts a declared HEIC mime type', async () => {
    await expect(isHeic(new Blob([], { type: 'image/heic' }))).resolves.toBe(true);
    await expect(isHeic(new Blob([], { type: 'image/HEIF' }))).resolves.toBe(true);
  });

  it('sniffs HEIC bytes when the mime type is missing or generic', async () => {
    await expect(isHeic(ftypBlob(['heic', 'mif1']))).resolves.toBe(true);
    await expect(
      isHeic(ftypBlob(['mif1', 'heic'], 'application/octet-stream')),
    ).resolves.toBe(true);
  });

  it('finds the brand in the compatible-brands list, not just the major brand', async () => {
    await expect(isHeic(ftypBlob(['mp41', 'isom', 'heix']))).resolves.toBe(true);
  });

  it('rejects non-HEIF ISO-BMFF containers such as mp4', async () => {
    await expect(isHeic(ftypBlob(['mp42', 'isom', 'avc1']))).resolves.toBe(false);
  });

  it('rejects other image formats', async () => {
    await expect(isHeic(new Blob([PNG_MAGIC], { type: 'image/png' }))).resolves.toBe(false);
    await expect(isHeic(new Blob([PNG_MAGIC]))).resolves.toBe(false);
  });

  it('rejects a blob too short to hold an ftyp box', async () => {
    await expect(isHeic(new Blob([new Uint8Array([0, 1, 2])]))).resolves.toBe(false);
  });

  it('trusts the bytes over a stale .heic name — an edited HEIC is saved as PNG', async () => {
    // The editor keeps the original file name but writes PNG bytes.
    const savedEdit = new File([PNG_MAGIC], 'IMG_0042.heic', { type: 'image/png' });
    await expect(isHeic(savedEdit)).resolves.toBe(false);
  });
});

describe('toRenderableImageBlob', () => {
  beforeEach(() => heicTo.mockClear());

  it('passes non-HEIC blobs through untouched', async () => {
    const png = new Blob([PNG_MAGIC], { type: 'image/png' });
    await expect(toRenderableImageBlob(png)).resolves.toBe(png);
    expect(heicTo).not.toHaveBeenCalled();
  });

  it('transcodes HEIC to PNG', async () => {
    const heic = ftypBlob(['heic'], 'image/heic');
    const out = await toRenderableImageBlob(heic);
    expect(heicTo).toHaveBeenCalledWith({ blob: heic, type: 'image/png' });
    expect(out.type).toBe('image/png');
  });
});
