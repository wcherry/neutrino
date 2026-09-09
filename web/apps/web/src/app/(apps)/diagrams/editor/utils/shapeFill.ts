/**
 * Turning a shape's fill into SVG paint.
 *
 * The `FillPicker` speaks CSS — `linear-gradient(135deg, #a 0%, #b 100%)`, an
 * image behind `background-size: cover` — and a diagram is drawn in SVG, which
 * understands neither. An SVG element's `fill` takes a colour or a reference to
 * something in `<defs>`, so a gradient becomes a `<linearGradient>` and an image
 * becomes a `<pattern>`, each named after the shape that uses it.
 *
 * Everything here is pure and framework-free: the canvas builds the defs as
 * JSX, the standalone SVG export builds the same defs as a string, and both
 * read the paint reference from `fillPaint`.
 */

import type { DiagramShape, ShapeFill, ShapeStyle } from '../../types';

/** The fill a style declares — a plain colour when it has no `fillStyle`. */
export function shapeFillOf(style: ShapeStyle): ShapeFill {
  return style.fillStyle ?? { type: 'color', value: style.fill };
}

/** True when the fill has to be painted through `<defs>` rather than as a colour. */
export function fillNeedsDef(fill: ShapeFill): boolean {
  return fill.type === 'gradient' || fill.type === 'image';
}

