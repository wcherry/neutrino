/**
 * Adjustments — the parameters of a non-destructive colour change.
 *
 * Redesign §4 lists eight of them, and all eight are here. What makes them
 * *non-destructive* is that an adjustment layer stores these numbers and nothing
 * else: the pixels underneath are never rewritten, the effect is computed every
 * time the document is composited, and deleting the layer restores the original
 * exactly because the original never left.
 *
 * **Every adjustment reduces to one of two operations**, and that reduction is
 * the whole design of this module:
 *
 * - a **LUT** — three 256-entry tables, one per channel, where the new value of
 *   a channel depends only on its own old value; or
 * - a **matrix** — the 4×5 colour matrix SVG's `feColorMatrix` defines, where a
 *   channel's new value mixes the old channels together.
 *
 * Hue rotation and saturation are matrices because they mix channels. Levels,
 * curves, exposure, posterize and the rest are LUTs because they do not. The
 * point of collapsing eight adjustments onto two operations is that the canvas
 * compositor and the SVG exporter each implement *two* things rather than
 * eight, and cannot drift apart per adjustment — `render/colorOps.ts` is where
 * both live, and `feComponentTransfer`/`feColorMatrix` are the two SVG
 * primitives they map onto exactly.
 *
 * Nothing here touches a canvas, which is what lets the arithmetic be tested
 * without one.
 */

import type { Point } from './types';

// ---------------------------------------------------------------------------
// The specs
// ---------------------------------------------------------------------------

export type AdjustmentKind =
  | 'brightness-contrast'
  | 'levels'
  | 'curves'
  | 'hue-saturation'
  | 'color-balance'
  | 'exposure'
  | 'grayscale'
  | 'posterize';

/** Both in −100…100, where 0 is no change. */
export interface BrightnessContrastAdjustment {
  kind: 'brightness-contrast';
  brightness: number;
  contrast: number;
}

/**
 * The classic five-handle levels control.
 *
 * `inputBlack`/`inputWhite` are 0–255 and set what counts as black and white in
 * the source; `gamma` bends the midtones between them; `outputBlack`/
 * `outputWhite` are where those ends land. Written in that order because it is
 * the order the arithmetic applies in.
 */
export interface LevelsAdjustment {
  kind: 'levels';
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}

/**
 * A tone curve as control points in 0–255 × 0–255.
 *
 * Interpolated **linearly** between points rather than through a spline. A
 * spline can overshoot — three points can produce a curve that dips below the
 * first or above the last — and an overshooting tone curve is a posterised
 * highlight nobody asked for. Straight segments between the handles are what
 * the user drew.
 */
export interface CurvesAdjustment {
  kind: 'curves';
  /** `rgb` moves all three channels together; the others move one. */
  channel: 'rgb' | 'r' | 'g' | 'b';
  points: Point[];
}

/** `hue` in −180…180 degrees; `saturation` and `lightness` in −100…100. */
export interface HueSaturationAdjustment {
  kind: 'hue-saturation';
  hue: number;
  saturation: number;
  lightness: number;
}

/** Per-channel midtone shift, −100…100 each. */
export interface ColorBalanceAdjustment {
  kind: 'color-balance';
  red: number;
  green: number;
  blue: number;
}

/** `exposure` in stops; `offset` in −0.5…0.5 of full scale; `gamma` a divisor. */
export interface ExposureAdjustment {
  kind: 'exposure';
  exposure: number;
  offset: number;
  gamma: number;
}

/** 0–100, so a partial desaturation is possible rather than only "off or grey". */
export interface GrayscaleAdjustment {
  kind: 'grayscale';
  amount: number;
}

/** Distinct levels per channel, 2–64. */
export interface PosterizeAdjustment {
  kind: 'posterize';
  levels: number;
}

export type AdjustmentSpec =
  | BrightnessContrastAdjustment
  | LevelsAdjustment
  | CurvesAdjustment
  | HueSaturationAdjustment
  | ColorBalanceAdjustment
  | ExposureAdjustment
  | GrayscaleAdjustment
  | PosterizeAdjustment;

export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = [
  'brightness-contrast', 'levels', 'curves', 'hue-saturation',
  'color-balance', 'exposure', 'grayscale', 'posterize',
];

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  'brightness-contrast': 'Brightness / Contrast',
  'levels': 'Levels',
  'curves': 'Curves',
  'hue-saturation': 'Hue / Saturation',
  'color-balance': 'Colour Balance',
  'exposure': 'Exposure',
  'grayscale': 'Black & White',
  'posterize': 'Posterize',
};

/**
 * A newly added adjustment of each kind.
 *
 * Defaults are the **identity** wherever the identity is a setting the control
 * can express — adding a Levels layer changes nothing until a slider moves, and
 * an adjustment that altered the picture the instant it was created would read
 * as having damaged the drawing.
 *
 * **Black & White and Posterize are the two exceptions, necessarily.** Their
 * neutral settings are "don't desaturate" and "256 levels", which are not
 * points on their sliders and would not be worth offering if they were: a
 * Posterize layer that posterizes to 256 levels is an effect that appears to be
 * broken. Both default to the effect they are named for, and both are one
 * slider away from any other strength.
 */
