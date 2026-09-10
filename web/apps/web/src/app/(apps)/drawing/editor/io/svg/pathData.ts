/**
 * Parsing an SVG `d` attribute into the model's path contours.
 *
 * SVG has ten segment types and the model has one — a cubic between two anchors
 * — so everything is converted on the way in. That is not a simplification of
 * the shape: lines, quadratics and arcs all have exact cubic equivalents or,
 * for the arc, an exact piecewise one, so what comes out draws the same curve.
 * What it buys is that one segment kind has to be rendered, hit-tested,
 * transformed, measured and written back out, instead of ten.
 *
 * The parser is deliberately tolerant, because `d` attributes in the wild are.
 * Numbers may be separated by commas, spaces, or nothing at all where the sign
 * or decimal point makes the boundary unambiguous (`M1.5.5` is two numbers);
 * a command may be followed by several sets of arguments; and `Z` may appear
 * anywhere. Anything it cannot make sense of ends the contour rather than the
 * parse, so a malformed tail costs the rest of one shape instead of the file.
 */

import type { PathPoint, Point, SubPath } from '../../document/types';

/** How many cubics an arc of a given sweep is split into, per quarter turn. */
const ARC_SEGMENTS_PER_QUADRANT = 1;

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

const NUMBER = /^[+-]?(\d*\.\d+|\d+\.?)([eE][+-]?\d+)?/;

class Cursor {
  private readonly text: string;
  private index = 0;

  constructor(text: string) {
    this.text = text;
  }

  skipSeparators(): void {
    while (this.index < this.text.length) {
      const ch = this.text[this.index];
      if (ch === ',' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        this.index++;
      } else {
        break;
      }
    }
  }

  get done(): boolean {
    this.skipSeparators();
    return this.index >= this.text.length;
  }

