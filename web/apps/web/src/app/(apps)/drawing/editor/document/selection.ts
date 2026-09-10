/**
 * The active pixel selection.
 *
 * A selection is a *region*, and everything that acts on one — a brush stroke
 * confined to it, a fill, a delete, the marching-ants overlay, the grayscale
 * PNG written into an `.ora` — needs that region in one of two forms: a path to
 * clip with, or a mask to multiply by. This module is where a `SelectionShape`
 * becomes either, so the four kinds behave identically everywhere and only the
 * cheap ones stay cheap.
 *
 * **A path is preferred over a mask wherever one exists.** Clipping with a
 * `Path2D` is antialiased by the rasteriser and costs nothing; building a mask
 * means allocating and reading back a canvas-sized buffer. Only the `mask`
 * kind — a flood fill, a feathered edge, a selection that arrived inside a file
 * — has no path, and it is the one case that pays for the buffer.
 *
 * Geometry only: no canvas is created here. Callers pass a surface factory, so
 * the OpenRaster writer's tests keep running in jsdom.
 */

import { EMPTY_RECT, normalizeRect, rectsIntersect } from './geometry';
import type { Point, RasterSource, Rect, SelectionShape } from './types';

// ---------------------------------------------------------------------------
// Extent
// ---------------------------------------------------------------------------

/** The area a selection covers, clipped to the canvas. Null when it covers none. */
export function selectionBounds(
  shape: SelectionShape,
  canvas: { width: number; height: number },
): Rect | null {
  const raw = rawBounds(shape);
  if (!raw) return null;
  const x = Math.max(0, Math.floor(raw.x));
  const y = Math.max(0, Math.floor(raw.y));
  const right = Math.min(canvas.width, Math.ceil(raw.x + raw.width));
  const bottom = Math.min(canvas.height, Math.ceil(raw.y + raw.height));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function rawBounds(shape: SelectionShape): Rect | null {
  switch (shape.kind) {
    case 'rect':
    case 'ellipse': {
      const rect = normalizeRect(shape.rect);
      return rect.width > 0 && rect.height > 0 ? rect : null;
    }
    case 'lasso': {
      if (shape.points.length < 3) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of shape.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'mask':
      return {
        x: shape.source.x,
        y: shape.source.y,
        width: shape.source.width,
        height: shape.source.height,
      };
  }
}

export function isSelectionEmpty(
  shape: SelectionShape | undefined,
  canvas: { width: number; height: number },
): boolean {
  return !shape || selectionBounds(shape, canvas) === null;
}

/** Whether a rectangle is touched by the selection at all — a cheap early out. */
export function selectionIntersects(
  shape: SelectionShape,
  rect: Rect,
  canvas: { width: number; height: number },
): boolean {
  const bounds = selectionBounds(shape, canvas);
  return bounds !== null && rectsIntersect(bounds, rect);
}

// ---------------------------------------------------------------------------
// As a path
// ---------------------------------------------------------------------------

/**
 * The selection's outline as canvas path commands, or null for a `mask`.
 *
 * Emitted as calls on a context rather than as a `Path2D` because `Path2D` does
 * not exist in jsdom, and the drag-time overlay that draws marching ants around
 * a selection is the same geometry as the clip that confines a brush to it —
 * one description, two uses.
 */
export function traceSelection(ctx: CanvasRenderingContext2D, shape: SelectionShape): boolean {
  switch (shape.kind) {
    case 'rect': {
      const rect = normalizeRect(shape.rect);
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      return true;
    }
    case 'ellipse': {
      const rect = normalizeRect(shape.rect);
      ctx.beginPath();
      ctx.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        Math.max(rect.width / 2, 0.5),
        Math.max(rect.height / 2, 0.5),
        0, 0, Math.PI * 2,
      );
      return true;
    }
    case 'lasso': {
      if (shape.points.length < 3) return false;
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      ctx.closePath();
      return true;
    }
    case 'mask':
      // A mask is a channel, not an outline. The caller falls back to
      // multiplying by it, which is what `applySelectionMask` does.
      return false;
  }
}

/**
 * Whether a canvas point is inside the selection.
 *
 * The `mask` kind answers `true` inside its rectangle without reading the
 * channel: the only caller is the cursor read-out, and decoding a PNG per mouse
 * move to refine "is the pointer in the selection" is not a trade worth making.
 */
export function selectionContains(shape: SelectionShape, point: Point): boolean {
  switch (shape.kind) {
    case 'rect':
    case 'mask': {
      const rect = rawBounds(shape);
      return rect !== null &&
        point.x >= rect.x && point.x <= rect.x + rect.width &&
        point.y >= rect.y && point.y <= rect.y + rect.height;
    }
    case 'ellipse': {
      const rect = normalizeRect(shape.rect);
      if (rect.width <= 0 || rect.height <= 0) return false;
      const dx = (point.x - (rect.x + rect.width / 2)) / (rect.width / 2);
      const dy = (point.y - (rect.y + rect.height / 2)) / (rect.height / 2);
      return dx * dx + dy * dy <= 1;
    }
    case 'lasso': {
      const points = shape.points;
      if (points.length < 3) return false;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a.y > point.y) !== (b.y > point.y) &&
            point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
          inside = !inside;
        }
      }
      return inside;
    }
  }
}

// ---------------------------------------------------------------------------
// As a mask
// ---------------------------------------------------------------------------