/** The id of the def painting this shape, unique per shape since the geometry is baked in. */
export function fillDefId(shapeId: string): string {
  // Shape ids are generated, but a diagram imported from drawio can carry ids
  // with characters that are not valid in a fragment reference.
  return `dgfill-${shapeId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/**
 * What to put in the element's `fill` attribute.
 *
 * A gradient or an image resolves to its def; a colour is itself. A shape whose
 * def cannot be built — an image that has not resolved yet, a gradient this
 * parser does not recognise — falls back to `style.fill`, so a shape is never
 * invisible while its picture loads.
 */
export function fillPaint(shapeId: string, style: ShapeStyle, hasDef: boolean): string {
  return hasDef ? `url(#${fillDefId(shapeId)})` : style.fill;
}

// ── Gradients ───────────────────────────────────────────────────────────────

export interface GradientStop {
  color: string;
  /** Percent along the gradient, 0–100. */
  position: number;
}

export interface SvgGradient {
  kind: 'linear' | 'radial';
  stops: GradientStop[];
  /** Only meaningful for a linear gradient; objectBoundingBox units. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const DIR_TO_ANGLE: Record<string, number> = {
  'to top': 0, 'to top right': 45, 'to right': 90, 'to bottom right': 135,
  'to bottom': 180, 'to bottom left': 225, 'to left': 270, 'to top left': 315,
};

function readStops(parts: string[], startIdx: number): GradientStop[] {
  const raw = parts.slice(startIdx).map((part) => {
    const bits = part.trim().split(/\s+/);
    if (!/^#[0-9a-fA-F]{3,8}$/.test(bits[0] ?? '')) return null;
    const pct = bits[1]?.match(/^(\d+(?:\.\d+)?)%$/);
    return { color: bits[0], position: pct ? parseFloat(pct[1]) : -1 };
  }).filter((s): s is GradientStop => s !== null);

  // An omitted position is distributed evenly, as CSS does.
  return raw.map((s, i) => ({
    ...s,
    position: s.position >= 0 ? s.position : Math.round((i * 100) / Math.max(1, raw.length - 1)),
  }));
}

/**
 * The end points of a CSS gradient angle in objectBoundingBox units.
 *
 * CSS measures clockwise from "to top", SVG wants two corners of the unit
 * square with y running down. The unit square is an approximation for a shape
 * that is not square — CSS lengthens the line so the gradient reaches the
 * corners — but it puts the stops in the right places along the right axis,
 * which is what a shape fill is judged on.
 */
export function gradientVector(angleDeg: number): Pick<SvgGradient, 'x1' | 'y1' | 'x2' | 'y2'> {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = Math.cos(rad) / 2;
  return { x1: 0.5 - dx, y1: 0.5 + dy, x2: 0.5 + dx, y2: 0.5 - dy };
}

/** Parses the CSS gradient the picker stores; null for anything it does not model. */
export function parseGradient(css: string): SvgGradient | null {
  const linear = css.match(/^linear-gradient\((.+)\)$/is);
  if (linear) {
    const parts = splitArgs(linear[1]);
    const first = parts[0]?.trim() ?? '';
    let angle = 180;
    let startIdx = 0;
    const deg = first.match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (deg) { angle = parseFloat(deg[1]); startIdx = 1; }
    else if (/^to\s+/i.test(first)) { angle = DIR_TO_ANGLE[first.toLowerCase().trim()] ?? 180; startIdx = 1; }
    const stops = readStops(parts, startIdx);
    return stops.length >= 2 ? { kind: 'linear', stops, ...gradientVector(angle) } : null;
  }

  const radial = css.match(/^radial-gradient\((.+)\)$/is);
  if (radial) {
    const parts = splitArgs(radial[1]);
    // A leading shape/size keyword ("circle", "ellipse at center") is not a stop.
    const startIdx = /^#/.test(parts[0]?.trim() ?? '') ? 0 : 1;
    const stops = readStops(parts, startIdx);
    return stops.length >= 2
      ? { kind: 'radial', stops, x1: 0, y1: 0, x2: 0, y2: 0 }
      : null;
  }

  return null;
}

/**
 * The colour to keep in `style.fill` beside a non-colour fill.
 *
 * A gradient's first stop is the closest single colour to it; an image has no
 * such colour, so whatever the shape was filled with is kept.
 */
export function representativeColor(fill: ShapeFill, previous: string): string {
  if (fill.type === 'color') return fill.value;
  if (fill.type === 'gradient') return parseGradient(fill.value)?.stops[0]?.color ?? previous;
  return previous;
}

// ── Images ──────────────────────────────────────────────────────────────────

/** `preserveAspectRatio` for each object fit the picker can store. */
export function fitToAspectRatio(fit: 'cover' | 'contain' | 'fill' | undefined): string {
  if (fit === 'contain') return 'xMidYMid meet';
  if (fit === 'fill') return 'none';
  return 'xMidYMid slice';
}

/**
 * Every distinct image value used as a fill on the page.
 *
 * Callers resolve these to something loadable before drawing — the canvas
 * through the Drive image cache, an export by inlining the bytes.
 */
export function collectFillImages(shapes: DiagramShape[]): string[] {
  const values = new Set<string>();
  for (const shape of shapes) {
    const fill = shape.style.fillStyle;
    if (fill?.type === 'image' && fill.value) values.add(fill.value);
  }
  return [...values];
}

// ── Def descriptors ─────────────────────────────────────────────────────────

export type FillDef =
  | { kind: 'gradient'; id: string; gradient: SvgGradient }
  | { kind: 'pattern'; id: string; href: string; aspect: string; x: number; y: number; width: number; height: number };

/**
 * The def a shape needs, or null when its fill paints as a plain colour.
 *
 * `images` maps a stored image value to something the browser can load. A value
 * missing from it yields no def, which is what makes an unresolved image fall
 * back to the shape's colour rather than to nothing.
 */
export function fillDefFor(
  shape: DiagramShape,
  style: ShapeStyle,
  images?: ReadonlyMap<string, string>,
): FillDef | null {
  const fill = shapeFillOf(style);
  const id = fillDefId(shape.id);

  if (fill.type === 'gradient') {
    const gradient = parseGradient(fill.value);
    return gradient ? { kind: 'gradient', id, gradient } : null;
  }

  if (fill.type === 'image') {
    const href = images?.get(fill.value);
    if (!href) return null;
    return {
      kind: 'pattern',
      id,
      href,
      aspect: fitToAspectRatio(fill.objectFit),
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
    };
  }

  return null;
}
