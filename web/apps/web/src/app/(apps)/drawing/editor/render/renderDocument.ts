/**
 * Compositing the layer tree onto a canvas.
 *
 * This is the one renderer. The on-screen canvas, the PNG export, the
 * OpenRaster merged image and each per-layer PNG in the `.ora` all come out of
 * it, so what a drawing looks like on screen and what it looks like in a saved
 * file cannot drift apart.
 *
 * **Compositing is done in buffers only when it has to be.** A layer that is
 * fully opaque, blends normally and carries no mask is drawn straight into the
 * target — which is almost every layer, almost all the time. Anything else
 * (a blend mode, an opacity below 1 on a *group*, a mask, an isolated group)
 * needs its own surface first, because `globalAlpha` and
 * `globalCompositeOperation` apply per drawing operation and a group is many of
 * them: composite its children one at a time at 50% and the overlaps come out
 * darker than the group ever should.
 *
 * **Bitmaps arrive decoded.** Raster layers and masks hold PNG data URLs, and
 * decoding one is asynchronous while rendering a frame is not, so the caller
 * decodes up front with `loadDocumentBitmaps` and passes the map in. A layer
 * whose bitmap is missing draws nothing rather than blocking the frame.
 */

import { findPathObject, isEffectivelyVisible, paintOrder, symbolTable, type SymbolTable } from '../document/tree';
import { isIdentity } from '../document/geometry';
import { adjustmentOps, isNeutralAdjustment } from '../document/adjustments';
import { canvasSupportsColorSpace, workingSpace, type ColorSpaceName } from '../document/color';
import { hasActiveFilters } from '../document/filters';
import { applyColorOps, blendAdjusted, type ImageLike } from './colorOps';
import { applyFilterChain } from './imageFilters';
import { drawVectorObject, type ImageResolver } from './vectorObject';
import { layoutText, layoutTextOnPath, textFont, type TextLine } from './textLayout';
import type {
  AdjustmentLayerNode,
  DrawingDocument,
  DrawingNode,
  LayerMask,
  PathObject,
  Point,
  RasterSource,
  StackNode,
  TextLayerNode,
} from '../document/types';

// Re-exported from their own module so the many callers that reach for text
// layout keep one import path while the layout itself lives with the
// path-following variant it shares its measuring with.
export { layoutText, textFont };
export type { TextLine };

/** A canvas to draw into. `HTMLCanvasElement` and `OffscreenCanvas` both satisfy it. */
export interface Surface {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
}

export type SurfaceFactory = (width: number, height: number) => Surface;

/** The default factory: a detached `<canvas>`. Replaced in tests and in workers. */
export const domSurfaceFactory: SurfaceFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

/**
 * A factory that allocates its surfaces in a given colour space.
 *
 * Wide gamut has to be asked for at `getContext` time, so it cannot be a render
 * option applied later — every buffer the compositor makes has to be created in
 * the space, or the first one that is not silently clamps the document back to
 * sRGB. Support is probed once here rather than per surface, and a browser
 * without it gets the ordinary factory back: a document authored in P3 still
 * opens, in sRGB, rather than failing.
 */
export function surfaceFactoryFor(space: ColorSpaceName): SurfaceFactory {
  if (space === 'srgb' || !canvasSupportsColorSpace(space)) return domSurfaceFactory;
  return (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    // `getContext` binds the space to the canvas, so calling it here is what
    // makes the later `getContext('2d')` through the `Surface` interface return
    // the wide-gamut context rather than a fresh sRGB one.
    canvas.getContext('2d', { colorSpace: space } as CanvasRenderingContext2DSettings);
    return canvas;
  };
}

