import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateThumbnail } from '../index';

// ---------------------------------------------------------------------------
// Fake Image class — triggers onload or onerror on the next microtask
// ---------------------------------------------------------------------------

function makeFakeImageClass(opts: { width?: number; height?: number; fail?: boolean } = {}) {
  const { width = 1024, height = 768, fail = false } = opts;
  return class FakeImage {
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    width = width;
    height = height;
    private _src = '';

    set src(value: string) {
      this._src = value;
      if (fail) {
        Promise.resolve().then(() => this.onerror?.(new Error('load failed')));
      } else {
        Promise.resolve().then(() => this.onload?.());
      }
    }

    get src() {
      return this._src;
    }
  };
}

// ---------------------------------------------------------------------------
// generateThumbnail
// ---------------------------------------------------------------------------

// jsdom does not implement URL.createObjectURL / revokeObjectURL — define them once
Object.defineProperty(URL, 'createObjectURL', {
  value: vi.fn(() => 'blob:mock-url'),
  writable: true,
  configurable: true,
});
Object.defineProperty(URL, 'revokeObjectURL', {
  value: vi.fn(),
  writable: true,
  configurable: true,
});

describe('generateThumbnail', () => {
  const mockDrawImage = vi.fn();
  const mockCtx = { drawImage: mockDrawImage } as unknown as CanvasRenderingContext2D;

  // Spies defined once; implementations reset in beforeEach after vi.clearAllMocks()
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const toDataURLSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');

  beforeEach(() => {
    vi.clearAllMocks();
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockReturnValue('blob:mock-url');
    getContextSpy.mockReturnValue(mockCtx);
    toDataURLSpy.mockReturnValue('data:image/jpeg;base64,/9j/abc==');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the base64 portion (no data-URL prefix) on successful load', async () => {
    vi.stubGlobal('Image', makeFakeImageClass());
    const file = new File(['img-bytes'], 'photo.jpg', { type: 'image/jpeg' });

    const result = await generateThumbnail(file);

    expect(result).toBe('/9j/abc==');
  });

  it('creates and revokes an object URL for the file', async () => {
    vi.stubGlobal('Image', makeFakeImageClass());
    const file = new File(['img-bytes'], 'photo.jpg', { type: 'image/jpeg' });

    await generateThumbnail(file);

    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('scales down a large image to fit within maxSize', async () => {
    vi.stubGlobal('Image', makeFakeImageClass({ width: 2048, height: 1024 }));
    const file = new File(['img-bytes'], 'large.jpg', { type: 'image/jpeg' });

    await generateThumbnail(file, 512);

    // scale = min(512/2048, 512/1024, 1) = 0.25 → canvas 512 x 256
    const [, , , w, h] = mockDrawImage.mock.calls[0] as [unknown, unknown, unknown, number, number];
    expect(w).toBe(512);
    expect(h).toBe(256);
  });

  it('does not upscale an image smaller than maxSize', async () => {
    vi.stubGlobal('Image', makeFakeImageClass({ width: 100, height: 80 }));
    const file = new File(['small'], 'small.jpg', { type: 'image/jpeg' });

    await generateThumbnail(file, 512);

    // scale = min(512/100, 512/80, 1) = 1 → canvas stays 100 x 80
    const [, , , w, h] = mockDrawImage.mock.calls[0] as [unknown, unknown, unknown, number, number];
    expect(w).toBe(100);
    expect(h).toBe(80);
  });

  it('returns null when the image fails to load', async () => {
    vi.stubGlobal('Image', makeFakeImageClass({ fail: true }));
    const file = new File(['bad-bytes'], 'corrupt.jpg', { type: 'image/jpeg' });

    const result = await generateThumbnail(file);

    expect(result).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('returns null when the canvas context is unavailable', async () => {
    vi.stubGlobal('Image', makeFakeImageClass());
    getContextSpy.mockReturnValue(null);
    const file = new File(['img-bytes'], 'photo.jpg', { type: 'image/jpeg' });

    const result = await generateThumbnail(file);

    expect(result).toBeNull();
  });

  it('uses JPEG encoding when calling toDataURL', async () => {
    vi.stubGlobal('Image', makeFakeImageClass());
    const file = new File(['img-bytes'], 'photo.png', { type: 'image/png' });

    await generateThumbnail(file);

    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.8);
  });
});
