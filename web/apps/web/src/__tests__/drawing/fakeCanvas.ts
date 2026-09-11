/**
 * A canvas that holds real pixels, for tests that are about pixels.
 *
 * jsdom's `getContext('2d')` returns null, so the drawing suite's other fakes
 * record *calls* — which surface was made, how big it was, what was drawn into
 * it. That is the right shape for testing the OpenRaster writer's geometry and
 * the wrong shape for testing an adjustment layer or a blur, where the question
 * is what colour a pixel ended up and nothing else.
 *
 * So this one keeps a buffer and implements the handful of operations the
 * compositor actually performs on it: fill a rectangle, draw another surface
 * over it, read the pixels back, write them back. **Transforms are ignored**,
 * which is why every test using it renders at identity — an implementation that
 * honoured them would be a rasteriser, and the compositor's transform handling
 * is tested elsewhere, against recorded calls.
 *
 * A "bitmap" here is a flat colour rather than an image. A raster layer is the
 * cheapest way to get a known colour onto a surface, and what the tests need
 * from one is that it is *some* known colour in a known rectangle.
 */

/** A stand-in for a decoded image: one colour, drawn wherever it is asked for. */
export interface FakeBitmap {
  fakeColor: [number, number, number, number];
}

export function fakeBitmap(r: number, g: number, b: number, a = 255): FakeBitmap {
  return { fakeColor: [r, g, b, a] };
}

export interface FakeSurface {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
}

function isSurface(value: unknown): value is FakeSurface {
  return typeof value === 'object' && value !== null && 'data' in value && 'width' in value;
}

function isBitmap(value: unknown): value is FakeBitmap {
  return typeof value === 'object' && value !== null && 'fakeColor' in value;
}

/** CSS colours the tests actually use. Anything else reads as opaque black. */
function parseColor(style: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(style.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(style.trim());
  if (rgba) {
    const parts = rgba[1].split(/[,/]/).map((p) => Number(p.trim()));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, Math.round((parts[3] ?? 1) * 255)];
  }
  return [0, 0, 0, 255];
}

/** Straight Porter-Duff source-over, on unpremultiplied bytes. */
function over(data: Uint8ClampedArray, at: number, colour: [number, number, number, number], alpha: number): void {
  const top = (colour[3] / 255) * alpha;
  if (top <= 0) return;
  const base = (data[at + 3] / 255) * (1 - top);
  const out = top + base;
  if (out <= 0) return;
  data[at] = (colour[0] * top + data[at] * base) / out;
  data[at + 1] = (colour[1] * top + data[at + 1] * base) / out;
  data[at + 2] = (colour[2] * top + data[at + 2] * base) / out;
  data[at + 3] = out * 255;
}

export function fakeSurfaceFactory(): (width: number, height: number) => FakeSurface {
  return (width, height) => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const data = new Uint8ClampedArray(w * h * 4);

    const surface: FakeSurface = {
      width: w,
      height: h,
      data,
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
    };

    const paintRect = (x: number, y: number, rw: number, rh: number, colour: [number, number, number, number]) => {
      const left = Math.max(0, Math.round(x));
      const top = Math.max(0, Math.round(y));
      const right = Math.min(w, Math.round(x + rw));
      const bottom = Math.min(h, Math.round(y + rh));
      for (let py = top; py < bottom; py++) {
        for (let px = left; px < right; px++) {
          over(data, (py * w + px) * 4, colour, ctx.globalAlpha);
        }
      }
    };

    const ctx = {
      canvas: surface,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      font: '',
      textBaseline: '',
      lineCap: '',
      lineJoin: '',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      lineDashOffset: 0,

      save: () => {}, restore: () => {},
      beginPath: () => {}, closePath: () => {}, clip: () => {},
      moveTo: () => {}, lineTo: () => {}, rect: () => {}, ellipse: () => {},
      arc: () => {}, roundRect: () => {}, bezierCurveTo: () => {}, quadraticCurveTo: () => {},
      fill: () => {}, stroke: () => {}, strokeRect: () => {},
      translate: () => {}, scale: () => {}, rotate: () => {},
      transform: () => {}, setTransform: () => {}, setLineDash: () => {},
      fillText: () => {}, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createPattern: () => null,

      fillRect: (x: number, y: number, rw: number, rh: number) => {
        paintRect(x, y, rw, rh, parseColor(String(ctx.fillStyle)));
      },

      clearRect: (x: number, y: number, rw: number, rh: number) => {
        const left = Math.max(0, Math.round(x));
        const top = Math.max(0, Math.round(y));
        const right = Math.min(w, Math.round(x + rw));
        const bottom = Math.min(h, Math.round(y + rh));
        for (let py = top; py < bottom; py++) {
          data.fill(0, (py * w + left) * 4, (py * w + right) * 4);
        }
      },

      drawImage: (source: unknown, ...args: number[]) => {
        if (isBitmap(source)) {
          const [x = 0, y = 0, dw = w, dh = h] = args;
          paintRect(x, y, dw, dh, source.fakeColor);
          return;
        }
        if (!isSurface(source)) return;
        // Surfaces are only ever drawn at the origin by the compositor, which
        // is what lets this ignore the scaling arguments entirely.
        const [x = 0, y = 0] = args;
        for (let py = 0; py < Math.min(source.height, h - y); py++) {
          for (let px = 0; px < Math.min(source.width, w - x); px++) {
            const from = (py * source.width + px) * 4;
            const colour: [number, number, number, number] = [
              source.data[from], source.data[from + 1], source.data[from + 2], source.data[from + 3],
            ];
            over(data, ((py + y) * w + (px + x)) * 4, colour, ctx.globalAlpha);
          }
        }
      },

      getImageData: (x: number, y: number, gw: number, gh: number) => {
        const out = new Uint8ClampedArray(gw * gh * 4);
        for (let py = 0; py < gh; py++) {
          const from = ((py + y) * w + x) * 4;
          out.set(data.subarray(from, from + gw * 4), py * gw * 4);
        }
        return { data: out, width: gw, height: gh };
      },

      putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => {
        for (let py = 0; py < image.height; py++) {
          const to = ((py + y) * w + x) * 4;
          data.set(image.data.subarray(py * image.width * 4, (py + 1) * image.width * 4), to);
        }
      },
    };

    return surface;
  };
}

/** One pixel, as `[r, g, b, a]`. */
export function pixelAt(surface: FakeSurface, x: number, y: number): [number, number, number, number] {
  const at = (y * surface.width + x) * 4;
  return [surface.data[at], surface.data[at + 1], surface.data[at + 2], surface.data[at + 3]];
}