export interface RenderOptions {
  /** Decoded raster and mask bitmaps, keyed by their `dataUrl`. */
  bitmaps?: ReadonlyMap<string, CanvasImageSource>;
  /** Decoded images for `url(…)` fills, keyed by the URL. */
  images?: ImageResolver;
  createSurface?: SurfaceFactory;
  /** Paint the canvas background before the layers. Off for a transparent export. */
  drawBackground?: boolean;
  /** Skip these nodes — how the editor hides a layer it is editing in an overlay. */
  skipNodeIds?: ReadonlySet<string>;
  /**
   * Canvas coordinate that lands at the surface's top-left pixel.
   *
   * This is what lets a layer be rasterised into a surface the size of its own
   * content rather than the size of the canvas — which is the whole point of
   * OpenRaster's per-layer `x`/`y` offsets, and the difference between a 40 KB
   * package and a 4 MB one for a drawing with twelve small layers.
   */
  origin?: Point;
  /**
   * Symbol definitions, so an `instance` node can draw the content it refers
   * to. Absent means instances draw nothing, which is what a caller rendering a
   * detached subtree gets and is honest — an instance with no definition has no
   * pixels of its own to fall back on.
   */
  symbols?: SymbolTable;
  /**
   * Resolves a `textPath` binding's target. A function rather than a map
   * because the paths live scattered through the layer tree and looking one up
   * costs a walk — a document with no text on a path should not pay for a
   * lookup table nothing reads.
   */
  paths?: (pathId: string) => PathObject | null;
  /**
   * The size of the intermediate buffers a blend, a mask, a filter or an
   * adjustment needs, in **canvas coordinates**.
   *
   * The document's own canvas size, filled in by `documentRenderOptions`. It
   * has to be stated rather than taken from the target surface, because the
   * target is not always in canvas coordinates: the editor's canvas is the
   * viewport in screen pixels with a zoom transform on it, so sizing a buffer
   * from it would crop every blended layer to the window at whatever number of
   * document pixels happened to fit — visible as a layer that loses its bottom
   * half when you zoom in.
   */
  bufferSize?: { width: number; height: number };
}

interface ResolvedOptions extends RenderOptions {
  createSurface: SurfaceFactory;
}

function resolve(options: RenderOptions): ResolvedOptions {
  return { ...options, createSurface: options.createSurface ?? domSurfaceFactory };
}

/**
 * Render options filled in from a document: its symbols, and a resolver for
 * text bound to a path.
 *
 * Every entry point that has a whole document in hand goes through this, so a
 * symbol or a curved caption cannot render on screen and vanish from an export
 * because one call site forgot to pass a table.
 */
export function documentRenderOptions(
  doc: DrawingDocument,
  options: RenderOptions = {},
): RenderOptions {
  return {
    ...options,
    symbols: options.symbols ?? symbolTable(doc),
    paths: options.paths ?? ((pathId) => findPathObject(doc.root, pathId)?.object ?? null),
    bufferSize: options.bufferSize ?? { width: doc.canvas.width, height: doc.canvas.height },
    // The document's colour space reaches every buffer through here, for the
    // same reason the symbol table does: one place that knows the document,
    // rather than each call site remembering to ask.
    createSurface: options.createSurface ?? surfaceFactoryFor(workingSpace(doc.colorProfile)),
  };
}

/** Where an intermediate buffer's size comes from, with the old behaviour as a fallback. */
function bufferExtent(ctx: CanvasRenderingContext2D, options: ResolvedOptions): { width: number; height: number } {
  return options.bufferSize ?? { width: ctx.canvas.width, height: ctx.canvas.height };
}

// ---------------------------------------------------------------------------
// Node content
// ---------------------------------------------------------------------------

function drawRaster(
  ctx: CanvasRenderingContext2D,
  source: RasterSource,
  options: ResolvedOptions,
): void {
  const bitmap = options.bitmaps?.get(source.dataUrl);
  if (!bitmap) return;
  ctx.drawImage(bitmap, source.x, source.y, source.width, source.height);
}

function drawText(
  ctx: CanvasRenderingContext2D,
  node: TextLayerNode,
  options: ResolvedOptions,
): void {
  if (!node.text) return;

  const path = node.textPath ? options.paths?.(node.textPath.pathId) : null;
  if (path) {
    drawTextOnPath(ctx, node, path);
    return;
  }

  const lines = layoutText(ctx, node);
  ctx.font = textFont(node);
  ctx.fillStyle = node.color;
  ctx.textBaseline = 'alphabetic';
  for (const line of lines) ctx.fillText(line.text, line.x, line.y);
}

