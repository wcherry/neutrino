/**
 * Path geometry — flattening, measuring and walking a cubic path.
 *
 * A `PathObject` is a list of anchors with optional cubic handles, and almost
 * everything that consumes one wants it as a *polyline* instead: hit testing
 * measures distance to segments, bounds want extremes, text on a path walks by
 * arc length. Producing that polyline in one place rather than in each consumer
 * is what keeps the answers consistent — a stroke that hit-tests where it is not
 * drawn is the failure this module exists to prevent.
 *
 * **Flattening is adaptive by chord length, not by a fixed step count.** A
 * sixteen-segment approximation is invisible on a 20px curve and obviously
 * faceted on a 2000px one, and a drawing has both. The estimate is the control
 * polygon's length, which is always an over-estimate of the true arc — so the
 * segment count errs toward smooth.
 *
 * Nothing here touches a canvas or the DOM: the tree helpers compute bounds
 * during a save, and the OpenRaster writer's tests run in jsdom.
 */

import { pathContours, type PathObject, type PathPoint, type Point, type Rect, type SubPath } from './types';

// Declared here rather than imported from `geometry`, which imports *this*
// module for `pathBounds`. A cycle between the two would work today and break
// the first time either grows a top-level side effect.
const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** Pixels of chord per flattened segment. Smaller is smoother and slower. */
const FLATTEN_TOLERANCE = 3;
/** Never fewer than this many segments per curve, however short. */
const MIN_SEGMENTS = 4;
/** Never more, however long — a guard against a pathological control polygon. */
const MAX_SEGMENTS = 96;

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/**
 * One span between two anchors.
 *
 * `c1`/`c2` are absent for a straight span, which is both the common case and
 * the cheap one — a polyline drawn by the freehand pen is nothing but these.
 */
export interface PathSegment {
  from: Point;
  to: Point;
  c1?: Point;
  c2?: Point;
}

/** The spans of one contour, in order. A closed contour includes the span back to the start. */
export function contourSegments(contour: SubPath): PathSegment[] {
  const { points, closed } = contour;
  if (points.length < 2) return [];

  const segments: PathSegment[] = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    // A span is curved when *either* end offers a handle; the missing one falls
    // back to its own anchor, which is exactly how SVG degenerates a cubic into
    // a quadratic-looking curve rather than into a straight line.
    if (from.out || to.in) {
      segments.push({
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        c1: from.out ?? { x: from.x, y: from.y },
        c2: to.in ?? { x: to.x, y: to.y },
      });
    } else {
      segments.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } });
    }
  }
  return segments;
}

export function cubicAt(segment: PathSegment, t: number): Point {
  if (!segment.c1 || !segment.c2) {
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * t,
      y: segment.from.y + (segment.to.y - segment.from.y) * t,
    };
  }
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * segment.from.x + b * segment.c1.x + c * segment.c2.x + d * segment.to.x,
    y: a * segment.from.y + b * segment.c1.y + c * segment.c2.y + d * segment.to.y,
  };
}

/** How many straight pieces a span needs to look curved at drawing scale. */
function segmentCount(segment: PathSegment): number {
  if (!segment.c1 || !segment.c2) return 1;
  const polygon =
    distance(segment.from, segment.c1) +
    distance(segment.c1, segment.c2) +
    distance(segment.c2, segment.to);
  const count = Math.ceil(polygon / FLATTEN_TOLERANCE);
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, count));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * One contour as a polyline.
 *
 * The first anchor is included and the closing point of a closed contour is
 * not repeated — callers that need the closing span read `closed` and wrap,
 * which is what every consumer here already does.
 */
export function flattenContour(contour: SubPath): Point[] {
  const segments = contourSegments(contour);
  if (segments.length === 0) {
    return contour.points.map((p) => ({ x: p.x, y: p.y }));
  }

  const out: Point[] = [{ x: segments[0].from.x, y: segments[0].from.y }];
  for (const segment of segments) {
    const steps = segmentCount(segment);
    for (let i = 1; i <= steps; i++) out.push(cubicAt(segment, i / steps));
  }
  // A closed contour's last flattened point *is* its first anchor; keeping both
  // would give every closed path a zero-length final span, which reads as a
  // divide-by-zero everywhere lengths are normalised.
  if (contour.closed && out.length > 1) out.pop();
  return out;
}

/** Every contour of an object as polylines, in order. */
export function flattenPath(object: PathObject): Point[][] {
  return pathContours(object).map(flattenContour);
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/**
 * A contour sampled and measured, ready to be walked by distance.
 *
 * Built once and reused: laying out a string along a path asks for a position
 * per character, and re-flattening the curve for each of them turns a caption
 * into a visible stall.
 */
export interface MeasuredPath {
  points: Point[];
  /** Cumulative arc length at each point; `lengths[0]` is 0. */
  lengths: number[];
  total: number;
  closed: boolean;
}

export function measureContour(contour: SubPath): MeasuredPath {
  const points = flattenContour(contour);
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
    lengths.push(total);
  }
  if (contour.closed && points.length > 1) {
    total += distance(points[points.length - 1], points[0]);
    lengths.push(total);
  }
  return { points, lengths, total, closed: contour.closed };
}