export function createAdjustment(kind: AdjustmentKind): AdjustmentSpec {
  switch (kind) {
    case 'brightness-contrast':
      return { kind, brightness: 0, contrast: 0 };
    case 'levels':
      return { kind, inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 };
    case 'curves':
      return { kind, channel: 'rgb', points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    case 'hue-saturation':
      return { kind, hue: 0, saturation: 0, lightness: 0 };
    case 'color-balance':
      return { kind, red: 0, green: 0, blue: 0 };
    case 'exposure':
      return { kind, exposure: 0, offset: 0, gamma: 1 };
    case 'grayscale':
      return { kind, amount: 100 };
    case 'posterize':
      return { kind, levels: 8 };
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Three per-channel tables. A channel's new value depends only on its own old one. */
export interface LutOp {
  kind: 'lut';
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
}

/**
 * A 4×5 colour matrix, in `feColorMatrix` order and **normalised units**: the
 * twenty values act on channels scaled to 0–1, so the fifth column is an offset
 * in that same scale. Keeping SVG's convention rather than an 8-bit one means
 * the exporter writes `values` straight out with no conversion to get wrong.
 */
export interface MatrixOp {
  kind: 'matrix';
  values: number[];
}

export type ColorOp = LutOp | MatrixOp;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function identityLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  return lut;
}

/** A table built from a function of the input value. `Uint8ClampedArray` does the clamping. */
export function lutFrom(fn: (value: number) => number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(fn(i));
  return lut;
}

function sameLut(lut: Uint8ClampedArray): LutOp {
  return { kind: 'lut', r: lut, g: lut, b: lut };
}

export function isIdentityLut(lut: Uint8ClampedArray): boolean {
  for (let i = 0; i < 256; i++) if (lut[i] !== i) return false;
  return true;
}

/** Whether an operation would leave every pixel exactly as it found it. */
export function isIdentityOp(op: ColorOp): boolean {
  if (op.kind === 'lut') return isIdentityLut(op.r) && isIdentityLut(op.g) && isIdentityLut(op.b);
  return op.values.every((v, i) => v === IDENTITY_MATRIX[i]);
}

export const IDENTITY_MATRIX: readonly number[] = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/**
 * `outer` applied after `inner`, as one matrix.
 *
 * Both are 4×5, which is a 5×5 with an implied last row of `0 0 0 0 1` — the
 * row that carries the constant through. Writing it out rather than
 * special-casing the offset column is what keeps the composition ordinary
 * matrix multiplication.
 */
export function multiplyColorMatrix(outer: readonly number[], inner: readonly number[]): number[] {
  const row = (m: readonly number[], i: number): number[] =>
    (i === 4 ? [0, 0, 0, 0, 1] : m.slice(i * 5, i * 5 + 5));
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = row(outer, i);
    for (let j = 0; j < 5; j++) {
      let sum = 0;
      for (let k = 0; k < 5; k++) sum += a[k] * row(inner, k)[j];
      out.push(sum);
    }
  }
  return out;
}

/** The SVG filter spec's own `saturate` matrix. `s = 1` is the identity. */
export function saturateMatrix(s: number): number[] {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** The SVG filter spec's own `hueRotate` matrix, in degrees. */
export function hueRotateMatrix(degrees: number): number[] {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

// ---------------------------------------------------------------------------
// Spec → operations
// ---------------------------------------------------------------------------

/**
 * Linear interpolation through the curve's control points.
 *
 * Points outside 0–255 are tolerated and clamped rather than rejected: a curve
 * arrives from a drag, and refusing a handle dragged one pixel past the corner
 * would make the corner unreachable.
 */
export function curveLut(points: readonly Point[]): Uint8ClampedArray {
  const sorted = [...points]
    .map((p) => ({ x: clamp(p.x, 0, 255), y: clamp(p.y, 0, 255) }))
    .sort((a, b) => a.x - b.x);
  if (sorted.length < 2) return identityLut();

  return lutFrom((v) => {
    if (v <= sorted[0].x) return sorted[0].y;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (v > b.x) continue;
      const span = b.x - a.x;
      // Two handles at the same input is a vertical step; taking the upper one
      // keeps the table monotonic instead of dividing by zero.
      return span === 0 ? b.y : a.y + ((v - a.x) / span) * (b.y - a.y);
    }
    return sorted[sorted.length - 1].y;
  });
}

/**
 * How strongly a colour-balance shift applies at a given input level.
 *
 * A parabola peaking at mid-grey, so the shift fades out towards black and
 * white. A flat shift is what "add 20 to red" means arithmetically and not what
 * colour balance means photographically: it clips the highlights and lifts the
 * blacks off zero, turning a warm-up into a wash.
 */
function midtoneWeight(value: number): number {
  const t = (value / 255 - 0.5) * 2;
  return 1 - t * t;
}

export function adjustmentOps(spec: AdjustmentSpec): ColorOp[] {
  switch (spec.kind) {
    case 'brightness-contrast': {
      // The familiar contrast factor, with contrast expressed on the −255…255
      // scale the formula is written for.
      const c = clamp(spec.contrast, -100, 100) * 2.55;
      const factor = (259 * (c + 255)) / (255 * (259 - c));
      const shift = clamp(spec.brightness, -100, 100) * 2.55;
      return [sameLut(lutFrom((v) => factor * (v - 128) + 128 + shift))];
    }

    case 'levels': {
      const inBlack = clamp(spec.inputBlack, 0, 255);
      const inWhite = clamp(spec.inputWhite, 0, 255);
      const gamma = clamp(spec.gamma, 0.01, 10);
      const outBlack = clamp(spec.outputBlack, 0, 255);
      const outWhite = clamp(spec.outputWhite, 0, 255);
      const span = inWhite - inBlack;
      return [sameLut(lutFrom((v) => {
        // A collapsed input range is a hard threshold, which is a legitimate
        // thing to ask for and would otherwise be a division by zero.
        const normalized = span === 0 ? (v >= inWhite ? 1 : 0) : clamp((v - inBlack) / span, 0, 1);
        return outBlack + Math.pow(normalized, 1 / gamma) * (outWhite - outBlack);
      }))];
    }

    case 'curves': {
      const lut = curveLut(spec.points);
      if (spec.channel === 'rgb') return [sameLut(lut)];
      const identity = identityLut();
      return [{
        kind: 'lut',
        r: spec.channel === 'r' ? lut : identity,
        g: spec.channel === 'g' ? lut : identity,
        b: spec.channel === 'b' ? lut : identity,
      }];
    }

    case 'hue-saturation': {
      const saturation = 1 + clamp(spec.saturation, -100, 100) / 100;
      const matrix = multiplyColorMatrix(saturateMatrix(saturation), hueRotateMatrix(clamp(spec.hue, -360, 360)));
      const ops: ColorOp[] = [{ kind: 'matrix', values: matrix }];

      const lightness = clamp(spec.lightness, -100, 100);
      if (lightness !== 0) {
        // Lightness raises towards white or lowers towards black rather than
        // adding a constant, so a lightened highlight stays at white instead of
        // clipping several stops early.
        const t = lightness / 100;
        ops.push(sameLut(lutFrom((v) => (t > 0 ? v + (255 - v) * t : v * (1 + t)))));
      }
      return ops;
    }

    case 'color-balance': {
      const shift = (amount: number) => lutFrom((v) =>
        v + clamp(amount, -100, 100) * 1.275 * midtoneWeight(v));
      return [{ kind: 'lut', r: shift(spec.red), g: shift(spec.green), b: shift(spec.blue) }];
    }

    case 'exposure': {
      const gain = Math.pow(2, clamp(spec.exposure, -10, 10));
      const offset = clamp(spec.offset, -1, 1);
      const gamma = clamp(spec.gamma, 0.01, 10);
      return [sameLut(lutFrom((v) => 255 * Math.pow(clamp((v / 255) * gain + offset, 0, 1), 1 / gamma)))];
    }

    case 'grayscale':
      return [{ kind: 'matrix', values: saturateMatrix(1 - clamp(spec.amount, 0, 100) / 100) }];

    case 'posterize': {
      const levels = Math.round(clamp(spec.levels, 2, 255));
      return [sameLut(lutFrom((v) =>
        (Math.min(levels - 1, Math.floor((v / 256) * levels)) * 255) / (levels - 1)))];
    }
  }
}

/** Whether an adjustment would change anything at all — what the renderer skips on. */
export function isNeutralAdjustment(spec: AdjustmentSpec): boolean {
  return adjustmentOps(spec).every(isIdentityOp);
}

/** A one-line description of the settings, for the layers panel. */
export function describeAdjustment(spec: AdjustmentSpec): string {
  switch (spec.kind) {
    case 'brightness-contrast':
      return `${signed(spec.brightness)} brightness, ${signed(spec.contrast)} contrast`;
    case 'levels':
      return `${Math.round(spec.inputBlack)}–${Math.round(spec.inputWhite)}, γ ${spec.gamma.toFixed(2)}`;
    case 'curves':
      return `${spec.channel.toUpperCase()}, ${spec.points.length} points`;
    case 'hue-saturation':
      return `${signed(spec.hue)}° hue, ${signed(spec.saturation)} saturation`;
    case 'color-balance':
      return `${signed(spec.red)} / ${signed(spec.green)} / ${signed(spec.blue)}`;
    case 'exposure':
      return `${signed(spec.exposure)} stops, γ ${spec.gamma.toFixed(2)}`;
    case 'grayscale':
      return `${Math.round(spec.amount)}%`;
    case 'posterize':
      return `${Math.round(spec.levels)} levels`;
  }
}

function signed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}