/**
 * Text laid along a path, glyph by glyph.
 *
 * Each glyph is drawn in its own rotated frame, which is why this cannot go
 * through `fillText` once with a transform: the rotation differs per character
 * and a single transform would tilt the whole run by whatever the first
 * character's tangent happened to be.
 *
 * A binding whose path is missing falls through to the box layout above rather
 * than drawing nothing. Losing the curve is recoverable — the text is still on
 * screen and still says what it says — while an invisible layer is a caption
 * that has silently disappeared from the drawing.
 */
function drawTextOnPath(ctx: CanvasRenderingContext2D, node: TextLayerNode, path: PathObject): void {
  const glyphs = layoutTextOnPath(ctx, node, path);
  if (glyphs.length === 0) return;

  ctx.save();
  ctx.font = textFont(node);
  ctx.fillStyle = node.color;
  ctx.textBaseline = 'alphabetic';
  for (const glyph of glyphs) {
    ctx.save();
    ctx.translate(glyph.x, glyph.y);
    ctx.rotate(glyph.angle);
    ctx.fillText(glyph.char, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** A node's own content, with its transform applied but no opacity, blend or mask. */
function drawNodeContent(
  ctx: CanvasRenderingContext2D,
  node: DrawingNode,
  options: ResolvedOptions,
): void {
  ctx.save();
  if (!isIdentity(node.transform)) {
    const t = node.transform;
    ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
  }

  switch (node.type) {
    case 'raster':
      drawRaster(ctx, node.source, options);
      break;
    case 'text':
      drawText(ctx, node, options);
      break;
    case 'vector':
      // `objects[0]` is topmost, as `children[0]` is, so painting runs backwards.
      for (let i = node.objects.length - 1; i >= 0; i--) {
        drawVectorObject(ctx, node.objects[i], options.images);
      }
      break;
    case 'stack':
      drawStackChildren(ctx, node, options);
      break;
    case 'instance': {
      const symbol = options.symbols?.get(node.symbolId);
      // The definition's *content* is composited, not merely drawn, so a
      // symbol built from a group keeps its children's blend modes and
      // opacities — an instance is a second placement of the content, not a
      // flattened picture of it.
      if (symbol) compositeNode(ctx, symbol.content, options);
      break;
    }
    case 'adjustment':
      // An adjustment has no content of its own: it acts on what is already on
      // the surface, which is `drawStackChildren`'s business because only it
      // knows what "already" means. Reaching one here is a node composited on
      // its own — a symbol's content, say — where there is nothing below to
      // correct.
      break;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/**
 * Turns a grayscale mask into an alpha channel and multiplies it into `surface`.
 *
 * The mask's luminance becomes alpha and its own alpha is discarded, which is
 * what makes a plain black-and-white PNG work as a mask. `destination-in` then
 * keeps only what the mask covers.
 *
 * A `clipping` mask has no channel of its own — it takes its shape from the
 * layer below — so it is skipped here and handled by `drawStackChildren`, which
 * is the only place with both layers in hand.
 */
function maskAlphaSurface(
  mask: LayerMask,
  width: number,
  height: number,
  options: ResolvedOptions,
): Surface | null {
  if (!mask.source) return null;
  const bitmap = options.bitmaps?.get(mask.source.dataUrl);
  if (!bitmap) return null;

  const maskSurface = options.createSurface(width, height);
  const maskCtx = maskSurface.getContext('2d');
  if (!maskCtx) return null;

  const origin = options.origin ?? { x: 0, y: 0 };
  maskCtx.drawImage(
    bitmap,
    mask.source.x - origin.x,
    mask.source.y - origin.y,
    mask.source.width,
    mask.source.height,
  );

  const data = maskCtx.getImageData(0, 0, maskSurface.width, maskSurface.height);
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    // Rec. 601 luma, the same weighting every image editor uses for "convert
    // to grayscale", so a mask authored elsewhere reads the way it looked.
    const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    // Outside the mask's own rectangle alpha is 0, and an unpainted area must
    // hide rather than show, so transparency is treated as black.
    const value = (pixels[i + 3] / 255) * luma;
    pixels[i + 3] = Math.round(mask.inverted ? 255 - value : value);
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
  }
  maskCtx.putImageData(data, 0, 0);
  return maskSurface;
}

function applyMask(
  surface: Surface,
  mask: LayerMask,
  options: ResolvedOptions,
): void {
  if (!mask.enabled) return;
  const maskSurface = maskAlphaSurface(mask, surface.width, surface.height, options);
  if (!maskSurface) return;

  const ctx = surface.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskSurface as CanvasImageSource, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------

function needsOwnSurface(node: DrawingNode): boolean {
  // A clipping mask carries no channel, so `applyMask` does nothing for one and
  // a buffer allocated on its account would be pure cost. Clipping is applied
  // by `drawStackChildren`, which has the layer below in hand.
  if (node.mask?.enabled && node.mask.source) return true;
  if (node.blendMode !== 'normal') return true;
  // A filter reads neighbouring pixels, so it needs the layer alone on a
  // surface: run over the target it would blur whatever else is already there.
  if (hasActiveFilters(node.filters)) return true;
  if (node.type === 'stack') return node.opacity < 1 || node.isolation === 'isolate';
  return false;
}

/** Whether an adjustment layer would actually correct anything. */
function isActiveAdjustment(node: DrawingNode, options: ResolvedOptions): node is AdjustmentLayerNode {
  return (
    node.type === 'adjustment' &&
    node.visible &&
    node.opacity > 0 &&
    !options.skipNodeIds?.has(node.id) &&
    !isNeutralAdjustment(node.adjustment)
  );
}

function isClipped(node: DrawingNode): boolean {
  return node.mask?.kind === 'clipping' && node.mask.enabled;
}

/**
 * A stack's children, bottom to top, with clipping groups resolved.
 *
 * A clipping mask takes its shape from **the nearest layer below that is not
 * itself clipped** — the base of the clipping group — which is the rule every
 * other editor uses and the reason a run of clipped layers all clip to the same
 * thing rather than each to the one under it. Tracking the base is why this
 * loop is indexed rather than a `for…of`: the compositor needs two nodes at
 * once, and that pairing exists nowhere else in the renderer.
 *
 * A hidden base hides its whole clipping group. That follows from what a
 * clipping mask means: the clipped layer is painted *into* the base's pixels,
 * and a base with no pixels on screen has none to paint into.
 */
function drawStackChildren(
  ctx: CanvasRenderingContext2D,
  stack: StackNode,
  options: ResolvedOptions,
): void {
  const children = paintOrder(stack);

  // An adjustment reads the pixels below it, so the stack has to be composited
  // somewhere it *owns* — read them off the target and a correction at the root
  // would also grab the editor's page shadow and the grey around it. The buffer
  // is in canvas coordinates, which is also what makes the correction identical
  // on screen and in an export rather than varying with the zoom.
  if (children.some((child) => isActiveAdjustment(child, options))) {
    const { width, height } = bufferExtent(ctx, options);
    const surface = options.createSurface(width, height);
    const bufferCtx = surface.getContext('2d');
    if (bufferCtx) {
      compositeChildren(bufferCtx, children, options);
      ctx.save();
      ctx.drawImage(surface as CanvasImageSource, 0, 0);
      ctx.restore();
      return;
    }
    // No context to buffer into — a stub surface, or a browser out of memory.
    // Compositing straight through loses the correction and keeps the drawing.
  }

  compositeChildren(ctx, children, options);
}

/**
 * The children themselves, bottom to top.
 *
 * Split from `drawStackChildren` so the buffered and unbuffered paths run the
 * same loop: an adjustment layer must not be the one case where clipping groups
 * or skipped nodes behave differently.
 */
function compositeChildren(
  ctx: CanvasRenderingContext2D,
  children: readonly DrawingNode[],
  options: ResolvedOptions,
): void {
  let base: DrawingNode | null = null;

  for (const child of children) {
    if (child.type === 'adjustment') {
      if (isActiveAdjustment(child, options)) applyAdjustmentLayer(ctx, child, base, options);
      // An adjustment is not a base: it has no alpha for a clipping mask above
      // it to take its shape from, and treating it as one would break the
      // group of clipped layers it sits in the middle of.
      continue;
    }

    if (!isClipped(child)) {
      // The base is tracked before visibility is considered, so hiding a
      // clipped layer does not silently re-point the layers above it at a
      // different base.
      base = child;
      if (!child.visible || child.opacity <= 0) continue;
      if (options.skipNodeIds?.has(child.id)) continue;
      compositeNode(ctx, child, options);
      continue;
    }

    if (!child.visible || child.opacity <= 0) continue;
    if (options.skipNodeIds?.has(child.id)) continue;
    compositeClipped(ctx, child, base, options);
  }
}

/**
 * One adjustment layer, applied to everything already on the surface.
 *
 * The correction is computed over the whole surface and then *mixed back*
 * towards the original by the layer's opacity and its mask, because a partial
 * adjustment is a partial mix and not the adjustment applied to some of the
 * pixels — half a hue rotation is a different colour, not a smaller region.
 *
 * A `clipping` mask takes its weights from the alpha of the layer below, which
 * is the ordinary way to correct one layer without correcting its neighbours,
 * and is why this is given the running `base` rather than looking one up.
 */
function applyAdjustmentLayer(
  ctx: CanvasRenderingContext2D,
  node: AdjustmentLayerNode,
  base: DrawingNode | null,
  options: ResolvedOptions,
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (width <= 0 || height <= 0) return;

  let source: ImageData;
  try {
    source = ctx.getImageData(0, 0, width, height);
  } catch {
    // A tainted canvas. Nothing here can recover, and the layers below are
    // already drawn, so the correction is dropped rather than the picture.
    return;
  }

  const adjusted: ImageLike = {
    data: new Uint8ClampedArray(source.data),
    width: source.width,
    height: source.height,
  };
  applyColorOps(adjusted, adjustmentOps(node.adjustment));

  const weights = adjustmentWeights(node, base, width, height, options);
  blendAdjusted(source, adjusted, node.opacity, weights);
  ctx.putImageData(source, 0, 0);
}

/**
 * The per-pixel strength of an adjustment: its mask, as an alpha channel in the
 * surface's own pixel grid, or null for "everywhere".
 */
function adjustmentWeights(
  node: AdjustmentLayerNode,
  base: DrawingNode | null,
  width: number,
  height: number,
  options: ResolvedOptions,
): Uint8ClampedArray | null {
  const mask = node.mask;
  if (!mask?.enabled) return null;

  if (mask.kind === 'clipping') {
    if (!base || !base.visible || base.opacity <= 0) return null;
    const surface = renderNodeToSurface(base, width, height, { ...options, origin: undefined });
    const ctx = surface?.getContext('2d');
    if (!ctx) return null;
    return ctx.getImageData(0, 0, width, height).data;
  }

  // The same surface `applyMask` multiplies by — one description of "a
  // grayscale channel is an alpha channel" rather than two that can disagree.
  const surface = maskAlphaSurface(mask, width, height, { ...options, origin: undefined });
  const ctx = surface?.getContext('2d');
  if (!ctx) return null;
  return ctx.getImageData(0, 0, width, height).data;
}

/** One layer confined to the alpha of the layer it is clipped to. */
function compositeClipped(
  ctx: CanvasRenderingContext2D,
  node: DrawingNode,
  base: DrawingNode | null,
  options: ResolvedOptions,
): void {
  if (!base || !base.visible || base.opacity <= 0) return;

  const { width, height } = bufferExtent(ctx, options);
  // `origin` is dropped for every intermediate buffer: a buffer is in canvas
  // coordinates, and the target's own transform is what places it. Carrying the
  // origin into both would shift the content by it twice.
  const inner: ResolvedOptions = { ...options, origin: undefined };
  const surface = renderNodeToSurface(node, width, height, inner);
  if (!surface) return;

  const baseSurface = renderNodeToSurface(base, width, height, inner);
  const surfaceCtx = surface.getContext('2d');
  if (baseSurface && surfaceCtx) {
    surfaceCtx.save();
    // `destination-in` keeps the base's *alpha*, not its colour, which is
    // exactly what a clipping mask is: the shape of what is underneath.
    surfaceCtx.globalCompositeOperation = 'destination-in';
    surfaceCtx.drawImage(baseSurface as CanvasImageSource, 0, 0);
    surfaceCtx.restore();
  }

  ctx.save();
  ctx.globalAlpha = node.opacity;
  ctx.globalCompositeOperation = node.blendMode === 'normal' ? 'source-over' : node.blendMode;
  ctx.drawImage(surface as CanvasImageSource, 0, 0);
  ctx.restore();
}

function compositeNode(
  ctx: CanvasRenderingContext2D,
  node: DrawingNode,
  options: ResolvedOptions,
): void {
  if (!needsOwnSurface(node)) {
    ctx.save();
    ctx.globalAlpha = node.opacity;
    drawNodeContent(ctx, node, options);
    ctx.restore();
    return;
  }

  const { width, height } = bufferExtent(ctx, options);
  const surface = renderNodeToSurface(node, width, height, { ...options, origin: undefined });
  if (!surface) return;

  ctx.save();
  ctx.globalAlpha = node.opacity;
  // The blend-mode names in the model are the canvas spellings, so this is a
  // pass-through rather than a mapping — see `document/types.ts`.
  ctx.globalCompositeOperation = node.blendMode === 'normal' ? 'source-over' : node.blendMode;
  ctx.drawImage(surface as CanvasImageSource, 0, 0);
  ctx.restore();
}

/**
 * One node alone on a transparent surface of the given size, with its mask
 * applied but *not* its own opacity or blend mode — those belong to whoever
 * composites it, and baking them in here would apply them twice.
 *
 * This is also what the OpenRaster writer rasterises each layer with, which is
 * why the mask is applied and the blend is not: `composite-op` and `opacity`
 * are attributes on the `<layer>` element, and the mask is the part OpenRaster
 * cannot express and so has to arrive already in the pixels.
 *
 * **Filters run before the mask.** A blurred layer confined to a mask is a blur
 * inside a shape; masking first and blurring after would smear the mask's own
 * edge, which is the one thing a mask exists to keep sharp.
 */
export function renderNodeToSurface(
  node: DrawingNode,
  width: number,
  height: number,
  options: RenderOptions = {},
): Surface | null {
  const resolved = resolve(options);
  const surface = resolved.createSurface(width, height);
  const ctx = surface.getContext('2d');
  if (!ctx) return null;

  const origin = resolved.origin;
  if (origin) ctx.translate(-origin.x, -origin.y);
  drawNodeContent(ctx, node, resolved);
  if (origin) ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (node.filters) applyNodeFilters(surface, node.filters);
  if (node.mask) applyMask(surface, node.mask, resolved);
  return surface;
}

/**
 * A layer's filter chain, over its own surface.
 *
 * Read back, rewritten and put back once for the whole chain rather than per
 * filter — a `getImageData`/`putImageData` pair is by far the most expensive
 * thing in here, and the chain is arithmetic on an array in between.
 */
function applyNodeFilters(surface: Surface, filters: readonly import('../document/filters').FilterSpec[]): void {
  if (!hasActiveFilters(filters)) return;
  const ctx = surface.getContext('2d');
  if (!ctx || surface.width <= 0 || surface.height <= 0) return;

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, surface.width, surface.height);
  } catch {
    return;
  }
  applyFilterChain(image, filters);
  ctx.putImageData(image, 0, 0);
}

/**
 * The whole document, composited at canvas resolution into `ctx`.
 *
 * `ctx` is expected to already carry any viewport transform the caller wants;
 * everything drawn here is in canvas coordinates.
 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  doc: DrawingDocument,
  options: RenderOptions = {},
): void {
  const resolved = resolve(documentRenderOptions(doc, options));

  if (options.drawBackground !== false && doc.canvas.background) {
    ctx.save();
    ctx.fillStyle = doc.canvas.background;
    ctx.fillRect(0, 0, doc.canvas.width, doc.canvas.height);
    ctx.restore();
  }

  drawStackChildren(ctx, doc.root, resolved);
}

/** The document flattened onto one canvas-sized surface — OpenRaster's merged image. */
export function renderDocumentToSurface(
  doc: DrawingDocument,
  options: RenderOptions = {},
): Surface | null {
  const resolved = resolve(documentRenderOptions(doc, options));
  const surface = resolved.createSurface(doc.canvas.width, doc.canvas.height);
  const ctx = surface.getContext('2d');
  if (!ctx) return null;
  renderDocument(ctx, doc, resolved);
  return surface;
}

// ---------------------------------------------------------------------------
// Bitmap loading
// ---------------------------------------------------------------------------

function collectDataUrls(doc: DrawingDocument): string[] {
  const urls = new Set<string>();
  const walk = (node: DrawingNode): void => {
    if (node.type === 'raster') urls.add(node.source.dataUrl);
    if (node.mask?.source) urls.add(node.mask.source.dataUrl);
    if (node.type === 'stack') node.children.forEach(walk);
  };
  walk(doc.root);
  // A symbol's content is off the tree, so walking the root alone misses the
  // pixels of every raster layer inside one — which renders as an instance that
  // silently draws nothing.
  for (const symbol of doc.symbols ?? []) walk(symbol.content);
  if (doc.selection?.kind === 'mask') urls.add(doc.selection.source.dataUrl);
  return [...urls];
}

function decode(url: string): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Decodes every raster layer and mask in the document.
 *
 * One entry per distinct data URL, so two layers sharing pixels decode once. A
 * URL that fails to decode is simply absent from the map, and the renderer
 * draws nothing for it — a corrupt layer costs its own pixels and not the frame.
 *
 * `previous` carries decoded bitmaps forward. A data URL is immutable — a layer
 * whose pixels changed has a *different* URL — so an entry that is still
 * referenced is still correct, and reusing it is what stops a brush stroke
 * re-decoding every other layer in the drawing. Anything no longer referenced
 * simply falls out of the new map.
 */
export async function loadDocumentBitmaps(
  doc: DrawingDocument,
  previous?: ReadonlyMap<string, CanvasImageSource>,
): Promise<Map<string, CanvasImageSource>> {
  const urls = collectDataUrls(doc);
  const map = new Map<string, CanvasImageSource>();

  const pending: Promise<void>[] = [];
  for (const url of urls) {
    const cached = previous?.get(url);
    if (cached) {
      map.set(url, cached);
      continue;
    }
    pending.push(decode(url).then((bitmap) => {
      if (bitmap) map.set(url, bitmap);
    }));
  }
  await Promise.all(pending);
  return map;
}

/** Whether anything in the document would be drawn at all, tree visibility included. */
export function hasVisibleContent(doc: DrawingDocument): boolean {
  let visible = false;
  const walk = (node: DrawingNode): void => {
    if (visible) return;
    if (node.type === 'stack') {
      node.children.forEach(walk);
      return;
    }
    const hasContent =
      node.type === 'raster' ||
      node.type === 'instance' ||
      (node.type === 'text' && node.text.trim() !== '') ||
      (node.type === 'vector' && node.objects.some((o) => o.visible));
    if (hasContent && isEffectivelyVisible(doc.root, node.id)) visible = true;
  };
  walk(doc.root);
  return visible;
}
