/**
 * The editor's two sharpening controls.
 *
 * Both are unsharp masks and differ only in the blur they subtract, so the properties worth
 * pinning down are what separates them: Deblur must be *directional* (sharpening along the axis a
 * photo smeared along recovers more edge contrast than sharpening across it — an isotropic sharpen
 * would score the same either way, and be no use for camera shake), while Sharpness must be
 * *isotropic* (it crisps an edge whichever way the edge runs).
 */

import { describe, it, expect } from 'vitest';
import {
  motionTaps,
  directionalBlur,
  unsharpFrom,
  applyDirectionalSharpen,
  deblurAmountFromSlider,
  scaleKernel,
  isotropicBlur,
  applySharpness,
  sharpnessAmountFromSlider,
  SHARPNESS_BLUR_SIZE_PX,
  type PixelBuffer,
} from '../../app/(apps)/photos/editor/sharpening';

/** A solid-colour buffer, opaque. */
function buffer(width: number, height: number, fill = 0): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill;
    data[i + 1] = fill;
    data[i + 2] = fill;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

/** A vertical black|white edge at x = width/2 — the thing a horizontal smear destroys. */
function verticalEdge(width: number, height: number): PixelBuffer {
  const buf = buffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = x < width / 2 ? 0 : 255;
      const i = (y * width + x) * 4;
      buf.data[i] = v;
      buf.data[i + 1] = v;
      buf.data[i + 2] = v;
      buf.data[i + 3] = 255;
    }
  }
  return buf;
}

/** Horizontal contrast across the middle row — how crisp the edge is. */
function edgeContrast(buf: PixelBuffer): number {
  const y = Math.floor(buf.height / 2);
  let worst = 0;
  for (let x = 1; x < buf.width; x++) {
    const a = buf.data[(y * buf.width + (x - 1)) * 4];
    const b = buf.data[(y * buf.width + x) * 4];
    worst = Math.max(worst, Math.abs(b - a));
  }
  return worst;
}

describe('motionTaps', () => {
  it('walks horizontally for a 0° smear', () => {
    const taps = motionTaps(0, 5);
    expect(taps).toHaveLength(5);
    expect(taps.map(t => t.dx)).toEqual([-2, -1, 0, 1, 2]);
    expect(taps.every(t => t.dy === 0)).toBe(true);
  });

  it('walks vertically for a 90° smear', () => {
    const taps = motionTaps(90, 5);
    expect(taps.every(t => t.dx === 0)).toBe(true);
    expect(taps.map(t => t.dy)).toEqual([2, 1, 0, -1, -2]);
  });

  it('treats a smear shorter than a pixel as no smear at all', () => {
    // Fewer than two taps is the identity — there is nothing to subtract.
    expect(motionTaps(0, 0)).toHaveLength(0);
    expect(motionTaps(0, 1)).toHaveLength(0);
    expect(motionTaps(45, Number.NaN)).toHaveLength(0);
  });

  it('describes the same axis for an angle and its opposite', () => {
    // 20° and 200° are the same smear; the taps are the same set, walked the other way.
    const a = motionTaps(20, 7).map(t => `${t.dx},${t.dy}`).sort();
    const b = motionTaps(200, 7).map(t => `${t.dx},${t.dy}`).sort();
    expect(a).toEqual(b);
  });
});

describe('directionalBlur', () => {
  it('smears a hard edge along the axis', () => {
    const sharp = verticalEdge(32, 8);
    const before = edgeContrast(sharp);
    const blurred = directionalBlur(sharp, { angleDegrees: 0, lengthPx: 9 });
    expect(edgeContrast({ ...sharp, data: blurred })).toBeLessThan(before);
  });

  it('leaves a vertical edge alone when smeared along it', () => {
    // A vertical smear runs parallel to a vertical edge, so it cannot soften it.
    const sharp = verticalEdge(32, 8);
    const blurred = directionalBlur(sharp, { angleDegrees: 90, lengthPx: 9 });
    expect(edgeContrast({ ...sharp, data: blurred })).toBe(edgeContrast(sharp));
  });

  it('does not touch the input', () => {
    const sharp = verticalEdge(16, 4);
    const copy = new Uint8ClampedArray(sharp.data);
    directionalBlur(sharp, { angleDegrees: 0, lengthPx: 5 });
    expect(Array.from(sharp.data)).toEqual(Array.from(copy));
  });

  it('replicates at the edges rather than wrapping', () => {
    // A wrap would pull the white half into the black border and vice versa; a replicate leaves
    // the far-left column black.
    const sharp = verticalEdge(32, 8);
    const blurred = directionalBlur(sharp, { angleDegrees: 0, lengthPx: 9 });
    expect(blurred[0]).toBe(0);
  });
});

