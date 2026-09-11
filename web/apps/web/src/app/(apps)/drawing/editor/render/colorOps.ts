/**
 * Applying a colour operation — to pixels, and to SVG.
 *
 * Two emitters that have to agree, on the same terms as `vectorObject.ts`: the
 * canvas compositor runs `applyColorOps` over an `ImageData`, and the SVG
 * exporter writes `colorOpToSvg` into a `<filter>`. Because `document/adjustments.ts`
 * reduces all eight adjustments to a LUT or a 4×5 matrix, each emitter has
 * exactly two cases and there is nothing per-adjustment to keep in step.
 *
 * The mapping to SVG is *exact* rather than approximate, which is the reason
 * for the reduction in the first place:
 *
 * - a LUT is `feComponentTransfer` with three `type="table"` functions;
 * - a matrix is `feColorMatrix type="matrix"`, whose twenty values are already
 *   in the order and the scale the model stores them in.
 *
 * One attribute is load-bearing and easy to omit: **`color-interpolation-filters="sRGB"`**.
 * SVG filters operate in linearRGB by default, canvas pixels are sRGB, and a
 * brightness curve applied in the wrong space is visibly different — darker
 * midtones, washed highlights — while looking like a rounding difference. Every
 * filter this module contributes to carries it.
 */

import { type ColorOp } from '../document/adjustments';

/** Anything shaped like an `ImageData`. Kept structural so tests need no canvas. */
export interface ImageLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Runs the operations over the pixels, in place.
 *
 * Alpha is carried through a LUT untouched — a tone curve is about colour, and
 * a table that dimmed the alpha as well would make every adjustment a fade —
 * while a matrix may rewrite it, because `feColorMatrix` can and the two
 * emitters have to mean the same thing.
 *
 * Fully transparent pixels are skipped. Their RGB is usually zero and adjusting
 * it changes nothing visible, but a canvas-sized surface is mostly transparent
 * in a drawing with small layers, and skipping is most of the cost.
 */
export function applyColorOps(image: ImageLike, ops: readonly ColorOp[]): void {
  const pixels = image.data;
  for (const op of ops) {
    if (op.kind === 'lut') {
      const { r, g, b } = op;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) continue;
        pixels[i] = r[pixels[i]];
        pixels[i + 1] = g[pixels[i + 1]];
        pixels[i + 2] = b[pixels[i + 2]];
      }
      continue;
    }

    const m = op.values;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      const alpha = pixels[i + 3];
      // The fifth column is an offset in 0–1 units, so it scales back up by 255
      // here; everything else is a plain weighted sum of 8-bit channels.
      pixels[i] = m[0] * red + m[1] * green + m[2] * blue + m[3] * alpha + m[4] * 255;
      pixels[i + 1] = m[5] * red + m[6] * green + m[7] * blue + m[8] * alpha + m[9] * 255;
      pixels[i + 2] = m[10] * red + m[11] * green + m[12] * blue + m[13] * alpha + m[14] * 255;
      pixels[i + 3] = m[15] * red + m[16] * green + m[17] * blue + m[18] * alpha + m[19] * 255;
    }
  }
}

/**
 * `source` blended towards `adjusted` by a per-pixel weight.
 *
 * This is how a mask and an opacity reach an adjustment layer. The operation
 * has already been applied to `adjusted` over the whole surface; mixing back
 * towards the original is the only way to apply a *partial* correction, because
 * half a hue rotation is not a hue rotation applied to half the pixels.
 *
 * `weights` is an alpha channel in the same pixel grid — the mask's own — or
 * null for "everywhere".
 */
export function blendAdjusted(
  source: ImageLike,
  adjusted: ImageLike,
  strength: number,
  weights: Uint8ClampedArray | null,
): void {
  const a = source.data;
  const b = adjusted.data;
  for (let i = 0; i < a.length; i += 4) {
    const weight = weights ? (weights[i + 3] / 255) * strength : strength;
    if (weight <= 0) continue;
    if (weight >= 1) {
      a[i] = b[i];
      a[i + 1] = b[i + 1];
      a[i + 2] = b[i + 2];
      a[i + 3] = b[i + 3];
      continue;
    }
    a[i] += (b[i] - a[i]) * weight;
    a[i + 1] += (b[i + 1] - a[i + 1]) * weight;
    a[i + 2] += (b[i + 2] - a[i + 2]) * weight;
    a[i + 3] += (b[i + 3] - a[i + 3]) * weight;
  }
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/** Trims float noise: `0.7150000000000001` is not a number anyone needs to read. */
function short(value: number): string {
  return String(Math.round(value * 1e5) / 1e5);
}

/**
 * A table's values, as the `tableValues` attribute.
 *
 * All 256 entries rather than a sample of them. `feComponentTransfer`
 * interpolates linearly between whatever it is given, so a coarse sample would
 * round the shoulders off a levels curve and turn a posterize into a gradient —
 * the two adjustments whose whole point is a shape that a few control points
 * cannot describe. The cost is a few kilobytes in an export whose images are
 * measured in megabytes.
 */
function tableValues(lut: Uint8ClampedArray): string {
  const out: string[] = new Array(256);
  for (let i = 0; i < 256; i++) out[i] = short(lut[i] / 255);
  return out.join(' ');
}

/** One operation as SVG filter primitives, for use inside a `<filter>` element. */
export function colorOpToSvg(op: ColorOp): string {
  if (op.kind === 'matrix') {
    return `<feColorMatrix type="matrix" values="${op.values.map(short).join(' ')}"/>`;
  }
  return (
    '<feComponentTransfer>' +
    `<feFuncR type="table" tableValues="${tableValues(op.r)}"/>` +
    `<feFuncG type="table" tableValues="${tableValues(op.g)}"/>` +
    `<feFuncB type="table" tableValues="${tableValues(op.b)}"/>` +
    '</feComponentTransfer>'
  );
}

/**
 * A whole adjustment as a `<filter>` element.
 *
 * `x`/`y`/`width`/`height` are pushed out to the full region because the
 * default filter region is the source's bounding box grown by 10%, and an
 * adjustment applied to a whole stack must not crop it.
 */
export function colorOpsFilter(id: string, ops: readonly ColorOp[]): string {
  return (
    `<filter id="${id}" color-interpolation-filters="sRGB" ` +
    `x="-20%" y="-20%" width="140%" height="140%">${ops.map(colorOpToSvg).join('')}</filter>`
  );
}
