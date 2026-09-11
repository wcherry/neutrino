/**
 * Workspace state — rulers, units, snapping, canvas rotation and what was open.
 *
 * Redesign §5 is explicit that these are **editor** features rather than image
 * content: they change what you see while you work and nothing about what the
 * drawing *is*. That is why they live in `META-INF/neutrino/document.json` in a
 * package — an application that knows nothing about Neutrino ignores the whole
 * file and still renders the right picture — and it is why they are gathered
 * into one `workspace` object here rather than sprinkled through the document.
 *
 * The one thing that is *not* here is the grid, which predates this and stays
 * on `DrawingDocument.grid`: spacing, origin and its own snap flag. Moving it
 * would have meant migrating every drawing already saved to say the same thing
 * in a different place. So `SnapSettings` covers guides, objects and the canvas
 * edges, and the grid keeps its own switch — one rule per thing that can be
 * snapped to, wherever that rule already lived.
 *
 * Pure arithmetic, no canvas: the unit conversion and the ruler's tick spacing
 * are the two things here with real logic, and both are testable on their own.
 */

import type { Point, Rect } from './types';

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type RulerUnit = 'px' | 'cm' | 'mm' | 'in' | 'pt' | 'pc';

export const RULER_UNITS: readonly RulerUnit[] = ['px', 'cm', 'mm', 'in', 'pt', 'pc'];

export const RULER_UNIT_LABELS: Record<RulerUnit, string> = {
  px: 'Pixels',
  cm: 'Centimetres',
  mm: 'Millimetres',
  in: 'Inches',
  pt: 'Points',
  pc: 'Picas',
};

/**
 * How many canvas pixels one unit covers.
 *
 * Everything physical goes through the document's DPI, which is what makes the
 * canvas's `dpi` field mean something rather than being a number written into
 * `stack.xml` and never read. A point is 1/72 inch and a pica is twelve points,
 * by definition, so both are derived from the inch rather than tabulated.
 */
export function pixelsPerUnit(unit: RulerUnit, dpi: number): number {
  const inch = dpi > 0 ? dpi : 96;
  switch (unit) {
    case 'px': return 1;
    case 'in': return inch;
    case 'cm': return inch / 2.54;
    case 'mm': return inch / 25.4;
    case 'pt': return inch / 72;
    case 'pc': return inch / 6;
  }
}

export function toUnits(pixels: number, unit: RulerUnit, dpi: number): number {
  return pixels / pixelsPerUnit(unit, dpi);
}

export function fromUnits(value: number, unit: RulerUnit, dpi: number): number {
  return value * pixelsPerUnit(unit, dpi);
}

/** A measurement with as much precision as the unit deserves and no more. */
export function formatMeasure(pixels: number, unit: RulerUnit, dpi: number): string {
  const value = toUnits(pixels, unit, dpi);
  const decimals = unit === 'px' ? 0 : unit === 'mm' || unit === 'pt' ? 1 : 2;
  return `${value.toFixed(decimals)} ${unit}`;
}

// ---------------------------------------------------------------------------
// Ruler ticks
// ---------------------------------------------------------------------------

export interface RulerTicks {
  /** Distance between labelled ticks, in canvas pixels. */
  step: number;
  /** Unlabelled divisions between them. */
  subdivisions: number;
}

/**
 * Tick spacing for a ruler at a given zoom.
 *
 * Chosen so a labelled tick is never closer than `minSpacing` **screen** pixels,
 * which is what makes a ruler readable at 8% and at 1600% with the same code:
 * the step grows in canvas units exactly as fast as the zoom shrinks them on
 * screen. Candidates are the 1-2-5 decade series people actually rule in, so
 * zooming steps between 10, 20, 50, 100 rather than landing on 37.
 */
