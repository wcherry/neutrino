import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeImagesForPdf } from '@/lib/pdfImages';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';
const WEBP = 'data:image/webp;base64,UklGRg==';

/** Srcs the fake decoder should reject, standing in for an undecodable image. */
const undecodable = new Set<string>();
let loaded: string[] = [];
/** crossOrigin as it stood when each src was assigned. */
let corsFor: Record<string, string | null> = {};

class FakeImage {
  crossOrigin: string | null = null;
  naturalWidth = 10;
  naturalHeight = 5;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = '';
  set src(value: string) {
    this.#src = value;
    loaded.push(value);
    corsFor[value] = this.crossOrigin;
    queueMicrotask(() => {
      if (undecodable.has(value)) this.onerror?.();
      else this.onload?.();
    });
  }
  get src() {
    return this.#src;
  }
}

/** Alpha byte the fake canvas reports — 255 is opaque, so JPEG is chosen. */
let alpha = 255;

beforeEach(() => {
  undecodable.clear();
  loaded = [];
  corsFor = {};
  alpha = 255;
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        globalCompositeOperation: '',
        fillStyle: '',
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(alpha),
        }),
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    (type?: string) => `data:${type ?? 'image/png'};base64,CONVERTED`,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('normalizeImagesForPdf', () => {
  it('leaves HTML without images untouched and does no work', async () => {
    const html = '<p>Dear agent,</p>';
    await expect(normalizeImagesForPdf(html)).resolves.toEqual({ html, dropped: [] });
    expect(loaded).toEqual([]);
  });

  it('passes PNG and JPEG data URLs through without re-encoding', async () => {
    const html = `<p><img src="${PNG}"><img src="${JPEG}"></p>`;
    const result = await normalizeImagesForPdf(html);
    expect(result.html).toContain(PNG);
    expect(result.html).toContain(JPEG);
    expect(loaded).toEqual([]);
  });

  it('re-encodes a format pdfmake cannot embed', async () => {
    const result = await normalizeImagesForPdf(`<p><img src="${WEBP}"></p>`);
    // Opaque, so it is flattened to JPEG rather than paid for as PNG.
    expect(result.html).toContain('data:image/jpeg;base64,CONVERTED');
    expect(result.html).not.toContain(WEBP);
    expect(result.dropped).toEqual([]);
  });

  it('keeps the alpha channel when the image is transparent', async () => {
    alpha = 0;
    const result = await normalizeImagesForPdf(`<p><img src="${WEBP}"></p>`);
    expect(result.html).toContain('data:image/png;base64,CONVERTED');
  });

  it('converts a repeated src only once', async () => {
    await normalizeImagesForPdf(`<p><img src="${WEBP}"><img src="${WEBP}"></p>`);
    expect(loaded).toEqual([WEBP]);
  });

  it('drops an undecodable image instead of failing the export', async () => {
    undecodable.add(WEBP);
    const result = await normalizeImagesForPdf(`<p>Text</p><img src="${WEBP}"><p>More</p>`);
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('More');
    expect(result.dropped).toEqual([WEBP]);
  });

  it('drops an unresolved Drive reference', async () => {
    const ref = 'neutrino-drive:abc-123';
    undecodable.add(ref);
    const result = await normalizeImagesForPdf(`<img src="${ref}">`);
    expect(result.dropped).toEqual([ref]);
    expect(result.html).not.toContain('<img');
  });

  it('requests CORS for a remote image so the canvas is not tainted', async () => {
    const remote = 'https://example.com/photo.webp';
    await normalizeImagesForPdf(`<img src="${remote}"><img src="${WEBP}">`);
    expect(corsFor[remote]).toBe('anonymous');
    // A data: URL is same-origin; asking for CORS there is pointless.
    expect(corsFor[WEBP]).toBeNull();
  });

  it('removes an image with no src at all', async () => {
    const result = await normalizeImagesForPdf('<p>Hi</p><img>');
    expect(result.html).not.toContain('<img');
    expect(result.dropped).toEqual([]);
  });
});