/** A canvas to draw into. Structurally what `render/renderDocument` calls a Surface. */
interface MaskSurface {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
}

export type MaskSurfaceFactory = (width: number, height: number) => MaskSurface;

/**
 * Confines everything already drawn on `surface` to the selection.
 *
 * `destination-in` against the selection's own shape, which is one operation
 * for a path and one composited draw for a mask — in both cases the alpha the
 * rasteriser produced is kept, so an antialiased edge stays antialiased rather
 * than being thresholded into a staircase.
 *
 * `origin` is the canvas coordinate at the surface's top-left pixel, so a layer
 * rasterised into a surface the size of its own content is clipped in the right
 * place.
 */
export function applySelectionMask(
  surface: MaskSurface,
  shape: SelectionShape,
  options: {
    createSurface: MaskSurfaceFactory;
    bitmaps?: ReadonlyMap<string, CanvasImageSource>;
    origin?: Point;
  },
): void {
  const ctx = surface.getContext('2d');
  if (!ctx) return;
  const origin = options.origin ?? { x: 0, y: 0 };

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.translate(-origin.x, -origin.y);

  if (traceSelection(ctx, shape)) {
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.restore();

  if (shape.kind !== 'mask') return;
  const bitmap = options.bitmaps?.get(shape.source.dataUrl);
  if (!bitmap) return;

  // The channel is grayscale, so its luminance has to become alpha before it
  // can act as one — the same conversion `applyMask` does for a layer mask, and
  // for the same reason: a plain black-and-white PNG is what people author.
  const channel = options.createSurface(surface.width, surface.height);
  const channelCtx = channel.getContext('2d');
  if (!channelCtx) return;
  channelCtx.drawImage(
    bitmap,
    shape.source.x - origin.x,
    shape.source.y - origin.y,
    shape.source.width,
    shape.source.height,
  );
  luminanceToAlpha(channelCtx, channel.width, channel.height);

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(channel as CanvasImageSource, 0, 0);
  ctx.restore();
}

/** Rec. 601 luma into the alpha channel, in place. Outside the drawn area stays 0. */
function luminanceToAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const data = ctx.getImageData(0, 0, width, height);
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    pixels[i + 3] = Math.round((pixels[i + 3] / 255) * luma);
    pixels[i] = 255;
    pixels[i + 1] = 255;
    pixels[i + 2] = 255;
  }
  ctx.putImageData(data, 0, 0);
}

/**
 * The selection as a canvas-sized grayscale surface — white selected, black not.
 *
 * This is what redesign §3 asks a selection to be stored as, and what the
 * OpenRaster writer puts in `data/selection.png`. Every kind is rendered
 * through it, so a rectangle and a flood fill produce the same sort of asset
 * and a reader has one thing to parse.
 */
export function selectionToMaskSurface(
  shape: SelectionShape,
  canvas: { width: number; height: number },
  options: { createSurface: MaskSurfaceFactory; bitmaps?: ReadonlyMap<string, CanvasImageSource> },
): MaskSurface | null {
  const surface = options.createSurface(canvas.width, canvas.height);
  const ctx = surface.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, surface.width, surface.height);

  if (traceSelection(ctx, shape)) {
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    return surface;
  }

  if (shape.kind !== 'mask') return surface;
  const bitmap = options.bitmaps?.get(shape.source.dataUrl);
  if (!bitmap) return surface;
  ctx.drawImage(bitmap, shape.source.x, shape.source.y, shape.source.width, shape.source.height);
  return surface;
}

// ---------------------------------------------------------------------------
// Combining
// ---------------------------------------------------------------------------

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

/**
 * Two selections combined.
 *
 * Only `replace` is exact for every pair. Anything else between two *different*
 * kinds has no closed form in this representation — the union of a rectangle
 * and a lasso is neither — so combining falls back to rasterising both, which
 * needs a canvas and therefore happens in the editor rather than here. What
 * this function does is the part that is pure: it recognises the cases where
 * the answer is still a simple shape, and reports the rest for the caller to
 * rasterise.
 */
export function combineSelections(
  current: SelectionShape | undefined,
  next: SelectionShape,
  mode: SelectionMode,
): { shape: SelectionShape } | { rasterize: [SelectionShape, SelectionShape]; mode: SelectionMode } {
  if (mode === 'replace' || !current) return { shape: next };

  // Two rectangles intersect to a rectangle, which is the one combination
  // common enough to be worth not rasterising: it is how you crop a marquee.
  if (mode === 'intersect' && current.kind === 'rect' && next.kind === 'rect') {
    const a = normalizeRect(current.rect);
    const b = normalizeRect(next.rect);
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const rect: Rect = right > x && bottom > y
      ? { x, y, width: right - x, height: bottom - y }
      : { ...EMPTY_RECT };
    return { shape: { kind: 'rect', rect } };
  }

  return { rasterize: [current, next], mode };
}

/**
 * A selection as a stored grayscale asset.
 *
 * Callers hand in the encoded PNG because encoding is asynchronous and this
 * module is not; the shape of the result is fixed here so the `.ora` writer and
 * the editor cannot disagree about where a selection channel sits.
 */
export function maskSelection(dataUrl: string, canvas: { width: number; height: number }): SelectionShape {
  const source: RasterSource = {
    dataUrl,
    width: Math.max(1, Math.round(canvas.width)),
    height: Math.max(1, Math.round(canvas.height)),
    x: 0,
    y: 0,
  };
  return { kind: 'mask', source };
}
