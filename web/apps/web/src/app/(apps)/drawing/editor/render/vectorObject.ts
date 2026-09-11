/**
 * Drawing, measuring and hit-testing one vector object.
 *
 * There are two emitters here — canvas and SVG — and they have to agree,
 * because the same object is painted to the screen by one and written into an
 * export by the other. Anything added to a shape's appearance belongs in both
 * or in neither.
 */

import {
  ARROW_HEAD_LENGTH,
  normalizeRect,
  rectCenter,
  unrotatePoint,
  vectorObjectBounds,
} from '../document/geometry';
import { distanceToPath, distanceToSegment, pathToPathData, pointInContour } from '../document/path';
import { pathContours, type Point, type Rect, type StrokeStyle, type SubPath, type VectorObject, type VectorStyle } from '../document/types';

// ---------------------------------------------------------------------------
// Stroke dashes
// ---------------------------------------------------------------------------

/** Dash pattern for a stroke style, scaled by width so a thick dash stays legible. */
export function dashPattern(style: StrokeStyle, strokeWidth: number): number[] {
  const w = Math.max(strokeWidth, 0.5);
  switch (style) {
    case 'dashed': return [w * 4, w * 3];
    case 'dotted': return [w, w * 2];
    case 'long-dash': return [w * 8, w * 3];
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

const DIRECTION_ANGLES: Record<string, number> = {
  'to top': 0, 'to top right': 45, 'to right': 90, 'to bottom right': 135,
  'to bottom': 180, 'to bottom left': 225, 'to left': 270, 'to top left': 315,
};

/** Splits a gradient's arguments on top-level commas, so `rgb(a, b, c)` survives. */
function splitArgs(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export interface GradientStop {
  color: string;
  /** Percent along the gradient. */
  position: number;
}

function parseStops(parts: string[]): GradientStop[] {
  const raw = parts
    .map((part) => {
      const bits = part.trim().split(/\s+/);
      if (!/^#[0-9a-fA-F]{3,8}$/.test(bits[0])) return null;
      const pct = bits[1]?.match(/^(\d+(?:\.\d+)?)%$/);
      return { color: bits[0], position: pct ? parseFloat(pct[1]) : -1 };
    })
    .filter((s): s is GradientStop => s !== null);

  // Stops with no explicit position are spread evenly, as CSS does.
  return raw.map((stop, i) => ({
    ...stop,
    position: stop.position >= 0 ? stop.position : Math.round((i * 100) / Math.max(1, raw.length - 1)),
  }));
}

export interface ParsedGradient {
  type: 'linear' | 'radial';
  /** Degrees, CSS convention: 0 points up, 90 points right. Linear only. */
  angle: number;
  stops: GradientStop[];
}

/** A CSS gradient string as stops, or null when the fill is not a gradient. */
export function parseGradient(fill: string): ParsedGradient | null {
  const linear = fill.match(/^linear-gradient\((.+)\)$/is);
  if (linear) {
    const args = splitArgs(linear[1]);
    let angle = 180;
    let start = 0;
    const first = args[0]?.trim() ?? '';
    const deg = first.match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (deg) {
      angle = parseFloat(deg[1]);
      start = 1;
    } else if (/^to\s+/i.test(first)) {
      angle = DIRECTION_ANGLES[first.toLowerCase().trim()] ?? 180;
      start = 1;
    }
    return { type: 'linear', angle, stops: parseStops(args.slice(start)) };
  }

  const radial = fill.match(/^radial-gradient\((.+)\)$/is);
  if (radial) {
    const args = splitArgs(radial[1]);
    const start = /^#/.test(args[0]?.trim() ?? '') ? 0 : 1;
    return { type: 'radial', angle: 0, stops: parseStops(args.slice(start)) };
  }

  return null;
}

/** The Drive/HTTP URL inside a `url(…)` fill, or null. */
export function imageFillUrl(fill: string): string | null {
  const match = fill.match(/^url\((.+)\)$/is);
  if (!match) return null;
  return match[1].replace(/^["']|["']$/g, '');
}

export function isPaintedFill(fill: string): boolean {
  return Boolean(fill) && fill !== 'none' && fill !== 'transparent';
}

/** Images a fill can refer to, keyed by the URL inside `url(…)`. */
export type ImageResolver = ReadonlyMap<string, CanvasImageSource>;

function canvasFill(
  ctx: CanvasRenderingContext2D,
  style: VectorStyle,
  box: Rect,
  images?: ImageResolver,
): string | CanvasGradient | CanvasPattern | null {
  const { fill } = style;
  if (!isPaintedFill(fill)) return null;

  const gradient = parseGradient(fill);
  if (gradient) {
    const center = rectCenter(box);
    if (gradient.type === 'linear') {
      const dx = Math.sin((gradient.angle * Math.PI) / 180);
      const dy = -Math.cos((gradient.angle * Math.PI) / 180);
      const half = (Math.abs(box.width * dx) + Math.abs(box.height * dy)) / 2;
      const grad = ctx.createLinearGradient(
        center.x - dx * half, center.y - dy * half,
        center.x + dx * half, center.y + dy * half,
      );
      for (const stop of gradient.stops) grad.addColorStop(stop.position / 100, stop.color);
      return grad;
    }
    const radius = Math.max(Math.abs(box.width), Math.abs(box.height)) / 2;
    const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    for (const stop of gradient.stops) grad.addColorStop(stop.position / 100, stop.color);
    return grad;
  }

  const url = imageFillUrl(fill);
  if (url) {
    // An unresolved image paints nothing rather than the literal `url(…)`
    // string, which canvas would silently ignore and leave the previous fill in
    // place — the shape would come out filled with whatever was drawn before it.
    const image = images?.get(url);
    if (!image) return null;
    return ctx.createPattern(image, 'no-repeat');
  }

  return fill;
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/** Traces an object's outline into the current path, unrotated and unstyled. */
function traceObject(ctx: CanvasRenderingContext2D, object: VectorObject): void {
  ctx.beginPath();
  switch (object.kind) {
    case 'rect': {
      const r = normalizeRect(object.frame);
      const radius = Math.min(object.cornerRadius, r.width / 2, r.height / 2);
      if (radius > 0 && typeof ctx.roundRect === 'function') {
        ctx.roundRect(r.x, r.y, r.width, r.height, radius);
      } else {
        ctx.rect(r.x, r.y, r.width, r.height);
      }
      break;
    }
    case 'ellipse': {
      const r = normalizeRect(object.frame);
      const center = rectCenter(r);
      ctx.ellipse(center.x, center.y, Math.max(r.width / 2, 0.5), Math.max(r.height / 2, 0.5), 0, 0, Math.PI * 2);
      break;
    }
    case 'line': {
      const { x, y, width, height } = object.frame;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y + height);
      break;
    }
    case 'path': {
      for (const contour of pathContours(object)) {
        traceContour(ctx, contour);
      }
      break;
    }
  }
}

/**
 * One contour into the current path.
 *
 * Curved and straight spans are emitted as `bezierCurveTo` and `lineTo`
 * respectively rather than every span as a cubic. The picture is identical
 * either way; what differs is that a freehand stroke of two thousand points
 * stays two thousand line commands instead of becoming two thousand curves the
 * rasteriser has to subdivide.
 */
function traceContour(ctx: CanvasRenderingContext2D, contour: SubPath): void {
  const { points, closed } = contour;
  if (points.length === 0) return;

  ctx.moveTo(points[0].x, points[0].y);
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    if (from.out || to.in) {
      const c1 = from.out ?? from;
      const c2 = to.in ?? to;
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    } else {
      ctx.lineTo(to.x, to.y);
    }
  }
  if (closed) ctx.closePath();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, tip: Point, angle: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - ARROW_HEAD_LENGTH * Math.cos(angle - Math.PI / 6), tip.y - ARROW_HEAD_LENGTH * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tip.x - ARROW_HEAD_LENGTH * Math.cos(angle + Math.PI / 6), tip.y - ARROW_HEAD_LENGTH * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawVectorObject(
  ctx: CanvasRenderingContext2D,
  object: VectorObject,
  images?: ImageResolver,
): void {
  if (!object.visible || object.opacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = object.opacity;

  if (object.rotation) {
    const center = rectCenter(normalizeRect(object.frame));
    ctx.translate(center.x, center.y);
    ctx.rotate((object.rotation * Math.PI) / 180);
    ctx.translate(-center.x, -center.y);
  }

  const box = normalizeRect(object.frame);
  const fill = canvasFill(ctx, object.style, box, images);

  traceObject(ctx, object);

  // A path is filled only when closed; an open freehand stroke that filled its
  // own convex hull would blot out everything under it.
  const fillable = object.kind !== 'line' && (object.kind !== 'path' || object.closed);
  if (fill && fillable) {
    ctx.fillStyle = fill;
    // Even-odd is what turns a second contour into a hole. It arrives on
    // imported SVG and never on anything drawn here, so the default stays
    // non-zero and matches what `vectorObjectToSvg` omits.
    ctx.fill(object.kind === 'path' && object.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  }

  if (object.style.strokeWidth > 0 && isPaintedFill(object.style.stroke)) {
    ctx.strokeStyle = object.style.stroke;
    ctx.lineWidth = object.style.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dashPattern(object.style.strokeStyle, object.style.strokeWidth));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (object.kind === 'line') {
    const { x, y, width, height } = object.frame;
    const angle = Math.atan2(height, width);
    if (object.arrowEnd) {
      drawArrowHead(ctx, { x: x + width, y: y + height }, angle, object.style.stroke);
    }
    if (object.arrowStart) {
      drawArrowHead(ctx, { x, y }, angle + Math.PI, object.style.stroke);
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Paint attributes plus any `<defs>` the object needs.
 *
 * Gradients have to be hoisted into `<defs>` and referenced by id, which is why
 * this returns a pair rather than a string — the caller collects the defs from
 * every object and emits them once at the top of the document.
 */
function svgPaint(object: VectorObject, index: number): { attrs: string; defs: string } {
  const { style } = object;
  const defs: string[] = [];
  let fill = 'none';

  if (isPaintedFill(style.fill)) {
    const gradient = parseGradient(style.fill);
    if (gradient) {
      const id = `grad-${index}`;
      const stops = gradient.stops
        .map((s) => `<stop offset="${s.position}%" stop-color="${escapeXml(s.color)}"/>`)
        .join('');
      if (gradient.type === 'linear') {
        // CSS angles run clockwise from "up"; SVG's x1/y1→x2/y2 vector is built
        // from the same angle so the two renderers agree on direction.
        const rad = (gradient.angle * Math.PI) / 180;
        const dx = Math.sin(rad) / 2;
        const dy = -Math.cos(rad) / 2;
        defs.push(
          `<linearGradient id="${id}" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops}</linearGradient>`,
        );
      } else {
        defs.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
      }
      fill = `url(#${id})`;
    } else if (!imageFillUrl(style.fill)) {
      fill = style.fill;
    }
    // An image fill has no SVG equivalent without embedding the bytes, which is
    // the OpenRaster writer's job; here it degrades to no fill.
  }

  const dash = dashPattern(style.strokeStyle, style.strokeWidth);
  const parts = [
    `fill="${escapeXml(fill)}"`,
    `stroke="${escapeXml(style.stroke)}"`,
    `stroke-width="${style.strokeWidth}"`,
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
  ];
  if (dash.length) parts.push(`stroke-dasharray="${dash.join(' ')}"`);
  if (object.opacity !== 1) parts.push(`opacity="${object.opacity}"`);

  return { attrs: parts.join(' '), defs: defs.join('') };
}

function rotationAttr(object: VectorObject): string {
  if (!object.rotation) return '';
  const center = rectCenter(normalizeRect(object.frame));
  return ` transform="rotate(${object.rotation} ${center.x} ${center.y})"`;
}

/** One object as SVG markup, plus the `<defs>` it depends on. */
export function vectorObjectToSvg(object: VectorObject, index: number): { markup: string; defs: string } {
  if (!object.visible) return { markup: '', defs: '' };

  const { attrs, defs } = svgPaint(object, index);
  const rotate = rotationAttr(object);
  const id = ` id="${escapeXml(object.id)}"`;

  switch (object.kind) {
    case 'rect': {
      const r = normalizeRect(object.frame);
      const radius = object.cornerRadius > 0 ? ` rx="${object.cornerRadius}"` : '';
      return {
        markup: `<rect${id} x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"${radius} ${attrs}${rotate}/>`,
        defs,
      };
    }
    case 'ellipse': {
      const r = normalizeRect(object.frame);
      const c = rectCenter(r);
      return {
        markup: `<ellipse${id} cx="${c.x}" cy="${c.y}" rx="${r.width / 2}" ry="${r.height / 2}" ${attrs}${rotate}/>`,
        defs,
      };
    }
    case 'line': {
      const { x, y, width, height } = object.frame;
      const line = `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" ${attrs}/>`;
      const heads: string[] = [];
      const angle = Math.atan2(height, width);
      if (object.arrowEnd) heads.push(arrowHeadSvg({ x: x + width, y: y + height }, angle, object.style.stroke));
      if (object.arrowStart) heads.push(arrowHeadSvg({ x, y }, angle + Math.PI, object.style.stroke));
      return { markup: `<g${id}${rotate}>${line}${heads.join('')}</g>`, defs };
    }
    case 'path': {
      if (object.points.length < 2) return { markup: '', defs: '' };
      const d = pathToPathData(object);
      // An open path never takes its fill, matching the canvas emitter above.
      const pathAttrs = object.closed ? attrs : attrs.replace(/fill="[^"]*"/, 'fill="none"');
      const rule = object.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      return { markup: `<path${id} d="${d}"${rule} ${pathAttrs}${rotate}/>`, defs };
    }
  }
}

function arrowHeadSvg(tip: Point, angle: number, color: string): string {
  const p1 = {
    x: tip.x - ARROW_HEAD_LENGTH * Math.cos(angle - Math.PI / 6),
    y: tip.y - ARROW_HEAD_LENGTH * Math.sin(angle - Math.PI / 6),
  };
  const p2 = {
    x: tip.x - ARROW_HEAD_LENGTH * Math.cos(angle + Math.PI / 6),
    y: tip.y - ARROW_HEAD_LENGTH * Math.sin(angle + Math.PI / 6),
  };
  return `<polygon points="${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}" fill="${escapeXml(color)}" stroke="none"/>`;
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Whether a canvas-space point lands on an object.
 *
 * A path is tested against its own curve rather than against its box, so
 * clicking inside the loop of a freehand scribble does not select it — the box
 * of a long stroke covers most of the canvas and would otherwise swallow every
 * click. A *filled* closed path is the exception: its interior is painted, so
 * its interior is clickable.
 */
export function hitTestObject(object: VectorObject, point: Point, tolerance = 4): boolean {
  if (!object.visible) return false;

  const box = normalizeRect(object.frame);
  const local = object.rotation
    ? unrotatePoint(point, rectCenter(box), object.rotation)
    : point;

  if (object.kind === 'path') {
    const reach = tolerance + object.style.strokeWidth / 2;
    // Measured against the flattened curve, not the anchors: testing anchors
    // alone left the middle of every long bézier span unclickable, which the
    // freehand pen's dense point spacing had been hiding.
    if (distanceToPath(object, local) <= reach) return true;
    if (!object.closed || !isPaintedFill(object.style.fill)) return false;
    return pathContours(object).some((contour) => contour.closed && pointInContour(contour, local));
  }

  if (object.kind === 'line') {
    const { x, y, width, height } = object.frame;
    return distanceToSegment(local, { x, y }, { x: x + width, y: y + height })
      <= tolerance + object.style.strokeWidth;
  }

  const pad = tolerance + object.style.strokeWidth / 2;
  return (
    local.x >= box.x - pad && local.x <= box.x + box.width + pad &&
    local.y >= box.y - pad && local.y <= box.y + box.height + pad
  );
}

/** Re-exported so callers do not reach past this module for an object's extent. */
export { vectorObjectBounds };

/** The extent an object occupies, for selection frames and marquee tests. */
export function objectSelectionBox(object: VectorObject): Rect {
  return vectorObjectBounds(object);
}
