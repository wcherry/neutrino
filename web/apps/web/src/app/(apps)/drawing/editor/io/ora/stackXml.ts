/**
 * `stack.xml` — the OpenRaster layer stack.
 *
 * This is the file every other OpenRaster application reads to find out what a
 * drawing is made of, so it holds only what the format defines. Anything
 * Neutrino knows that OpenRaster does not — masks, guides, the vector source
 * behind a rasterised layer — lives in `META-INF/neutrino/document.json`
 * instead, where an unknown reader ignores it.
 *
 * Three details are load-bearing:
 *
 * - **The first child is the topmost layer.** The model uses the same order, so
 *   `children` is written straight through with no reversal anywhere.
 * - **Every `<layer>` points at a PNG.** OpenRaster's baseline `src` is a
 *   raster asset; there is no vector layer in the format. A vector or text
 *   layer is therefore rasterised on the way out, and stays vector in the
 *   Neutrino manifest.
 * - **Two extension attributes are used**, both from published OpenRaster
 *   extensions rather than invented here: `edit-locked` for a locked layer
 *   (layer-edit-locking) and `selected` for the active one (layer-selection).
 *   A reader that knows neither drops them and loses nothing but state.
 */

import { escapeXml } from '../../render/vectorObject';
import { toCompositeOp } from './compositeOp';
import type { DrawingDocument, DrawingNode, StackNode } from '../../document/types';

/** OpenRaster revision this writer targets. */
export const ORA_VERSION = '0.0.3';

export interface LayerAsset {
  /** The node this asset was rendered from. */
  nodeId: string;
  /** Path inside the archive, e.g. `data/layer-<id>.png`. */
  src: string;
  /** Offset of the asset's top-left pixel within the canvas. */
  x: number;
  y: number;
}

export interface StackXmlOptions {
  /** One entry per node that produced a PNG. A node with no entry is omitted. */
  assets: ReadonlyMap<string, LayerAsset>;
  /** Written as `selected="true"`, per the layer-selection extension. */
  selectedNodeId?: string | null;
}

function attr(name: string, value: string | number): string {
  return `${name}="${escapeXml(String(value))}"`;
}

function commonAttrs(node: DrawingNode): string[] {
  const attrs = [
    attr('name', node.name),
    attr('opacity', round(node.opacity)),
    attr('visibility', node.visible ? 'visible' : 'hidden'),
    attr('composite-op', toCompositeOp(node.blendMode)),
  ];
  if (node.locked) attrs.push(attr('edit-locked', 'true'));
  return attrs;
}

/** Trims float noise so a round-tripped opacity of 1 does not read `0.9999999`. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function nodeToXml(node: DrawingNode, options: StackXmlOptions, indent: string): string {
  const selected = options.selectedNodeId === node.id ? [attr('selected', 'true')] : [];

  if (node.type === 'stack') {
    const children = childrenXml(node, options, `${indent}  `);
    const attrs = [
      ...commonAttrs(node),
      attr('isolation', node.isolation),
      ...selected,
    ];
    // An empty group is still written: it is part of the document's structure,
    // and dropping it would silently reorganise the layer panel on reopen.
    return children
      ? `${indent}<stack ${attrs.join(' ')}>\n${children}\n${indent}</stack>`
      : `${indent}<stack ${attrs.join(' ')}/>`;
  }

  const asset = options.assets.get(node.id);
  // No asset means the node rendered to nothing — an empty layer, or one whose
  // bitmap failed to decode. Omitting it beats writing a `<layer>` whose `src`
  // points at a file that is not in the archive, which is a broken package.
  if (!asset) return '';

  const attrs = [
    ...commonAttrs(node),
    attr('src', asset.src),
    attr('x', Math.round(asset.x)),
    attr('y', Math.round(asset.y)),
    ...selected,
  ];
  return `${indent}<layer ${attrs.join(' ')}/>`;
}

function childrenXml(stack: StackNode, options: StackXmlOptions, indent: string): string {
  // `children` order *is* OpenRaster's order — first child topmost — so it is
  // written as-is. `tree.paintOrder`, which reverses it, exists for the
  // renderer and is deliberately not used here.
  return stack.children
    .map((child) => nodeToXml(child, options, indent))
    .filter(Boolean)
    .join('\n');
}

export function buildStackXml(doc: DrawingDocument, options: StackXmlOptions): string {
  const { canvas, metadata } = doc;
  const imageAttrs = [
    attr('version', ORA_VERSION),
    attr('w', Math.round(canvas.width)),
    attr('h', Math.round(canvas.height)),
    attr('xres', Math.round(canvas.dpi)),
    attr('yres', Math.round(canvas.dpi)),
    attr('name', metadata.title),
  ];

  const rootAttrs = [
    attr('name', doc.root.name || 'root'),
    attr('opacity', 1),
    attr('visibility', 'visible'),
    attr('composite-op', 'svg:src-over'),
    attr('isolation', 'auto'),
  ];

  const children = childrenXml(doc.root, options, '    ');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<image ${imageAttrs.join(' ')}>\n` +
    `  <stack ${rootAttrs.join(' ')}>\n` +
    (children ? `${children}\n` : '') +
    `  </stack>\n` +
    `</image>\n`
  );
}
