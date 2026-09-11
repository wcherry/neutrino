/**
 * Paper — the tooth a stroke is laid onto.
 *
 * A pencil on cartridge paper is not a pencil on a smooth plate, and the whole
 * of the difference is that the graphite only reaches the high points of the
 * surface. So this is not a filter applied to a finished stroke: it is a mask
 * multiplied into the stroke's alpha, **anchored to the canvas rather than to
 * the stroke**, which is the one property that makes it read as paper. Two
 * passes over the same place hit the same peaks and miss the same pits, exactly
 * as they do on the real thing, and a stroke drawn left-to-right has the same
 * grain as one drawn upward through it.
 *
 * The grain is procedural and periodic. A tileable 128px patch of value noise
 * costs one small buffer per session instead of a shipped texture per paper,
 * and periodicity is what lets a repeating pattern cover a canvas of any size
 * without a seam. `GRAIN_TILE` is therefore the period of everything here: the
 * lattice wraps modulo it and the weave's threads divide it.
 *
 * Nothing in this module touches a canvas — it produces numbers and one RGBA
 * buffer, so the grain of every paper can be asserted in jsdom.
 */

export type PaperType = 'smooth' | 'vellum' | 'cold-press' | 'rough' | 'canvas';

export interface PaperGrain {
  /**
   * How deep the pits go, 0–1.
   *
   * 0 is a perfectly smooth surface and is short-circuited everywhere — no
   * buffer, no pattern, no extra compositing pass.
   */
  depth: number;
  /**
   * Width of one lattice cell in pixels — the coarseness of the tooth.
   *
   * Must divide `GRAIN_TILE`, or the noise stops being periodic and the pattern
   * shows a seam every 128 pixels.
   */
  cell: number;
  /**
   * How sharply the tooth cuts, 0–1.
   *
   * The difference between a wash of light and dark and an actual surface.
   * Graphite does not shade off gently into a pit — it reaches the peak or it
   * misses, so a high bite collapses the grain towards "all" and "nothing" and
   * the stroke breaks up rather than merely varying in weight. At 0 the grain
   * is a smooth gradient, which is what a wet medium's granulation wants.
   */
  bite: number;
  /** How much of a woven cross-hatch is mixed over the noise, 0–1. */
  weave: number;
  /** Threads across one tile, for the weave. Ignored when `weave` is 0. */
  threads: number;
}

/** The period of the grain, in canvas pixels. */
export const GRAIN_TILE = 128;

export const PAPER_TYPES: readonly PaperType[] = [
  'smooth', 'vellum', 'cold-press', 'rough', 'canvas',
];

export const PAPER_LABELS: Record<PaperType, string> = {
  smooth: 'Smooth (hot press)',
  vellum: 'Vellum',
  'cold-press': 'Cold press',
  rough: 'Rough',
  canvas: 'Canvas',
};

export const PAPER_GRAINS: Record<PaperType, PaperGrain> = {
  // A plate-finished surface has no tooth worth modelling, and saying so with a
  // zero is what keeps the smooth case free rather than merely cheap. Its
  // `bite` is not dead: a medium that granulates on a smooth sheet borrows
  // these settings at its own depth, and wants a soft one.
  smooth: { depth: 0, cell: 8, bite: 0.3, weave: 0, threads: 0 },
  vellum: { depth: 0.45, cell: 4, bite: 0.42, weave: 0, threads: 0 },
  'cold-press': { depth: 0.72, cell: 8, bite: 0.58, weave: 0, threads: 0 },
  // Nearly full depth: on rough paper the pits get almost no graphite, and the
  // white showing through them is the whole look. Anything less is a grey wash.
  rough: { depth: 0.95, cell: 16, bite: 0.7, weave: 0, threads: 0 },
  // Canvas is woven, not fibrous: its texture is two sets of threads, which
  // noise alone cannot say however it is tuned. Both the weave's weight and its
  // `bite` are held well below every other paper's, and the threads are fine
  // rather than coarse — a hard, large-celled lattice stops reading as cloth
  // and starts reading as a halftone screen.
  canvas: { depth: 0.78, cell: 8, bite: 0.38, weave: 0.35, threads: 32 },
};

export function grainFor(paper: PaperType): PaperGrain {
  return PAPER_GRAINS[paper] ?? PAPER_GRAINS.smooth;
}

/** Whether a paper and a medium between them ask for any grain at all. */
export function hasGrain(grain: PaperGrain): boolean {
  return grain.depth > 0;
}

/** The same grain at a different depth, for a medium's own granulation. */
export function withDepth(grain: PaperGrain, depth: number): PaperGrain {
  return { ...grain, depth: Math.min(1, Math.max(0, depth)) };
}