describe('applyDirectionalSharpen', () => {
  it('recovers edge contrast lost to a smear', () => {
    const smeared = buffer(32, 8);
    smeared.data.set(directionalBlur(verticalEdge(32, 8), { angleDegrees: 0, lengthPx: 9 }));
    const before = edgeContrast(smeared);

    applyDirectionalSharpen(smeared, { angleDegrees: 0, lengthPx: 9 }, 1.0);

    expect(edgeContrast(smeared)).toBeGreaterThan(before);
  });

  /** The whole point: correcting along the smear beats correcting across it. */
  it('helps more along the smear than across it', () => {
    const along = buffer(32, 8);
    along.data.set(directionalBlur(verticalEdge(32, 8), { angleDegrees: 0, lengthPx: 9 }));
    const across = { ...along, data: new Uint8ClampedArray(along.data) };

    applyDirectionalSharpen(along, { angleDegrees: 0, lengthPx: 9 }, 1.0);
    applyDirectionalSharpen(across, { angleDegrees: 90, lengthPx: 9 }, 1.0);

    expect(edgeContrast(along)).toBeGreaterThan(edgeContrast(across));
  });

  it('changes nothing at zero amount, or with no smear to correct', () => {
    const cases: Array<[number, number]> = [
      [0, 9],   // no strength
      [1.0, 0], // no kernel
      [1.0, 1], // a smear shorter than a pixel
    ];
    for (const [amount, lengthPx] of cases) {
      const img = verticalEdge(16, 4);
      const copy = new Uint8ClampedArray(img.data);
      applyDirectionalSharpen(img, { angleDegrees: 0, lengthPx }, amount);
      expect(Array.from(img.data)).toEqual(Array.from(copy));
    }
  });

  it('keeps every channel in range and leaves alpha alone', () => {
    const img = verticalEdge(32, 8);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 128;

    applyDirectionalSharpen(img, { angleDegrees: 30, lengthPx: 7 }, 1.5);

    for (let i = 0; i < img.data.length; i += 4) {
      for (const c of [0, 1, 2]) {
        expect(img.data[i + c]).toBeGreaterThanOrEqual(0);
        expect(img.data[i + c]).toBeLessThanOrEqual(255);
        expect(Number.isNaN(img.data[i + c])).toBe(false);
      }
      expect(img.data[i + 3]).toBe(128);
    }
  });
});

describe('unsharpFrom', () => {
  it('is the identity at zero amount', () => {
    const original = new Uint8ClampedArray([10, 20, 30, 255]);
    const blurred = new Uint8ClampedArray([200, 200, 200, 255]);
    const dest = new Uint8ClampedArray(4);
    unsharpFrom(dest, original, blurred, 0);
    expect(Array.from(dest)).toEqual([10, 20, 30, 255]);
  });

  it('pushes a pixel away from its blurred neighbourhood', () => {
    const original = new Uint8ClampedArray([150, 150, 150, 255]);
    const blurred = new Uint8ClampedArray([100, 100, 100, 255]);
    const dest = new Uint8ClampedArray(4);
    unsharpFrom(dest, original, blurred, 1.0);
    expect(Array.from(dest).slice(0, 3)).toEqual([200, 200, 200]);
  });

  it('saturates rather than wrapping around', () => {
    const original = new Uint8ClampedArray([250, 5, 250, 255]);
    const blurred = new Uint8ClampedArray([10, 250, 10, 255]);
    const dest = new Uint8ClampedArray(4);
    unsharpFrom(dest, original, blurred, 1.5);
    expect(Array.from(dest)).toEqual([255, 0, 255, 255]);
  });
});

describe('slider and scaling', () => {
  it('maps the slider onto a bounded strength', () => {
    expect(deblurAmountFromSlider(0)).toBe(0);
    expect(deblurAmountFromSlider(100)).toBe(1.5);
    expect(deblurAmountFromSlider(-20)).toBe(0);
    expect(deblurAmountFromSlider(400)).toBe(1.5);
    expect(deblurAmountFromSlider(Number.NaN)).toBe(0);
  });

  it('scales a kernel measured on the downsampled copy up to the real image', () => {
    // A 9px smear seen at 800px wide is a 36px smear at 3200px wide.
    const scaled = scaleKernel({ angleDegrees: 17, lengthPx: 9 }, 800, 3200);
    expect(scaled.lengthPx).toBe(36);
    expect(scaled.angleDegrees).toBe(17);
  });

  it('leaves the kernel alone when the analysed width makes no sense', () => {
    const k = { angleDegrees: 17, lengthPx: 9 };
    expect(scaleKernel(k, 0, 3200)).toEqual(k);
    expect(scaleKernel(k, Number.NaN, 3200)).toEqual(k);
  });
});

// ── Sharpness: the isotropic half ────────────────────────────────────────────

/** A horizontal black|white edge at y = height/2, for checking the other axis. */
function horizontalEdge(width: number, height: number): PixelBuffer {
  const buf = buffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = y < height / 2 ? 0 : 255;
      const i = (y * width + x) * 4;
      buf.data[i] = v;
      buf.data[i + 1] = v;
      buf.data[i + 2] = v;
      buf.data[i + 3] = 255;
    }
  }
  return buf;
}