/** The first contour of an object, measured — what text on a path runs along. */
export function measurePath(object: PathObject): MeasuredPath {
  return measureContour({ points: object.points, closed: object.closed });
}

export interface PathPosition {
  point: Point;
  /** Direction of travel at `point`, in radians. */
  angle: number;
}

/**
 * Where a given distance along the path lands, and which way the path is going
 * there.
 *
 * Distances past either end are **clamped rather than wrapped**, even for a
 * closed contour: text that ran off the end of a circle and reappeared over its
 * own beginning would overlap itself illegibly, and clamping makes the overflow
 * visible at the end where it can be fixed.
 */
export function positionAt(measured: MeasuredPath, distanceAlong: number): PathPosition {
  const { points, lengths, total } = measured;
  if (points.length === 0) return { point: { x: 0, y: 0 }, angle: 0 };
  if (points.length === 1 || total === 0) return { point: points[0], angle: 0 };

  const target = Math.max(0, Math.min(total, distanceAlong));

  // Binary search for the span holding `target`. A caption is one call per
  // character over a path that may hold a hundred segments; a linear scan makes
  // that quadratic.
  let low = 0;
  let high = lengths.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (lengths[mid] <= target) low = mid;
    else high = mid;
  }

  const from = points[low % points.length];
  const to = points[(low + 1) % points.length];
  const spanLength = lengths[low + 1] - lengths[low];
  const t = spanLength === 0 ? 0 : (target - lengths[low]) / spanLength;

  return {
    point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
    angle: Math.atan2(to.y - from.y, to.x - from.x),
  };
}

// ---------------------------------------------------------------------------
// Bounds and hit testing
// ---------------------------------------------------------------------------

/**
 * The extent of a path's own geometry, handles included where they bulge past
 * the anchors.
 *
 * Measured from the flattened polyline rather than from the control polygon: a
 * control point can sit far outside the curve it shapes, and a box drawn around
 * those is visibly larger than the stroke it is meant to frame.
 */
export function pathBounds(object: PathObject): Rect {
  const polylines = flattenPath(object);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of polylines) {
    for (const p of line) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { ...EMPTY_RECT };
  return { x: minX, y: minY, width: Math.max(maxX - minX, 0), height: Math.max(maxY - minY, 0) };
}

/** Distance from a point to the nearest piece of a path, in canvas units. */
export function distanceToPath(object: PathObject, point: Point): number {
  let best = Infinity;
  for (const contour of pathContours(object)) {
    const line = flattenContour(contour);
    if (line.length === 0) continue;
    if (line.length === 1) {
      best = Math.min(best, distance(line[0], point));
      continue;
    }
    const last = contour.closed ? line.length : line.length - 1;
    for (let i = 0; i < last; i++) {
      best = Math.min(best, distanceToSegment(point, line[i], line[(i + 1) % line.length]));
    }
  }
  return best;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether a point falls inside a closed contour, by the even-odd rule. */
export function pointInContour(contour: SubPath, point: Point): boolean {
  const line = flattenContour(contour);
  if (line.length < 3) return false;
  let inside = false;
  for (let i = 0, j = line.length - 1; i < line.length; j = i++) {
    const a = line[i];
    const b = line[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/** A point mapped through `map`, handles included. */
export function mapPathPoint(p: PathPoint, map: (point: Point) => Point): PathPoint {
  const moved = map(p);
  const next: PathPoint = { x: moved.x, y: moved.y };
  // Handles are absolute, so they map with the anchors and need no special
  // case beyond being optional — which is the reason they are stored that way.
  if (p.in) next.in = map(p.in);
  if (p.out) next.out = map(p.out);
  return next;
}

/** Every anchor and handle of a path mapped through `map`. */
export function mapPathObject(object: PathObject, map: (point: Point) => Point): PathObject {
  const next: PathObject = {
    ...object,
    points: object.points.map((p) => mapPathPoint(p, map)),
  };
  if (object.subpaths) {
    next.subpaths = object.subpaths.map((sub) => ({
      ...sub,
      points: sub.points.map((p) => mapPathPoint(p, map)),
    }));
  }
  return next;
}

// ---------------------------------------------------------------------------
// SVG path data
// ---------------------------------------------------------------------------

/**
 * A contour as SVG path data.
 *
 * Straight spans emit `L` rather than a degenerate `C`, which keeps a freehand
 * polyline's `d` a third of the size and readable in a diff.
 */
export function contourToPathData(contour: SubPath): string {
  const { points, closed } = contour;
  if (points.length === 0) return '';

  const parts = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    if (from.out || to.in) {
      const c1 = from.out ?? from;
      const c2 = to.in ?? to;
      parts.push(
        `C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(to.x)} ${round(to.y)}`,
      );
    } else {
      parts.push(`L ${round(to.x)} ${round(to.y)}`);
    }
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

/** Every contour of an object as one `d` attribute. */
export function pathToPathData(object: PathObject): string {
  return pathContours(object).map(contourToPathData).filter(Boolean).join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
