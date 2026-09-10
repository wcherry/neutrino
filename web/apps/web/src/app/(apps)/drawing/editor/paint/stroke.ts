/**
 * Turning pointer events into stamps.
 *
 * Two problems sit between a pointer and a painted mark, and both are solved
 * here rather than in the rasteriser, so they can be tested without a canvas.
 *
 * **The path is noisy.** A mouse reports integer pixels, a trackpad reports
 * worse, and a stylus reports a tremor faithfully. `StrokePath` runs an
 * exponential filter over the incoming points, which is one multiply per point
 * and — unlike averaging over a window — needs no lookahead, so the mark keeps
 * up with the cursor.
 *
 * **The path is sparse.** A pointer at 60Hz moving quickly reports points tens
 * of pixels apart, and stamping only where an event landed draws a dotted line.
 * So each new point is joined to the last by stamps at a fixed spacing, and the
 * *remainder* is carried across calls — without that, every event would restart
 * the spacing from zero and bunch stamps at the reported positions, which is
 * the same dotted line with extra steps.
 */

import { stampAlpha, stampSize, type BrushSettings } from './brush';
import type { Point } from '../document/types';

export interface StrokePoint extends Point {
  /** 0–1. Pointer events without pressure report 0.5 here. */
  pressure: number;
}

/** One dab of the brush. */
export interface Stamp {
  x: number;
  y: number;
  /** Diameter in canvas pixels. */
  size: number;
  /** Alpha for this dab alone, before the whole stroke's opacity. */
  alpha: number;
}

/** What a pointer event with no pressure information is treated as. */
export const DEFAULT_PRESSURE = 0.5;

export function strokePoint(x: number, y: number, pressure?: number): StrokePoint {
  // A pressure of exactly 0 is what a mouse reports through the Pointer Events
  // API for a button that is held down, so it means "no sensor" rather than
  // "no force" and must not taper the stroke to nothing.
  const value = pressure === undefined || pressure <= 0 ? DEFAULT_PRESSURE : pressure;
  return { x, y, pressure: Math.min(1, value) };
}

/**
 * The live state of one stroke.
 *
 * Stateful on purpose: smoothing and stamp spacing are both carry-over between
 * events, and a pure function over the whole point list would have to redo the
 * entire stroke on every mouse move — which is quadratic, and visible as a
 * stall about two seconds into a long stroke.
 */
export class StrokePath {
  private readonly brush: BrushSettings;
  private smoothed: StrokePoint | null = null;
  /** Distance already travelled since the last stamp was placed. */
  private carry = 0;
  private started = false;

  constructor(brush: BrushSettings) {
    this.brush = brush;
  }

  /** The first stamp, placed exactly where the pointer went down. */
  begin(point: StrokePoint): Stamp[] {
    this.smoothed = { ...point };
    this.carry = 0;
    this.started = true;
    return [this.stampAt(point)];
  }

  /**
   * The stamps that belong between the last point and this one.
   *
   * Returns an empty array when the pointer has not moved far enough for the
   * next stamp — which is most events for a slow, careful stroke, and is why
   * spacing has to accumulate rather than reset.
   */
  extend(point: StrokePoint): Stamp[] {
    if (!this.started || !this.smoothed) return this.begin(point);

    const previous = this.smoothed;
    const next = this.smooth(previous, point);
    this.smoothed = next;

    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const travelled = Math.hypot(dx, dy);
    if (travelled === 0) return [];

    // Spacing follows the *current* size, so a pressure stroke that thickens
    // does not leave the stamps of its thin section too far apart to merge.
    const interval = Math.max(0.5, stampSize(this.brush, next.pressure) * this.brush.spacing);

    const stamps: Stamp[] = [];
    let distance = interval - this.carry;
    while (distance <= travelled) {
      const t = distance / travelled;
      stamps.push(this.stampAt({
        x: previous.x + dx * t,
        y: previous.y + dy * t,
        pressure: previous.pressure + (next.pressure - previous.pressure) * t,
      }));
      distance += interval;
    }
    this.carry = travelled - (distance - interval);
    return stamps;
  }

  /**
   * The final stamp, at the raw position the pointer was released at.
   *
   * Without it a smoothed stroke stops short of where the cursor actually was,
   * by however much the filter was lagging — which reads as the line not quite
   * reaching the thing you were drawing to.
   */
  end(point: StrokePoint): Stamp[] {
    if (!this.started) return [];
    const stamps = this.extend(point);
    stamps.push(this.stampAt(point));
    this.started = false;
    return stamps;
  }

  private smooth(previous: StrokePoint, point: StrokePoint): StrokePoint {
    // `smoothing` is the weight given to where the stroke already was, so 0 is
    // the raw pointer and 1 would never move at all — hence the ceiling.
    const weight = Math.min(0.92, this.brush.smoothing);
    return {
      x: previous.x + (point.x - previous.x) * (1 - weight),
      y: previous.y + (point.y - previous.y) * (1 - weight),
      // Pressure is smoothed harder than position: stylus pressure is far
      // noisier than stylus position, and a jittery width is more visible than
      // a jittery path.
      pressure: previous.pressure + (point.pressure - previous.pressure) * (1 - weight) * 0.6,
    };
  }

  private stampAt(point: StrokePoint): Stamp {
    return {
      x: point.x,
      y: point.y,
      size: stampSize(this.brush, point.pressure),
      alpha: stampAlpha(this.brush, point.pressure),
    };
  }
}

/** The rectangle a run of stamps covers, for invalidating only what changed. */
export function stampsBounds(stamps: readonly Stamp[]): {
  x: number; y: number; width: number; height: number;
} | null {
  if (stamps.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stamp of stamps) {
    const radius = stamp.size / 2;
    minX = Math.min(minX, stamp.x - radius);
    minY = Math.min(minY, stamp.y - radius);
    maxX = Math.max(maxX, stamp.x + radius);
    maxY = Math.max(maxY, stamp.y + radius);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
