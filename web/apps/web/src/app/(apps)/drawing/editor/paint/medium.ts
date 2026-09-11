/**
 * The medium — what the paint *is*, and therefore how it meets what is under it.
 *
 * Size, flow and hardness describe a mark's shape. None of them can say the
 * difference between oil and watercolour, because that difference is not a
 * shape: oil is opaque and picks up whatever it is dragged through, watercolour
 * is a transparent glaze that multiplies with the paper and granulates as it
 * dries, gouache is flat and matte and covers in one pass. Those are three
 * different answers to "what happens where this stroke crosses something", and
 * a brush with no medium can only give one of them.
 *
 * A medium is a **modifier, not a preset**. Choosing one does not rewrite the
 * user's sliders — it biases what the engine does with them — so a medium can
 * be switched back and forth without the size and flow you set drifting away.
 *
 * The mixing model is a loaded bristle, not a per-dab sample. A brush carries
 * paint: drag it through wet red and the red comes with it for a while, fading
 * as fresh paint takes over. `pickUpLoad` is that carry, `dabColor` is what
 * ends up on the canvas, and both are pure so the mixing can be asserted
 * without a rendering context.
 *
 * One deliberate limit: the load samples the layer as it was when the stroke
 * began, not the stroke's own wet paint. Reading back the stroke buffer per dab
 * is a synchronous canvas readback per dab, which is the one thing that would
 * make a brush stutter — and picking up your own paint, which is already the
 * colour you are painting in, is the case that matters least.
 */

import type { BlendMode } from '../document/types';

export type PaintMedium = 'ink' | 'oil' | 'acrylic' | 'gouache' | 'watercolor';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1, unlike the 0–255 channels — it is a weight here, never a byte. */
  a: number;
}

export interface MediumProfile {
  /** How much of the colour on the layer shows in the paint, 0–1. */
  pickUp: number;
  /** How fast the bristles turn over what they are carrying, 0–1. */
  loadRate: number;
  /** Replaces the brush's own blend mode when set. */
  blend: BlendMode | null;
  /** Scales each dab's alpha — how thin the paint goes on. */
  flowScale: number;
  /**
   * Scales the whole stroke's alpha, applied once on the composite.
   *
   * Separate from `flowScale` for the same reason opacity is separate from
   * flow: thinning each dab of a densely spaced brush still ends in a stroke
   * buffer at nearly full alpha, and a glaze that arrives opaque is not a
   * glaze. Watercolour needs both; everything else needs neither.
   */
  opacityScale: number;
  /** Added to the brush's hardness; the body of the paint at the edge. */
  hardness: number;
  /** Texture the medium brings itself, over and above the paper's. */
  granulation: number;
}

export const PAINT_MEDIUMS: readonly PaintMedium[] = [
  'ink', 'oil', 'acrylic', 'gouache', 'watercolor',
];

export const MEDIUM_LABELS: Record<PaintMedium, string> = {
  ink: 'Ink',
  oil: 'Oil',
  acrylic: 'Acrylic',
  gouache: 'Gouache (poster)',
  watercolor: 'Watercolour',
};

export const MEDIUM_PROFILES: Record<PaintMedium, MediumProfile> = {
  // Not a paint so much as the absence of one: every field neutral, which is
  // what the pen, the pencil, the marker and the eraser want. Having a neutral
  // member means those tools need no exemption from the medium machinery.
  ink: {
    pickUp: 0, loadRate: 0, blend: null, flowScale: 1, opacityScale: 1, hardness: 0, granulation: 0,
  },
  // Slow-drying and heavily bodied: it picks up what it is dragged through and
  // lets go of it slowly, which is why an oil stroke across two colours is a
  // gradient of both rather than a line of one. Held under a half, because past
  // that the colour that was picked stops being visible at all and the medium
  // reads as a bug rather than as paint.
  oil: {
    pickUp: 0.45, loadRate: 0.25, blend: null, flowScale: 1, opacityScale: 1,
    hardness: 0.12, granulation: 0.08,
  },
  // Dries as it goes, so it lifts far less and clears what it carries quickly.
  acrylic: {
    pickUp: 0.3, loadRate: 0.4, blend: null, flowScale: 1, opacityScale: 1,
    hardness: 0.18, granulation: 0,
  },
  // Flat, matte and opaque — the point of poster paint is that one pass covers,
  // so it barely mixes and its edge is nearly hard.
  gouache: {
    pickUp: 0.12, loadRate: 0.5, blend: null, flowScale: 1, opacityScale: 1,
    hardness: 0.3, granulation: 0.05,
  },
  // A glaze: thin, multiplying with whatever it is over rather than hiding it,
  // soft at the edge, and granulating into the tooth as the water leaves.
  watercolor: {
    pickUp: 0.25, loadRate: 0.12, blend: 'multiply', flowScale: 0.4, opacityScale: 0.55,
    hardness: -0.25, granulation: 0.35,
  },
};