/**
 * The tooth as a given brush width actually meets it.
 *
 * **A broad soft pencil rides the peaks; a fine point gets down into the pits.**
 * That is true of the real thing, and it is also what stops the grain destroying a
 * thin stroke: the tooth is a fixed size in canvas pixels, so without this a
 * three-pixel line on rough paper can sit entirely inside one hollow and simply
 * not be drawn — the setting stops being a texture and becomes a chance of
 * having painted at all.
 *
 * Never all the way to zero, or a fine pencil on rough paper would be
 * indistinguishable from one on a plate.
 */
export function grainForSize(grain: PaperGrain, brushSize: number): PaperGrain {
  if (grain.depth <= 0) return grain;
  const span = Math.min(1, Math.max(0, brushSize / (grain.cell * 2)));
  return withDepth(grain, grain.depth * (0.3 + 0.7 * span));
}

/**
 * How much of a stroke survives at a point — 1 on a peak, `1 - depth` in a pit.
 *
 * Periodic in both axes with period `GRAIN_TILE`, so the caller may pass raw
 * canvas coordinates and two strokes over the same spot get the same answer.
 */
export function grainAt(x: number, y: number, grain: PaperGrain): number {
  if (grain.depth <= 0) return 1;

  // Three octaves rather than two. A sheet has structure at more than one
  // scale — the hollows you can see and the fibre inside them — and two
  // octaves gives a blobby surface that reads as a smudge rather than a tooth.
  const coarse = latticeNoise(x, y, grain.cell, 1);
  const mid = latticeNoise(x, y, Math.max(1, grain.cell / 2), 2);
  const fine = latticeNoise(x, y, Math.max(1, grain.cell / 4), 3);
  // Weighted fairly evenly rather than steeply towards the coarse octave: let
  // the coarse one dominate and a sheet becomes a few big hollows, which a
  // narrow stroke falls into whole.
  let value = coarse * 0.42 + mid * 0.34 + fine * 0.24;

  if (grain.weave > 0 && grain.threads > 0) {
    const k = (Math.PI * 2 * grain.threads) / GRAIN_TILE;
    const ribs = 0.5 + 0.5 * Math.sin(x * k) * Math.sin(y * k);
    value = value * (1 - grain.weave) + ribs * grain.weave;
  }

  return 1 - grain.depth * (1 - tooth(value, grain.bite));
}

/**
 * The noise field turned into a surface.
 *
 * Graphite does not fade gently into a hollow: it sits on what it can reach and
 * misses the rest, so the useful shape here is **contrast**, not brightness.
 * `bite` narrows a smoothstep window until the field is very nearly a threshold
 * — peaks fully taking the stroke, pits taking none of it — and the ragged edge
 * that falls out of that is most of what makes a pencil line look drawn rather
 * than stroked.
 *
 * The window sits a little below the middle of the range because the graphite
 * should reach rather more than half the sheet; centring it exactly would take
 * away half of every stroke on textured paper.
 */
function tooth(value: number, bite: number): number {
  const half = Math.max(0.02, (1 - clamp01(bite)) * 0.5);
  const low = TOOTH_CENTER - half;
  const t = clamp01((value - low) / (2 * half));
  return t * t * (3 - 2 * t);
}

/** Where the surface sits in the noise's range — below the middle, see `tooth`. */
const TOOTH_CENTER = 0.44;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * One tile of the grain as RGBA, white with the grain in the alpha channel.
 *
 * White because the buffer is used as a `destination-in` mask, where only alpha
 * is read — but a colour still has to be written, and white is the one that
 * cannot tint anything if a caller ever draws it normally by mistake.
 */
export function buildGrainTile(grain: PaperGrain): Uint8ClampedArray {
  const data = new Uint8ClampedArray(GRAIN_TILE * GRAIN_TILE * 4);
  for (let y = 0; y < GRAIN_TILE; y++) {
    for (let x = 0; x < GRAIN_TILE; x++) {
      const i = (y * GRAIN_TILE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * grainAt(x, y, grain));
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/**
 * Value noise on a wrapping lattice.
 *
 * Wrapping is the whole reason this is hand-written rather than any of the
 * usual one-liners: a pattern repeated across a canvas has to meet itself
 * exactly, and a lattice that does not wrap leaves a visible grid of seams.
 */
function latticeNoise(x: number, y: number, cell: number, salt: number): number {
  const period = Math.max(1, Math.round(GRAIN_TILE / cell));
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  // Smoothstep, so the lattice reads as a surface rather than as diamonds.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const xa = wrap(x0, period);
  const xb = wrap(x0 + 1, period);
  const ya = wrap(y0, period);
  const yb = wrap(y0 + 1, period);

  const top = lerp(hash(xa, ya, salt), hash(xb, ya, salt), sx);
  const bottom = lerp(hash(xa, yb, salt), hash(xb, yb, salt), sx);
  return lerp(top, bottom, sy);
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A lattice point's value: deterministic, uniform enough, and no table. */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
