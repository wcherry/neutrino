/**
 * The pixel arithmetic behind `document/filters.ts`.
 *
 * Every function here takes an `ImageLike` and rewrites it, and nothing here
 * touches a canvas — the compositor reads an `ImageData` out of a surface, hands
 * it over, and puts it back. That split is the same one the brush engine makes,
 * and for the same reason: a blur radius that is off by one, a shadow composited
 * in the wrong order and an unsharp mask that halos are all arithmetic bugs, and
 * arithmetic is testable without a rendering context.
 *
 * Two things run through the whole file.
 *
 * **Blurring happens premultiplied.** Averaging straight RGBA mixes the colour
 * of transparent pixels — usually black — into the visible ones, so a blurred
 * edge grows a dark fringe that looks like a bad matte. Premultiplying before
 * the passes and undoing it afterwards is what makes the fringe go away, and it
 * is the single most common mistake in a hand-rolled blur.
 *
 * **The noise is deterministic.** It is hashed from the pixel's own coordinates
 * rather than drawn from `Math.random`, because the same document is rendered
 * to the screen, to `mergedimage.png` and to each layer's PNG, and grain that
 * differed between them would make the export not a picture of the drawing.
 */

import { parseRgba, type Rgba } from '../paint';
import { isActiveFilter, type FilterSpec } from '../document/filters';
import type { ImageLike } from './colorOps';

export type { ImageLike };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ---------------------------------------------------------------------------
// Blur
// ---------------------------------------------------------------------------

/**
 * Three box passes per axis, which is the standard approximation of a Gaussian.
 *
 * Three is not arbitrary: one box blur is visibly square, two is a triangle,
 * and the third convolution is where the result becomes indistinguishable from
 * a Gaussian at the radii anyone uses.
 *
 * **`radius` is the standard deviation**, the same quantity CSS's
 * `filter: blur()` and SVG's `stdDeviation` take, so a blur of 6 means the same
 * spread here, in an export and in a browser. The exporter writes it straight
 * through for exactly that reason.
 */
export function blurImage(image: ImageLike, radius: number): void {
  if (radius <= 0) return;
  const widths = boxSizes(radius, 3);
  // Every pass a single pixel wide is an identity convolution — a blur too
  // small for the pixel grid to express. Bailing out here is what keeps that
  // from costing a premultiply and three passes to produce the input.
  if (widths.every((width) => width <= 1)) return;

  premultiply(image.data);
  const scratch = new Uint8ClampedArray(image.data.length);
  for (const width of widths) {
    boxBlurHorizontal(image.data, scratch, image.width, image.height, width);
    boxBlurHorizontal(scratch, image.data, image.width, image.height, width, true);
  }
  unpremultiply(image.data);
}

/**
 * The `count` box widths whose convolution has the requested standard deviation.
 *
 * The widths are **not all the same**, and that is the point. Rounding one
 * ideal width down to the nearest odd integer and using it three times loses
 * whatever the rounding discarded, and for a small radius it discards
 * everything: the ideal width for σ = 1 is 2.24, which rounds to 1, which is
 * the identity — so every blur below about σ = 1.5 quietly did nothing. Mixing
 * `wl` and `wl + 2` across the passes is how the remainder is spent instead.
 */
function boxSizes(sigma: number, count: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / count + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  lower = Math.max(1, lower);
  const upper = lower + 2;

  // How many passes take the narrower width, from matching the total variance.
  const idealCount =
    (12 * sigma * sigma - count * lower * lower - 4 * count * lower - 3 * count) / (-4 * lower - 4);
  const narrow = Math.round(idealCount);

  return Array.from({ length: count }, (_, i) => (i < narrow ? lower : upper));
}

/**
 * One box pass. `transpose` runs it down the columns instead, which is how the
 * vertical pass is the same code — a separable blur is the horizontal one twice
 * with the axes swapped, and writing it once is what keeps the two identical.
 */