export function mediumFor(medium: PaintMedium): MediumProfile {
  return MEDIUM_PROFILES[medium] ?? MEDIUM_PROFILES.ink;
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

/**
 * What the bristles carry after touching a pixel.
 *
 * The colour is taken up in proportion to how much paint was actually there —
 * `sampled.a` — while the load's own alpha moves at the plain rate. Without
 * that weighting a brush dragged over bare canvas would load up with the
 * transparent pixels' nominal black and paint a grey smear.
 */
export function pickUpLoad(loaded: Rgba | null, sampled: Rgba, rate: number): Rgba | null {
  const t = clamp01(rate);
  if (!loaded) return sampled.a > 0 ? { ...sampled } : null;
  const colorT = t * clamp01(sampled.a);
  return {
    r: loaded.r + (sampled.r - loaded.r) * colorT,
    g: loaded.g + (sampled.g - loaded.g) * colorT,
    b: loaded.b + (sampled.b - loaded.b) * colorT,
    a: loaded.a + (sampled.a - loaded.a) * t,
  };
}

/**
 * The colour one dab actually lays down.
 *
 * The brush's own alpha survives untouched: mixing decides the hue, and how
 * transparent the paint is was already settled by flow, opacity and pressure.
 */
export function dabColor(paint: Rgba, loaded: Rgba | null, pickUp: number): Rgba {
  const t = clamp01(pickUp) * (loaded ? clamp01(loaded.a) : 0);
  if (!loaded || t <= 0) return paint;
  return {
    r: paint.r + (loaded.r - paint.r) * t,
    g: paint.g + (loaded.g - paint.g) * t,
    b: paint.b + (loaded.b - paint.b) * t,
    a: paint.a,
  };
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/**
 * A CSS colour as numbers, or null for anything not recognised.
 *
 * Handles the eight-digit hex the colour picker emits when alpha is in play, as
 * well as the three- and four-digit forms — a brush colour reaches here from
 * `localStorage` and from a picker, so "whatever was stored last" is the real
 * input domain.
 */
export function parseRgba(color: string): Rgba | null {
  const value = color.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const wide = digits.split('').map((c) => c + c).join('');
      return fromHexDigits(wide);
    }
    if (digits.length === 6 || digits.length === 8) return fromHexDigits(digits);
    return null;
  }

  const fn = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((p) => p.trim());
    if (parts.length < 3) return null;
    const [r, g, b] = parts;
    const alpha = parts[3];
    return {
      r: byte(r),
      g: byte(g),
      b: byte(b),
      a: alpha === undefined ? 1 : clamp01(alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)),
    };
  }

  return null;
}

export function rgbaToCss(color: Rgba): string {
  const r = Math.round(clampByte(color.r));
  const g = Math.round(clampByte(color.g));
  const b = Math.round(clampByte(color.b));
  return color.a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${round3(color.a)})`;
}

/** The same colour at zero alpha, for the outer stop of a dab's falloff. */
export function transparentRgbaCss(color: string): string {
  const parsed = parseRgba(color) ?? BLACK;
  return rgbaToCss({ ...parsed, a: 0 });
}

function fromHexDigits(digits: string): Rgba {
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
  };
}

function byte(part: string): number {
  const numeric = part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part);
  return clampByte(numeric);
}

function clampByte(value: number): number {
  return Number.isFinite(value) ? Math.min(255, Math.max(0, value)) : 0;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
