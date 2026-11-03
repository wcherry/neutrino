/**
 * Part of a drawing, as a picture.
 *
 * Copying a selection and embedding one both draw "the drawing, but only these
 * layers or objects, cropped to them", so the plan for that is one function
 * both go through: what to hide, and the rectangle the result is cropped to.
 * It renders through `renderDocument` like everything else, so a copied layer
 * keeps its blend mode, mask, filters and adjustments exactly as on screen.
 */

import type { DrawingClipSelection } from '@/lib/canvasClipboard';
import type { DrawingDocument, DrawingNode, Rect } from '../document/types';
import { unionRects } from '../document/geometry';
import { ancestorsOf, findNode, nodeCanvasBounds, symbolTable, updateNode, visitNodes } from '../document/tree';
import { documentRenderOptions, domSurfaceFactory, renderDocument, type Surface } from '../render/renderDocument';

export interface SelectionRender {
  /** The document to render — for an object selection, with the other objects removed. */
  doc: DrawingDocument;
  /** Every node outside the selection, for `RenderOptions.skipNodeIds`. */
  skipNodeIds: Set<string>;
  /** What the picture is cropped to, in canvas coordinates. */
  bounds: Rect;
}

/**
 * What to draw for `selection`, or null when none of it exists any more — the
 * layers were deleted after the copy, or after the embed was made.
 *
 * A selected group brings its whole subtree; its ancestors are kept so their
 * transforms, opacity and masks still apply, and everything else is skipped.
 */
export function selectionRender(doc: DrawingDocument, selection: DrawingClipSelection): SelectionRender | null {
  let target = doc;
  let selected: DrawingNode[];

  if (selection.kind === 'objects') {
    const layer = findNode(doc.root, selection.layerId);
    if (layer?.type !== 'vector') return null;
    const ids = new Set(selection.ids);
    const objects = layer.objects.filter((o) => ids.has(o.id));
    if (objects.length === 0) return null;
    target = { ...doc, root: updateNode(doc.root, layer.id, () => ({ ...layer, objects })) };
    selected = [findNode(target.root, layer.id)!];
  } else {
    selected = selection.ids.map((id) => findNode(doc.root, id)).filter((n): n is DrawingNode => n !== null);
    if (selected.length === 0) return null;
  }

  const keep = new Set<string>();
  const leaves: DrawingNode[] = [];
  for (const node of selected) {
    for (const ancestor of ancestorsOf(target.root, node.id)) keep.add(ancestor.id);
    visitNodes(node, (n) => {
      keep.add(n.id);
      if (n.type !== 'stack') leaves.push(n);
    });
  }

  const skipNodeIds = new Set<string>();
  visitNodes(target.root, (n) => {
    if (n !== target.root && !keep.has(n.id)) skipNodeIds.add(n.id);
  });

  const symbols = symbolTable(target);
  const bounds = unionRects(leaves.map((n) => nodeCanvasBounds(target.root, n, symbols)));
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  return { doc: target, skipNodeIds, bounds: roundOut(bounds) };
}

/** Whole pixels that cover `rect`, so an antialiased edge is not cut in half. */
function roundOut(rect: Rect): Rect {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return { x, y, width: Math.ceil(rect.x + rect.width) - x, height: Math.ceil(rect.y + rect.height) - y };
}

/**
 * The selection drawn onto a surface `scale` × its canvas size, with a
 * transparent background — a picture of the selected layers, not of the page
 * they sit on.
 */
export function renderSelection(
  plan: SelectionRender,
  bitmaps: ReadonlyMap<string, CanvasImageSource>,
  scale = 1,
): Surface | null {
  const { doc, skipNodeIds, bounds } = plan;
  // The document's own factory, so a wide-gamut drawing is not clamped to sRGB on the way out.
  const createSurface = documentRenderOptions(doc).createSurface ?? domSurfaceFactory;
  const surface = createSurface(bounds.width * scale, bounds.height * scale);
  const ctx = surface.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  renderDocument(ctx, doc, { bitmaps, skipNodeIds, drawBackground: false, createSurface });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return surface;
}

/** The selection as a PNG. */
export function selectionToPng(plan: SelectionRender, bitmaps: ReadonlyMap<string, CanvasImageSource>): Promise<Blob> {
  const surface = renderSelection(plan, bitmaps);
  if (!surface || !('toBlob' in surface)) return Promise.reject(new Error('Nothing to render'));
  return new Promise((resolve, reject) => {
    (surface as HTMLCanvasElement).toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}