function boxBlurHorizontal(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  box: number,
  transpose = false,
): void {
  const reach = (box - 1) / 2;
  const outerCount = transpose ? width : height;
  const innerCount = transpose ? height : width;
  const innerStride = transpose ? width * 4 : 4;
  const outerStride = transpose ? 4 : width * 4;

  for (let outer = 0; outer < outerCount; outer++) {
    const rowStart = outer * outerStride;
    let r = 0, g = 0, b = 0, a = 0;

    // Seed the window with the first `reach + 1` samples plus `reach` copies of
    // the edge pixel, so the clamped edge is handled by the running sum rather
    // than by a branch inside the loop.
    for (let i = -reach; i <= reach; i++) {
      const at = rowStart + clamp(i, 0, innerCount - 1) * innerStride;
      r += source[at]; g += source[at + 1]; b += source[at + 2]; a += source[at + 3];
    }

    for (let i = 0; i < innerCount; i++) {
      const out = rowStart + i * innerStride;
      target[out] = r / box;
      target[out + 1] = g / box;
      target[out + 2] = b / box;
      target[out + 3] = a / box;

      const leaving = rowStart + clamp(i - reach, 0, innerCount - 1) * innerStride;
      const entering = rowStart + clamp(i + reach + 1, 0, innerCount - 1) * innerStride;
      r += source[entering] - source[leaving];
      g += source[entering + 1] - source[leaving + 1];
      b += source[entering + 2] - source[leaving + 2];
      a += source[entering + 3] - source[leaving + 3];
    }
  }
}

function premultiply(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha === 1) continue;
    pixels[i] *= alpha;
    pixels[i + 1] *= alpha;
    pixels[i + 2] *= alpha;
  }
}

function unpremultiply(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha === 0 || alpha === 1) continue;
    pixels[i] /= alpha;
    pixels[i + 1] /= alpha;
    pixels[i + 2] /= alpha;
  }
}

// ---------------------------------------------------------------------------
// Sharpen
// ---------------------------------------------------------------------------

/**
 * Unsharp mask: the image plus what a small blur removed from it.
 *
 * A convolution kernel would be one pass instead of two, and would also fix the
 * radius at one pixel; going through the blur means "sharpen" at 300% on a
 * 4000-pixel photo behaves the same as at 100%, and shares its edge handling
 * with everything else here.
 *
 * **Alpha is left alone**, which matches the `preserveAlpha="true"` the SVG
 * exporter writes on its `feConvolveMatrix` — the two emitters have to mean the
 * same thing. It also means sharpening a layer whose *shape* is soft does
 * nothing: the softness is in the alpha, and hardening that would be an edge
 * this filter never blurred.
 */
export function sharpenImage(image: ImageLike, amount: number): void {
  if (amount <= 0) return;
  const blurred: ImageLike = {
    data: new Uint8ClampedArray(image.data),
    width: image.width,
    height: image.height,
  };
  blurImage(blurred, 2);

  const strength = amount / 100;
  const a = image.data;
  const b = blurred.data;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0) continue;
    a[i] += (a[i] - b[i]) * strength;
    a[i + 1] += (a[i + 1] - b[i + 1]) * strength;
    a[i + 2] += (a[i + 2] - b[i + 2]) * strength;
  }
}

// ---------------------------------------------------------------------------
// Pixelate
// ---------------------------------------------------------------------------

/**
 * Square blocks of the average colour, averaged **premultiplied**.
 *
 * The alpha is averaged with the colour rather than thresholded, so a block
 * half over the edge of a layer comes out half transparent instead of turning
 * the edge into a staircase of opaque squares.
 */
