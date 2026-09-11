/**
 * Splatter — what turns an airbrush into a spray can.
 *
 * A soft radial dab is an *airbrush*: an even cloud with no structure in it,
 * which is right for a retouching tool and wrong for paint leaving a nozzle.
 * Real spray breaks into droplets, the droplets are not the same size, they are
 * denser at the middle of the cone than at its edge, and some of them land
 * outside it altogether — that last one, overspray, is most of why a stencilled
 * edge looks sprayed rather than cut.
 *
 * So `splatter` replaces the single dab with a scatter of small discs. It is
 * one number because it is one physical thing (how far from the nozzle, near
 * enough): turn it up and the cone widens, the droplets get finer and more
 * numerous, and the overspray grows.
 *
 * Pure arithmetic, and the randomness is injected rather than taken from
 * `Math.random`, so a session can be replayed and a test can assert where the
 * droplets went.
 */

import type { Stamp } from './stroke';

/** One droplet of a splattered dab. */
export interface Droplet {
  x: number;
  y: number;
  /** Radius in canvas pixels — a radius, not a diameter, unlike `Stamp.size`. */
  radius: number;
  alpha: number;
}

/**
 * A droplet is never smaller than this.
 *
 * Below about a third of a pixel a filled arc is antialiased down to nothing
 * visible, so finer droplets would quietly make the spray fainter rather than
 * finer — the slider would read as a second opacity control.
 */
const MIN_DROPLET_RADIUS = 0.35;

/**
 * Droplets in the densest spray.
 *
 * Bounded because each one is an arc fill, and the airbrush stamps every couple
 * of pixels. The bound is what makes the finest spray lighter per dab rather
 * than slower — and the dabs overlap heavily enough that the mark builds up to
 * the same place.
 */
const MAX_DROPLETS = 24;

/** Fewest, for a splatter barely off zero. */
const MIN_DROPLETS = 3;

/** How much of the cone the droplets cover between them, by area. */
const COVERAGE = 0.45;

/**
 * A dab broken into droplets, or an empty array when the brush is not splattering.
 *
 * Empty rather than "one droplet in the middle" so the caller keeps its plain
 * path: a splatter of zero has to be pixel-for-pixel the old airbrush, or
 * turning the setting on and back off would change the tool.
 */
export function splatterDroplets(
  stamp: Stamp,
  amount: number,
  random: () => number,
): Droplet[] {
  const splatter = clamp01(amount);
  if (splatter <= 0) return [];

  const radius = Math.max(0.5, stamp.size / 2);
  // Beyond 1 is overspray: droplets landing outside the dab the brush nominally
  // covers, which is what a stencil edge needs to look sprayed.
  const spread = radius * (1 + 0.75 * splatter);
  // **Droplet size is set first and the count follows from it**, not the other
  // way round. Deriving the size from a count is what made a light splatter a
  // handful of fat blobs — the slider has to read as a finer nozzle, so the
  // droplets get smaller and more numerous together.
  const fineness = 0.28 - 0.16 * splatter;
  const base = radius * fineness;
  const count = clamp(
    Math.round((COVERAGE * (spread / radius) ** 2) / (fineness * fineness)),
    MIN_DROPLETS,
    MAX_DROPLETS,
  );

  const droplets: Droplet[] = [];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    // `u^0.75` rather than `sqrt(u)`: the latter spreads droplets evenly over
    // the disc, and a spray cone is denser in the middle than at the rim.
    const distance = spread * Math.pow(random(), 0.75);
    const falloff = 1 - 0.55 * (distance / spread);
    droplets.push({
      x: stamp.x + Math.cos(angle) * distance,
      y: stamp.y + Math.sin(angle) * distance,
      radius: Math.max(MIN_DROPLET_RADIUS, base * (0.55 + 0.9 * random())),
      alpha: clamp01(stamp.alpha * falloff * (0.45 + 0.55 * random())),
    });
  }
  return droplets;
}

/**
 * How hard a droplet's own edge is.
 *
 * A droplet is a speck of wet paint and has a defined rim whatever the brush's
 * hardness says — an airbrush sits at hardness 0, and drawing its droplets with
 * that falloff gives back the featureless cloud the splatter existed to break
 * up. The brush's own hardness is still honoured when it is the harder of the
 * two, so a hard brush does not get softened by turning splatter on.
 */
export function dropletHardness(hardness: number, amount: number): number {
  return Math.max(clamp01(hardness), 0.5 + 0.35 * clamp01(amount));
}

/**
 * A seeded uniform source (mulberry32).
 *
 * Seeded and not `Math.random` so a stroke is reproducible: a preview redrawn
 * after a commit, or a test asserting a droplet's position, both need the same
 * dab to break up the same way twice.
 */
export function randomSource(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;
}
