/**
 * Writing an OpenRaster package.
 *
 * The output is a real `.ora`: a zip whose first entry is an uncompressed
 * `mimetype`, holding `stack.xml`, one PNG per layer under `data/`, a full-size
 * `mergedimage.png` and a `Thumbnails/thumbnail.png`. Krita and GIMP open it;
 * so does anything else that reads the format.
 *
 * **Rendering is injected.** `writeOra` never touches a canvas — it takes an
 * `OraRenderer` and asks it for blobs. That is not indirection for its own
 * sake: it is what lets the package's structure be tested in jsdom, where
 * `getContext('2d')` returns null and no PNG can be produced, and it keeps the
 * one piece with real branching (which layers exist, what `stack.xml` says,
 * what goes in the manifest) separate from the one piece that needs a browser.
 * `createCanvasRenderer` is the real implementation.
 *
 * **The `mimetype` entry has two hard requirements** from the OpenRaster file
 * layout spec: it must be the first entry in the archive, and it must be
 * stored uncompressed. Both are how a reader identifies the file from its first
 * bytes without inflating anything. JSZip writes entries in insertion order, so
 * "first" means "added first", and `compression: 'STORE'` is the second half.
 * Get either wrong and the package still unzips while strict readers reject it.
 */

import { assetSafeId } from '../../document/ids';
import { outsetToPixels } from '../../document/geometry';
import { selectionToMaskSurface } from '../../document/selection';
import { contentBounds, symbolTable } from '../../document/tree';
import {
  documentRenderOptions,
  domSurfaceFactory,
  renderDocumentToSurface,
  renderNodeToSurface,
  type RenderOptions,
  type Surface,
} from '../../render/renderDocument';
import { buildStackXml, type LayerAsset } from './stackXml';
import { MANIFEST_PATH, SELECTION_PATH, buildManifest } from './manifest';
import type { DrawingDocument, DrawingNode, Rect } from '../../document/types';

export const ORA_MIME_TYPE = 'image/openraster';
export const ORA_EXTENSION = 'ora';

/** OpenRaster asks for a thumbnail no larger than this on either side. */
export const THUMBNAIL_MAX = 256;

export interface RenderedLayer {
  png: Blob;
  /** Where the PNG's top-left pixel sits on the canvas. */
  x: number;
  y: number;
}

/**
 * What `writeOra` needs drawn. One implementation uses a canvas; the tests use
 * a stub.
 */
export interface OraRenderer {
  /** One layer alone, mask applied, or null when it covers no pixels. */
  renderLayer(node: DrawingNode): Promise<RenderedLayer | null>;
  /** A mask's own grayscale channel, for `data/mask-*.png`. */
  renderMask(node: DrawingNode): Promise<RenderedLayer | null>;
  /** The whole document flattened, at canvas size. Required by OpenRaster. */
  renderMerged(): Promise<Blob>;
  /** The same picture, fitted inside `THUMBNAIL_MAX`. Also required. */
  renderThumbnail(): Promise<Blob>;
  /**
   * The active selection as a canvas-sized grayscale channel, white where
   * selected — redesign §3's "active selections as grayscale PNG masks". Null
   * when nothing is selected.
   */
  renderSelection?(): Promise<Blob | null>;
}

export interface WriteOraOptions {
  /**
   * The layer to mark with the OpenRaster layer-selection extension, so
   * reopening the package lands on the layer it was saved from.
   */
  selectedNodeId?: string | null;
}

/** Depth-first over everything under the root, root excluded. */
function eachNode(doc: DrawingDocument, visit: (node: DrawingNode) => void): void {
  const walk = (node: DrawingNode): void => {
    visit(node);
    if (node.type === 'stack') node.children.forEach(walk);
  };
  doc.root.children.forEach(walk);
}

/**
 * Assembles the archive.
 *
 * Groups produce no PNG — they are `<stack>` elements whose children carry the
 * pixels — so only leaf layers are rendered. A leaf that renders to nothing is
 * left out of `stack.xml` entirely rather than pointing at a missing entry.
 */