  /** The next command letter, or null when the next token is a number. */
  command(): string | null {
    this.skipSeparators();
    const ch = this.text[this.index];
    if (ch && /[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      this.index++;
      return ch;
    }
    return null;
  }

  number(): number | null {
    this.skipSeparators();
    const match = NUMBER.exec(this.text.slice(this.index));
    if (!match) return null;
    this.index += match[0].length;
    const value = Number.parseFloat(match[0]);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * An arc's flag argument.
   *
   * Flags are single characters and may run together with what follows —
   * `a1 1 0 011 1` is valid and means flags `0` and `1` then `1,1`. Reading one
   * as a general number swallows the digits after it and silently draws a
   * different arc, which is why this exists separately.
   */
  flag(): number | null {
    this.skipSeparators();
    const ch = this.text[this.index];
    if (ch === '0' || ch === '1') {
      this.index++;
      return ch === '1' ? 1 : 0;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Building contours
// ---------------------------------------------------------------------------

class ContourBuilder {
  private readonly contours: SubPath[] = [];
  private points: PathPoint[] = [];
  private closed = false;

  moveTo(point: Point): void {
    this.flush();
    this.points = [{ x: point.x, y: point.y }];
  }

  lineTo(point: Point): void {
    if (this.points.length === 0) this.points = [{ x: point.x, y: point.y }];
    else this.points.push({ x: point.x, y: point.y });
  }

  curveTo(c1: Point, c2: Point, to: Point): void {
    if (this.points.length === 0) this.points = [{ x: to.x, y: to.y }];
    const from = this.points[this.points.length - 1];
    // Handles are stored on the anchors they belong to — `out` on the one the
    // curve leaves, `in` on the one it arrives at — which is what lets a point
    // be dragged with its curvature intact.
    from.out = { x: c1.x, y: c1.y };
    this.points.push({ x: to.x, y: to.y, in: { x: c2.x, y: c2.y } });
  }

  close(): void {
    this.closed = true;
    this.flush();
  }

  /** Ends the current contour and starts a new one. */
  private flush(): void {
    if (this.points.length >= 2) {
      this.contours.push({ points: this.points, closed: this.closed });
    }
    this.points = [];
    this.closed = false;
  }

  finish(): SubPath[] {
    this.flush();
    return this.contours;
  }

  get current(): Point {
    const last = this.points[this.points.length - 1];
    return last ? { x: last.x, y: last.y } : { x: 0, y: 0 };
  }

  /**
   * The control point a smooth curve (`S`/`T`) reflects.
   *
   * SVG's rule is that the reflection is only used when the previous command
   * was of the matching curve type; otherwise the control point coincides with
   * the current point. The caller tracks the previous command, so this only has
   * to supply the reflection itself.
   */
  reflectedControl(): Point {
    const last = this.points[this.points.length - 1];
    if (!last?.in) return this.current;
    return { x: 2 * last.x - last.in.x, y: 2 * last.y - last.in.y };
  }

  get startOfContour(): Point {
    return this.points[0] ? { x: this.points[0].x, y: this.points[0].y } : { x: 0, y: 0 };
  }

  get isEmpty(): boolean {
    return this.points.length === 0;
  }
}

// ---------------------------------------------------------------------------
// Curve conversions
// ---------------------------------------------------------------------------

/** A quadratic as the cubic that draws the identical curve. */
function quadraticToCubic(from: Point, control: Point, to: Point): [Point, Point] {
  return [
    { x: from.x + (2 / 3) * (control.x - from.x), y: from.y + (2 / 3) * (control.y - from.y) },
    { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) },
  ];
}

/**
 * An elliptical arc as a run of cubics.
 *
 * This is SVG's own endpoint-to-centre parameterisation (Implementation Notes,
 * F.6.5) followed by the standard circular-arc-to-cubic approximation, split so
 * that no piece spans more than a quarter turn — beyond that the approximation
 * visibly flattens. Out-of-range radii are corrected rather than rejected,
 * exactly as the specification requires, because a radius too small to reach
 * the endpoint is a common output of drawing tools and must still draw
 * *something*.
 */
function arcToCubics(
  from: Point,
  rx: number,
  ry: number,
  rotationDegrees: number,
  largeArc: number,
  sweep: number,
  to: Point,
): { c1: Point; c2: Point; to: Point }[] {
  // Degenerate radii mean a straight line, per the specification.
  if (rx === 0 || ry === 0) return [{ c1: from, c2: to, to }];
  if (from.x === to.x && from.y === to.y) return [];

  let radiusX = Math.abs(rx);
  let radiusY = Math.abs(ry);
  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (from.x - to.x) / 2;
  const dy2 = (from.y - to.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // F.6.6: scale the radii up until the ellipse can reach both endpoints.
  const lambda = (x1p * x1p) / (radiusX * radiusX) + (y1p * y1p) / (radiusY * radiusY);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    radiusX *= scale;
    radiusY *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = Math.max(
    0,
    radiusX * radiusX * radiusY * radiusY -
      radiusX * radiusX * y1p * y1p -
      radiusY * radiusY * x1p * x1p,
  );
  const denominator = radiusX * radiusX * y1p * y1p + radiusY * radiusY * x1p * x1p;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);

  const cxp = (coefficient * radiusX * y1p) / radiusY;
  const cyp = (-coefficient * radiusY * x1p) / radiusX;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;

  const theta1 = angleTo((x1p - cxp) / radiusX, (y1p - cyp) / radiusY);
  let delta = angleBetween(
    (x1p - cxp) / radiusX, (y1p - cyp) / radiusY,
    (-x1p - cxp) / radiusX, (-y1p - cyp) / radiusY,
  );
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) * ARC_SEGMENTS_PER_QUADRANT));
  const step = delta / pieces;
  // The magic constant that makes a cubic match a circular arc of `step`
  // radians at both endpoints and in the middle.
  const alpha = (4 / 3) * Math.tan(step / 4);

  const out: { c1: Point; c2: Point; to: Point }[] = [];
  let angle = theta1;
  let start = from;
  for (let i = 0; i < pieces; i++) {
    const next = angle + step;
    const end = onEllipse(cx, cy, radiusX, radiusY, cosPhi, sinPhi, next);
    const startDerivative = ellipseDerivative(radiusX, radiusY, cosPhi, sinPhi, angle);
    const endDerivative = ellipseDerivative(radiusX, radiusY, cosPhi, sinPhi, next);

    out.push({
      c1: { x: start.x + alpha * startDerivative.x, y: start.y + alpha * startDerivative.y },
      c2: { x: end.x - alpha * endDerivative.x, y: end.y - alpha * endDerivative.y },
      to: end,
    });
    start = end;
    angle = next;
  }
  // The last piece ends at the commanded endpoint exactly, not at whatever the
  // trigonometry produced — accumulated error here shows up as a visible gap in
  // a closed shape built from arcs.
  if (out.length > 0) out[out.length - 1].to = to;
  return out;
}

function onEllipse(cx: number, cy: number, rx: number, ry: number, cosPhi: number, sinPhi: number, angle: number): Point {
  const x = rx * Math.cos(angle);
  const y = ry * Math.sin(angle);
  return { x: cx + cosPhi * x - sinPhi * y, y: cy + sinPhi * x + cosPhi * y };
}

function ellipseDerivative(rx: number, ry: number, cosPhi: number, sinPhi: number, angle: number): Point {
  const dx = -rx * Math.sin(angle);
  const dy = ry * Math.cos(angle);
  return { x: cosPhi * dx - sinPhi * dy, y: sinPhi * dx + cosPhi * dy };
}

function angleTo(x: number, y: number): number {
  return Math.atan2(y, x);
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (lengths === 0) return 0;
  const clamped = Math.max(-1, Math.min(1, dot / lengths));
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  return sign * Math.acos(clamped);
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/** An SVG `d` attribute as contours. Empty when nothing could be read. */
export function parsePathData(d: string): SubPath[] {
  const cursor = new Cursor(d ?? '');
  const builder = new ContourBuilder();

  let command = '';
  let previousCommand = '';
  let subpathStart: Point = { x: 0, y: 0 };
  // The control point of the last quadratic, for `T`'s reflection. Local to the
  // parse: a module-level copy would carry one path's curvature into the next.
  let lastQuadraticControl: Point | null = null;

  while (!cursor.done) {
    const next = cursor.command();
    if (next) {
      previousCommand = command;
      command = next;
    } else if (!command) {
      // Numbers before any command at all: nothing sensible to do with them.
      break;
    } else {
      previousCommand = command;
      // A repeated argument set implicitly continues the previous command,
      // except that a repeated `M` means `L` — which is the one place a naive
      // parser draws a series of disconnected dots.
      if (command === 'M') command = 'L';
      else if (command === 'm') command = 'l';
    }

    const relative = command === command.toLowerCase();
    const at = builder.current;
    const ok = (() => {
      switch (command.toUpperCase()) {
        case 'M': {
          const x = cursor.number();
          const y = cursor.number();
          if (x === null || y === null) return false;
          const point = relative ? { x: at.x + x, y: at.y + y } : { x, y };
          builder.moveTo(point);
          subpathStart = point;
          return true;
        }
        case 'L': {
          const x = cursor.number();
          const y = cursor.number();
          if (x === null || y === null) return false;
          builder.lineTo(relative ? { x: at.x + x, y: at.y + y } : { x, y });
          return true;
        }
        case 'H': {
          const x = cursor.number();
          if (x === null) return false;
          builder.lineTo({ x: relative ? at.x + x : x, y: at.y });
          return true;
        }
        case 'V': {
          const y = cursor.number();
          if (y === null) return false;
          builder.lineTo({ x: at.x, y: relative ? at.y + y : y });
          return true;
        }
        case 'C': {
          const values = numbers(cursor, 6);
          if (!values) return false;
          const [c1, c2, to] = pairs(values, at, relative);
          builder.curveTo(c1, c2, to);
          return true;
        }
        case 'S': {
          const values = numbers(cursor, 4);
          if (!values) return false;
          const [c2, to] = pairs(values, at, relative);
          const smooth = 'CS'.includes(previousCommand.toUpperCase())
            ? builder.reflectedControl()
            : at;
          builder.curveTo(smooth, c2, to);
          return true;
        }
        case 'Q': {
          const values = numbers(cursor, 4);
          if (!values) return false;
          const [control, to] = pairs(values, at, relative);
          const [c1, c2] = quadraticToCubic(at, control, to);
          builder.curveTo(c1, c2, to);
          lastQuadraticControl = control;
          return true;
        }
        case 'T': {
          const values = numbers(cursor, 2);
          if (!values) return false;
          const [to] = pairs(values, at, relative);
          const control: Point = 'QT'.includes(previousCommand.toUpperCase()) && lastQuadraticControl
            ? { x: 2 * at.x - lastQuadraticControl.x, y: 2 * at.y - lastQuadraticControl.y }
            : at;
          const [c1, c2] = quadraticToCubic(at, control, to);
          builder.curveTo(c1, c2, to);
          lastQuadraticControl = control;
          return true;
        }
        case 'A': {
          const rx = cursor.number();
          const ry = cursor.number();
          const rotation = cursor.number();
          const largeArc = cursor.flag();
          const sweep = cursor.flag();
          const x = cursor.number();
          const y = cursor.number();
          if (rx === null || ry === null || rotation === null || largeArc === null ||
              sweep === null || x === null || y === null) return false;
          const to = relative ? { x: at.x + x, y: at.y + y } : { x, y };
          for (const piece of arcToCubics(at, rx, ry, rotation, largeArc, sweep, to)) {
            builder.curveTo(piece.c1, piece.c2, piece.to);
          }
          return true;
        }
        case 'Z': {
          builder.close();
          // After a close, the current point returns to the subpath's start —
          // a following command without an explicit `M` continues from there.
          if (!builder.isEmpty) builder.moveTo(subpathStart);
          return true;
        }
        default:
          return false;
      }
    })();

    if (!ok) break;
    if (!'QT'.includes(command.toUpperCase())) lastQuadraticControl = null;
  }

  return builder.finish();
}

function numbers(cursor: Cursor, count: number): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = cursor.number();
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/** Consecutive number pairs as points, made absolute where the command was relative. */
function pairs(values: number[], at: Point, relative: boolean): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    out.push(relative
      ? { x: at.x + values[i], y: at.y + values[i + 1] }
      : { x: values[i], y: values[i + 1] });
  }
  return out;
}