export function rulerTicks(unit: RulerUnit, dpi: number, scale: number, minSpacing = 64): RulerTicks {
  const perUnit = pixelsPerUnit(unit, dpi);
  const wanted = minSpacing / Math.max(scale, 1e-6) / perUnit;

  const decade = Math.pow(10, Math.floor(Math.log10(Math.max(wanted, 1e-9))));
  const candidates = [1, 2, 5, 10].map((m) => m * decade);
  const chosen = candidates.find((c) => c >= wanted) ?? candidates[candidates.length - 1];

  // Five divisions for a step that starts with 5, otherwise four: a 5 cm step
  // divided into four is 1.25 cm, which is not a mark anyone reads off a ruler.
  const mantissa = chosen / decade;
  return { step: chosen * perUnit, subdivisions: mantissa === 5 ? 5 : 4 };
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export interface SnapSettings {
  /** Guides the user pulled off a ruler. */
  guides: boolean;
  /** The bounding boxes of everything else drawn. */
  objects: boolean;
  /** The canvas edges and its centre lines. */
  canvas: boolean;
  /** How close, in canvas pixels at 100%, a snap takes hold. */
  tolerance: number;
}

export const DEFAULT_SNAP: SnapSettings = { guides: true, objects: false, canvas: true, tolerance: 8 };

/**
 * The nearest candidate within `tolerance`, or the value unchanged.
 *
 * Nearest rather than first: two guides a few pixels apart would otherwise make
 * whichever happened to be earlier in the list win, and which one that is
 * depends on the order they were created in, which nobody can see.
 */
export function snapValue(value: number, candidates: readonly number[], tolerance: number): number {
  let best = value;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Everything a drag can snap to on one axis, in canvas coordinates.
 *
 * The canvas contributes its two edges and its centre line; each object
 * contributes its two edges and its own centre. Built per drag rather than
 * cached, because it is a walk over the layer list and a drag is at most a few
 * hundred of those a second.
 */
export function snapCandidates(
  axis: 'x' | 'y',
  options: {
    canvas?: { width: number; height: number };
    guides?: readonly { orientation: 'horizontal' | 'vertical'; position: number }[];
    rects?: readonly Rect[];
    settings: SnapSettings;
  },
): number[] {
  const { settings } = options;
  const out: number[] = [];

  if (settings.canvas && options.canvas) {
    const extent = axis === 'x' ? options.canvas.width : options.canvas.height;
    out.push(0, extent / 2, extent);
  }

  if (settings.guides && options.guides) {
    // A vertical guide is a line of constant x, so it is a candidate on the x
    // axis — the naming crosses over exactly once, here.
    const wanted = axis === 'x' ? 'vertical' : 'horizontal';
    for (const guide of options.guides) {
      if (guide.orientation === wanted) out.push(guide.position);
    }
  }

  if (settings.objects && options.rects) {
    for (const rect of options.rects) {
      const start = axis === 'x' ? rect.x : rect.y;
      const size = axis === 'x' ? rect.width : rect.height;
      out.push(start, start + size / 2, start + size);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------

export interface WorkspaceState {
  /** Rulers down the top and left edges of the canvas area. */
  rulers: boolean;
  units: RulerUnit;
  /** Guides are drawn, and can be dragged. Off hides them without deleting any. */
  showGuides: boolean;
  /** Guides cannot be dragged or deleted by accident. */
  lockGuides: boolean;
  snap: SnapSettings;
  /**
   * Degrees the canvas is rotated **on screen**. A view setting: nothing in the
   * document moves, the export is unaffected, and it exists because drawing a
   * long diagonal is easier when it is horizontal.
   */
  canvasRotation: number;
  /** The tool that was armed. Restored on open; ignored if this build lost it. */
  activeTool?: string;
  /** The layer a stroke would have landed in. */
  activeLayerId?: string;
  /** What was selected — redesign §5's "selected objects". */
  selectedIds?: string[];
}

export const DEFAULT_WORKSPACE: WorkspaceState = {
  rulers: true,
  units: 'px',
  showGuides: true,
  lockGuides: false,
  snap: { ...DEFAULT_SNAP },
  canvasRotation: 0,
};

export function isRulerUnit(value: unknown): value is RulerUnit {
  return typeof value === 'string' && (RULER_UNITS as readonly string[]).includes(value);
}

/** The workspace a document actually has, filled in from the defaults. */
export function workspaceOf(workspace: WorkspaceState | undefined): WorkspaceState {
  if (!workspace) return { ...DEFAULT_WORKSPACE, snap: { ...DEFAULT_SNAP } };
  return workspace;
}

/** Where a guide would land, given the pointer and what is on screen. */
export function guideFromPointer(point: Point, orientation: 'horizontal' | 'vertical'): number {
  return orientation === 'horizontal' ? point.y : point.x;
}