/** Vertical contrast down the middle column. */
function verticalContrast(buf: PixelBuffer): number {
  const x = Math.floor(buf.width / 2);
  let worst = 0;
  for (let y = 1; y < buf.height; y++) {
    const a = buf.data[((y - 1) * buf.width + x) * 4];
    const b = buf.data[(y * buf.width + x) * 4];
    worst = Math.max(worst, Math.abs(b - a));
  }
  return worst;
}

describe('isotropicBlur', () => {
  it('softens an edge whichever way it runs', () => {
    const vert = verticalEdge(32, 32);
    const horiz = horizontalEdge(32, 32);

    const blurredVert = isotropicBlur(vert, 5);
    const blurredHoriz = isotropicBlur(horiz, 5);

    expect(edgeContrast({ ...vert, data: blurredVert })).toBeLessThan(edgeContrast(vert));
    expect(verticalContrast({ ...horiz, data: blurredHoriz })).toBeLessThan(verticalContrast(horiz));
  });

  it('does not touch the input', () => {
    const img = verticalEdge(16, 16);
    const copy = new Uint8ClampedArray(img.data);
    isotropicBlur(img, 3);
    expect(Array.from(img.data)).toEqual(Array.from(copy));
  });
});

/**
 * A realistically soft edge.
 *
 * Blurred *twice* on purpose. One box blur of a hard step produces an exactly linear ramp, and an
 * unsharp mask cannot change a linear ramp — it works on curvature, and a ramp has none, so a
 * single-blur fixture measures as untouched no matter how well the sharpening works. Two passes
 * give the profile the curvature a real out-of-focus edge has.
 */
function softenedEdge(make: (w: number, h: number) => PixelBuffer, size = 32): PixelBuffer {
  const img = make(size, size);
  img.data.set(isotropicBlur(img, SHARPNESS_BLUR_SIZE_PX));
  img.data.set(isotropicBlur(img, SHARPNESS_BLUR_SIZE_PX));
  return img;
}

describe('applySharpness', () => {
  it('crisps a softened edge', () => {
    const soft = softenedEdge(verticalEdge);
    const before = edgeContrast(soft);

    applySharpness(soft, sharpnessAmountFromSlider(100));

    expect(edgeContrast(soft)).toBeGreaterThan(before);
  });

  /** What makes it the *isotropic* control: it works on an edge running either way. */
  it('crisps a horizontal edge as well as a vertical one', () => {
    const soft = softenedEdge(horizontalEdge);
    const before = verticalContrast(soft);

    applySharpness(soft, sharpnessAmountFromSlider(100));

    expect(verticalContrast(soft)).toBeGreaterThan(before);
  });

  it('softens at a negative amount', () => {
    const sharp = verticalEdge(32, 32);
    const before = edgeContrast(sharp);

    applySharpness(sharp, sharpnessAmountFromSlider(-100));

    expect(edgeContrast(sharp)).toBeLessThan(before);
  });

  it('changes nothing at zero', () => {
    const img = verticalEdge(16, 16);
    const copy = new Uint8ClampedArray(img.data);
    applySharpness(img, sharpnessAmountFromSlider(0));
    expect(Array.from(img.data)).toEqual(Array.from(copy));
  });

  it('keeps every channel in range and leaves alpha alone', () => {
    const img = verticalEdge(32, 32);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 77;

    applySharpness(img, sharpnessAmountFromSlider(100));

    for (let i = 0; i < img.data.length; i += 4) {
      for (const c of [0, 1, 2]) {
        expect(img.data[i + c]).toBeGreaterThanOrEqual(0);
        expect(img.data[i + c]).toBeLessThanOrEqual(255);
        expect(Number.isNaN(img.data[i + c])).toBe(false);
      }
      expect(img.data[i + 3]).toBe(77);
    }
  });
});

describe('sharpnessAmountFromSlider', () => {
  it('maps the slider onto both directions', () => {
    expect(sharpnessAmountFromSlider(0)).toBe(0);
    expect(sharpnessAmountFromSlider(100)).toBe(1.5);
    // Softening is bounded at -1: that is the blurred image exactly, with nowhere further to go.
    expect(sharpnessAmountFromSlider(-100)).toBe(-1);
  });

  it('clamps and refuses nonsense', () => {
    expect(sharpnessAmountFromSlider(400)).toBe(1.5);
    expect(sharpnessAmountFromSlider(-400)).toBe(-1);
    expect(sharpnessAmountFromSlider(Number.NaN)).toBe(0);
  });
});

describe('unsharpFrom — softening', () => {
  it('blends towards the blur at a negative amount', () => {
    const original = new Uint8ClampedArray([200, 200, 200, 255]);
    const blurred = new Uint8ClampedArray([100, 100, 100, 255]);
    const dest = new Uint8ClampedArray(4);
    // At -1 the result is the blurred pixel exactly.
    unsharpFrom(dest, original, blurred, -1);
    expect(Array.from(dest).slice(0, 3)).toEqual([100, 100, 100]);
    // Halfway is halfway.
    unsharpFrom(dest, original, blurred, -0.5);
    expect(Array.from(dest).slice(0, 3)).toEqual([150, 150, 150]);
  });
});