export function pixelateImage(image: ImageLike, size: number): void {
  const block = Math.max(2, Math.round(size));
  const { width, height, data } = image;

  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const right = Math.min(bx + block, width);
      const bottom = Math.min(by + block, height);
      let r = 0, g = 0, b = 0, a = 0, count = 0;

      for (let y = by; y < bottom; y++) {
        for (let x = bx; x < right; x++) {
          const at = (y * width + x) * 4;
          const alpha = data[at + 3] / 255;
          r += data[at] * alpha;
          g += data[at + 1] * alpha;
          b += data[at + 2] * alpha;
          a += data[at + 3];
          count++;
        }
      }
      if (count === 0) continue;

      // The colour sums are premultiplied, so dividing by the *alpha* total
      // rather than by the pixel count is what un-premultiplies them — divide
      // by the count and a block that is mostly transparent comes out dark.
      const meanAlpha = a / count;
      const alphaTotal = a / 255;
      const colourR = alphaTotal === 0 ? 0 : r / alphaTotal;
      const colourG = alphaTotal === 0 ? 0 : g / alphaTotal;
      const colourB = alphaTotal === 0 ? 0 : b / alphaTotal;

      for (let y = by; y < bottom; y++) {
        for (let x = bx; x < right; x++) {
          const at = (y * width + x) * 4;
          data[at] = colourR;
          data[at + 1] = colourG;
          data[at + 2] = colourB;
          data[at + 3] = meanAlpha;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shadow and glow
// ---------------------------------------------------------------------------

/**
 * A coloured, blurred copy of the layer's own alpha, composited **underneath**
 * it.
 *
 * Underneath is the whole difference between a shadow and a tint, and it is why
 * this cannot be a colour operation: the result has pixels where the source had
 * none. The source is then drawn back over the shadow with ordinary
 * source-over, premultiplied, because that is what the compositor would do.
 */
export function dropShadow(
  image: ImageLike,
  options: { dx: number; dy: number; blur: number; color: string; opacity: number },
): void {
  const rgba = parseRgba(options.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const shadow = shadowLayer(image, options.blur, rgba, options.opacity, options.dx, options.dy);
  compositeOver(shadow, image);
  image.data.set(shadow.data);
}

/** A shadow with no offset and a strength that can push it past opaque. */
export function glow(
  image: ImageLike,
  options: { radius: number; color: string; strength: number },
): void {
  const rgba = parseRgba(options.color) ?? { r: 255, g: 255, b: 255, a: 1 };
  const halo = shadowLayer(image, options.radius, rgba, Math.min(1, options.strength), 0, 0);
  // A strength above 1 repeats the halo rather than clipping the alpha at the
  // first pass, which is what makes a glow able to read as light rather than as
  // a coloured outline.
  const repeats = Math.max(0, Math.ceil(options.strength) - 1);
  for (let i = 0; i < repeats; i++) {
    const extra: ImageLike = {
      data: new Uint8ClampedArray(halo.data),
      width: halo.width,
      height: halo.height,
    };
    compositeOver(halo, extra);
  }
  compositeOver(halo, image);
  image.data.set(halo.data);
}

/** The source's alpha, offset, blurred and tinted — the shape a shadow is. */
function shadowLayer(
  image: ImageLike,
  blurRadius: number,
  color: Rgba,
  opacity: number,
  dx: number,
  dy: number,
): ImageLike {
  const { width, height } = image;
  const out: ImageLike = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const shiftX = Math.round(dx);
  const shiftY = Math.round(dy);

  for (let y = 0; y < height; y++) {
    const sourceY = y - shiftY;
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = 0; x < width; x++) {
      const sourceX = x - shiftX;
      if (sourceX < 0 || sourceX >= width) continue;
      const from = (sourceY * width + sourceX) * 4 + 3;
      const alpha = image.data[from];
      if (alpha === 0) continue;
      const at = (y * width + x) * 4;
      out.data[at] = color.r;
      out.data[at + 1] = color.g;
      out.data[at + 2] = color.b;
      out.data[at + 3] = alpha * color.a * opacity;
    }
  }

  blurImage(out, blurRadius);
  return out;
}

/** `top` over `base`, in place on `base`. Straight Porter-Duff source-over. */
function compositeOver(base: ImageLike, top: ImageLike): void {
  const b = base.data;
  const t = top.data;
  for (let i = 0; i < b.length; i += 4) {
    const topAlpha = t[i + 3] / 255;
    if (topAlpha === 0) continue;
    if (topAlpha === 1) {
      b[i] = t[i]; b[i + 1] = t[i + 1]; b[i + 2] = t[i + 2]; b[i + 3] = 255;
      continue;
    }
    const baseAlpha = (b[i + 3] / 255) * (1 - topAlpha);
    const outAlpha = topAlpha + baseAlpha;
    if (outAlpha === 0) continue;
    b[i] = (t[i] * topAlpha + b[i] * baseAlpha) / outAlpha;
    b[i + 1] = (t[i + 1] * topAlpha + b[i + 1] * baseAlpha) / outAlpha;
    b[i + 2] = (t[i + 2] * topAlpha + b[i + 2] * baseAlpha) / outAlpha;
    b[i + 3] = outAlpha * 255;
  }
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/**
 * A hash of the pixel index, in −1…1.
 *
 * Deterministic by construction rather than by seeding a generator: a generator
 * has to be advanced in a fixed order, and the compositor may visit a layer's
 * pixels in a different order on the screen than in an export. A pure function
 * of the coordinate cannot drift.
 */
function pixelNoise(index: number, channel: number): number {
  let h = (index * 0x27d4eb2d) ^ (channel * 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

export function addNoise(image: ImageLike, amount: number, monochrome: boolean): void {
  const strength = (amount / 100) * 255;
  const data = image.data;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue;
    if (monochrome) {
      const shift = pixelNoise(p, 0) * strength;
      data[i] += shift;
      data[i + 1] += shift;
      data[i + 2] += shift;
      continue;
    }
    data[i] += pixelNoise(p, 0) * strength;
    data[i + 1] += pixelNoise(p, 1) * strength;
    data[i + 2] += pixelNoise(p, 2) * strength;
  }
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/**
 * Every enabled filter, in order, over one surface's pixels.
 *
 * Order is the document's, not a fixed pipeline: sharpening a blur and blurring
 * a sharpen are different pictures, and the layer's filter list is the only
 * place that choice can live.
 */
export function applyFilterChain(image: ImageLike, filters: readonly FilterSpec[]): void {
  for (const filter of filters) {
    if (!isActiveFilter(filter)) continue;
    switch (filter.kind) {
      case 'blur':
        blurImage(image, filter.radius);
        break;
      case 'sharpen':
        sharpenImage(image, filter.amount);
        break;
      case 'pixelate':
        pixelateImage(image, filter.size);
        break;
      case 'drop-shadow':
        dropShadow(image, filter);
        break;
      case 'glow':
        glow(image, filter);
        break;
      case 'noise':
        addNoise(image, filter.amount, filter.monochrome);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/**
 * The same chain as SVG filter primitives.
 *
 * Four of the six have an exact equivalent in the format and are written as
 * one. **Pixelate and noise do not** — SVG has no block-average primitive, and
 * `feTurbulence` is Perlin noise rather than per-pixel grain, so an
 * approximation would be a different picture wearing the same name. Those two
 * are skipped here and reported by `unsupportedSvgFilters`, so the export
 * dialog can say what a `.svg` will lose; an `.ora` loses nothing, because
 * every layer there is rasterised through the chain above.
 *
 * The region is widened well past the default 10% margin: a 200-pixel glow on a
 * small layer reaches far outside its own bounding box, and the default region
 * would cut it into a rectangle.
 */
export function filterChainToSvg(id: string, filters: readonly FilterSpec[]): string | null {
  const primitives: string[] = [];

  for (const filter of filters) {
    if (!isActiveFilter(filter)) continue;
    switch (filter.kind) {
      case 'blur':
        primitives.push(`<feGaussianBlur stdDeviation="${filter.radius}"/>`);
        break;
      case 'sharpen': {
        // A 3×3 Laplacian scaled by the amount, with the centre carrying the
        // original — the convolution form of the unsharp mask above.
        const k = filter.amount / 100;
        const centre = 1 + 4 * k;
        primitives.push(
          `<feConvolveMatrix order="3" preserveAlpha="true" ` +
          `kernelMatrix="0 ${-k} 0 ${-k} ${centre} ${-k} 0 ${-k} 0"/>`,
        );
        break;
      }
      case 'drop-shadow':
        primitives.push(
          `<feDropShadow dx="${filter.dx}" dy="${filter.dy}" stdDeviation="${filter.blur}" ` +
          `flood-color="${filter.color}" flood-opacity="${filter.opacity}"/>`,
        );
        break;
      case 'glow':
        primitives.push(
          `<feDropShadow dx="0" dy="0" stdDeviation="${filter.radius}" ` +
          `flood-color="${filter.color}" flood-opacity="${Math.min(1, filter.strength)}"/>`,
        );
        break;
      default:
        break;
    }
  }

  if (primitives.length === 0) return null;
  return (
    `<filter id="${id}" color-interpolation-filters="sRGB" ` +
    `x="-50%" y="-50%" width="200%" height="200%">${primitives.join('')}</filter>`
  );
}

/** The filters an SVG export cannot carry, by label, for a warning. */
export function unsupportedSvgFilters(filters: readonly FilterSpec[]): FilterSpec['kind'][] {
  const out = new Set<FilterSpec['kind']>();
  for (const filter of filters) {
    if (!isActiveFilter(filter)) continue;
    if (filter.kind === 'pixelate' || filter.kind === 'noise') out.add(filter.kind);
  }
  return [...out];
}
