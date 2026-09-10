/**
 * Rectangle and transform arithmetic shared by the model, the renderer and the
 * OpenRaster writer.
 *
 * Kept free of canvas and of React so the tree helpers can compute bounds
 * without a DOM — which is also what lets the writer's tests run in jsdom,
 * where `getContext('2d')` returns nothing.
 */

import { IDENTITY, type Point, type Rect, type Transform2D, type VectorObject } from './types';

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** A rect with a non-negative size, moving the origin as needed. */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/** The smallest rect containing both. An empty input contributes nothing. */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || isEmptyRect(a)) return b && !isEmptyRect(b) ? b : null;
  if (!b || isEmptyRect(b)) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function unionRects(rects: (Rect | null)[]): Rect | null {
  return rects.reduce<Rect | null>((acc, r) => unionRect(acc, r), null);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pointInRect(p: Point, rect: Rect, pad = 0): boolean {
  return (
    p.x >= rect.x - pad &&
    p.x <= rect.x + rect.width + pad &&
    p.y >= rect.y - pad &&
    p.y <= rect.y + rect.height + pad
  );
}

/** Grows a rect by `pad` on every side. */
export function inflateRect(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
}

/** A rect snapped outward to whole pixels — what a rasteriser needs. */
export function outsetToPixels(rect: Rect): Rect {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(rect.x + rect.width) - x),
    height: Math.max(1, Math.ceil(rect.y + rect.height) - y),
  };
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export function rotatePoint(p: Point, center: Point, degrees: number): Point {
  if (!degrees) return { ...p };
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** The inverse of `rotatePoint` — used to test a cursor against unrotated geometry. */
export function unrotatePoint(p: Point, center: Point, degrees: number): Point {
  return rotatePoint(p, center, -degrees);
}

/** The axis-aligned extent of a rect once rotated about its own centre. */
export function rotatedRectBounds(rect: Rect, degrees: number): Rect {
  const normalized = normalizeRect(rect);
  if (!degrees) return normalized;
  const center = rectCenter(normalized);
  const corners: Point[] = [
    { x: normalized.x, y: normalized.y },
    { x: normalized.x + normalized.width, y: normalized.y },
    { x: normalized.x + normalized.width, y: normalized.y + normalized.height },
    { x: normalized.x, y: normalized.y + normalized.height },
  ].map((c) => rotatePoint(c, center, degrees));

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// ---------------------------------------------------------------------------
// Affine transforms
// ---------------------------------------------------------------------------

export function isIdentity(t: Transform2D): boolean {
  return t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0;
}

export function applyTransform(t: Transform2D, p: Point): Point {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

export function multiplyTransform(outer: Transform2D, inner: Transform2D): Transform2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function translation(dx: number, dy: number): Transform2D {
  return { ...IDENTITY, e: dx, f: dy };
}

/** The extent of a rect under an arbitrary affine transform. */
export function transformedRectBounds(rect: Rect, t: Transform2D): Rect {
  if (isIdentity(t)) return normalizeRect(rect);
  const r = normalizeRect(rect);
  const corners = [
    applyTransform(t, { x: r.x, y: r.y }),
    applyTransform(t, { x: r.x + r.width, y: r.y }),
    applyTransform(t, { x: r.x + r.width, y: r.y + r.height }),
    applyTransform(t, { x: r.x, y: r.y + r.height }),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// ---------------------------------------------------------------------------
// Vector objects
// ---------------------------------------------------------------------------

/**
 * A vector object's extent, including its stroke and its rotation.
 *
 * The stroke matters: a two-pixel line drawn along a zero-height frame covers a
 * two-pixel band, and a bounding box that ignored it would clip the object's
 * own PNG on export by exactly half the stroke on every side.
 */
export function vectorObjectBounds(object: VectorObject): Rect {
  const stroke = object.style.strokeWidth || 0;
  const base = object.kind === 'path'
    ? pathExtent(object.points)
    : normalizeRect(object.frame);
  const padded = inflateRect(base, stroke / 2 + (object.kind === 'line' && object.arrowEnd ? ARROW_HEAD_LENGTH / 2 : 0));
  return rotatedRectBounds(padded, object.rotation);
}

/** How far an arrowhead reaches past the end of its line. */
export const ARROW_HEAD_LENGTH = 14;

function pathExtent(points: Point[]): Rect {
  if (points.length === 0) return { ...EMPTY_RECT };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: Math.max(maxX - minX, 0), height: Math.max(maxY - minY, 0) };
}