export async function writeOra(
  doc: DrawingDocument,
  renderer: OraRenderer,
  options: WriteOraOptions = {},
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  // First and uncompressed — see the module comment.
  zip.file('mimetype', ORA_MIME_TYPE, { compression: 'STORE' });

  const assets = new Map<string, LayerAsset>();
  const maskSources = new Map<string, string>();

  const leaves: DrawingNode[] = [];
  eachNode(doc, (node) => {
    if (node.type !== 'stack') leaves.push(node);
  });

  for (const node of leaves) {
    const rendered = await renderer.renderLayer(node);
    if (!rendered) continue;
    const src = `data/layer-${assetSafeId(node.id)}.png`;
    zip.file(src, rendered.png);
    assets.set(node.id, { nodeId: node.id, src, x: rendered.x, y: rendered.y });
  }

  // Masks are written beside the layers even though the layer PNG already has
  // the mask baked into its alpha. The baked copy is the fallback every reader
  // sees; the separate channel is what makes the mask *editable* again on the
  // way back in, and throwing it away would make the round trip lossy in
  // exactly the way the manifest exists to prevent.
  for (const node of leaves) {
    if (!node.mask?.source) continue;
    const rendered = await renderer.renderMask(node);
    if (!rendered) continue;
    const src = `data/mask-${assetSafeId(node.mask.id)}.png`;
    zip.file(src, rendered.png);
    maskSources.set(node.mask.id, src);
  }

  // The active selection is a channel of its own, exactly as a mask is: a
  // region is not something `stack.xml` can express, and baking it into the
  // pixels would be a destructive answer to a non-destructive question.
  const selectionPng = doc.selection ? await renderer.renderSelection?.() : null;
  if (selectionPng) zip.file(SELECTION_PATH, selectionPng);

  zip.file('stack.xml', buildStackXml(doc, { assets, selectedNodeId: options.selectedNodeId }));
  zip.file('mergedimage.png', await renderer.renderMerged());
  zip.file('Thumbnails/thumbnail.png', await renderer.renderThumbnail());
  zip.file(
    MANIFEST_PATH,
    JSON.stringify(buildManifest(doc, assets, maskSources, { selection: selectionPng ? SELECTION_PATH : null }), null, 2),
  );

  return zip.generateAsync({ type: 'blob', mimeType: ORA_MIME_TYPE, compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// The browser renderer
// ---------------------------------------------------------------------------

function surfaceToPng(surface: Surface): Promise<Blob> {
  const canvas = surface as HTMLCanvasElement;
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob produced nothing'));
      }, 'image/png');
    });
  }
  const offscreen = surface as unknown as OffscreenCanvas;
  if (typeof offscreen.convertToBlob === 'function') {
    return offscreen.convertToBlob({ type: 'image/png' });
  }
  return Promise.reject(new Error('surface cannot produce a PNG'));
}

/** A node's pixel extent, clipped to the canvas. Null when it falls outside entirely. */
function layerRect(doc: DrawingDocument, node: DrawingNode): Rect | null {
  const bounds = contentBounds(node, symbolTable(doc));
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const snapped = outsetToPixels(bounds);
  const x = Math.max(0, snapped.x);
  const y = Math.max(0, snapped.y);
  const right = Math.min(doc.canvas.width, snapped.x + snapped.width);
  const bottom = Math.min(doc.canvas.height, snapped.y + snapped.height);
  if (right <= x || bottom <= y) return null;

  return { x, y, width: right - x, height: bottom - y };
}

export interface CanvasRendererOptions {
  bitmaps?: RenderOptions['bitmaps'];
  images?: RenderOptions['images'];
  /** Override the canvas background — `null` writes a transparent merged image. */
  background?: string | null;
  createSurface?: RenderOptions['createSurface'];
}

/**
 * The real renderer: everything through the same compositor the screen uses.
 *
 * A vector or text layer is rasterised here and nowhere else. That is what
 * makes the package portable — OpenRaster has no vector layer — and it is why
 * the manifest keeps the original: these pixels are the fallback, not the
 * document.
 */
export function createCanvasRenderer(
  doc: DrawingDocument,
  options: CanvasRendererOptions = {},
): OraRenderer {
  const createSurface = options.createSurface ?? domSurfaceFactory;
  // Through `documentRenderOptions` so a symbol instance and a caption bound to
  // a path rasterise here exactly as they draw on screen. Without it an
  // instance would silently export as an empty layer — the one failure mode
  // that looks fine until somebody opens the file somewhere else.
  const shared: RenderOptions = documentRenderOptions(doc, {
    bitmaps: options.bitmaps,
    images: options.images,
    createSurface,
  });

  return {
    async renderLayer(node) {
      const rect = layerRect(doc, node);
      if (!rect) return null;
      const surface = renderNodeToSurface(node, rect.width, rect.height, {
        ...shared,
        origin: { x: rect.x, y: rect.y },
      });
      if (!surface) return null;
      return { png: await surfaceToPng(surface), x: rect.x, y: rect.y };
    },

    async renderMask(node) {
      const source = node.mask?.source;
      if (!source) return null;
      const bitmap = options.bitmaps?.get(source.dataUrl);
      if (!bitmap) return null;

      // The channel is written at its own size and offset, untouched — a mask
      // re-encoded through a full-canvas surface would gain a border of
      // transparent pixels that read as "hide everything here".
      const surface = createSurface(source.width, source.height);
      const ctx = surface.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, source.width, source.height);
      return { png: await surfaceToPng(surface), x: source.x, y: source.y };
    },

    async renderMerged() {
      const surface = renderDocumentToSurface(doc, {
        ...shared,
        drawBackground: options.background !== null,
      });
      if (!surface) throw new Error('cannot render the merged image');
      return surfaceToPng(surface);
    },

    async renderThumbnail() {
      const full = renderDocumentToSurface(doc, {
        ...shared,
        drawBackground: options.background !== null,
      });
      if (!full) throw new Error('cannot render the thumbnail');

      const scale = Math.min(1, THUMBNAIL_MAX / Math.max(doc.canvas.width, doc.canvas.height));
      const width = Math.max(1, Math.round(doc.canvas.width * scale));
      const height = Math.max(1, Math.round(doc.canvas.height * scale));

      const thumb = createSurface(width, height);
      const ctx = thumb.getContext('2d');
      if (!ctx) throw new Error('cannot render the thumbnail');
      ctx.drawImage(full as CanvasImageSource, 0, 0, width, height);
      return surfaceToPng(thumb);
    },

    async renderSelection() {
      if (!doc.selection) return null;
      const surface = selectionToMaskSurface(doc.selection, doc.canvas, {
        createSurface,
        bitmaps: options.bitmaps,
      });
      return surface ? surfaceToPng(surface as Surface) : null;
    },
  };
}
