/**
 * The document as a standalone SVG.
 *
 * Rendered from the model, never by serialising the live canvas: the on-screen
 * canvas carries a viewport transform and selection handles, and a save must
 * not depend on a mounted DOM node.
 *
 * Everything is embedded. Raster layers and masks go in as `data:` URLs, which
 * is what makes the file one thing you can open, mail or drop into a README.
 * The one thing that cannot survive is an image *fill* on a vector shape whose
 * bytes are not in hand; those degrade to no fill, exactly as they do in
 * `vectorObjectToSvg`.
 */

import { isIdentity, normalizeRect } from '../document/geometry';
import { paintOrder } from '../document/tree';
import { escapeXml, vectorObjectToSvg } from './vectorObject';
import type {
  DrawingDocument,
  DrawingNode,
  LayerMask,
  StackNode,
  TextLayerNode,
  Transform2D,
} from '../document/types';

interface Emitter {
  defs: string[];
  /** Gives each gradient a unique id across the whole document. */
  nextIndex: () => number;
}

function transformAttr(t: Transform2D): string {
  return isIdentity(t) ? '' : ` transform="matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})"`;
}

/**
 * SVG's `mask` element is luminance-based by default, which is the same rule
 * the canvas compositor implements by hand — so a mask needs no conversion
 * here, only wrapping. A clipping mask has no channel and is skipped, matching
 * the canvas renderer rather than inventing a different answer for exports.
 */
function maskDef(mask: LayerMask, emitter: Emitter): string | null {
  if (!mask.enabled || !mask.source) return null;
  const id = `mask-${emitter.nextIndex()}`;
  const { x, y, width, height, dataUrl } = mask.source;
  const invert = mask.inverted
    ? '<filter id="' + id + '-invert"><feComponentTransfer><feFuncR type="table" tableValues="1 0"/>' +
      '<feFuncG type="table" tableValues="1 0"/><feFuncB type="table" tableValues="1 0"/></feComponentTransfer></filter>'
    : '';
  const filterAttr = mask.inverted ? ` filter="url(#${id}-invert)"` : '';
  emitter.defs.push(
    `${invert}<mask id="${id}" maskUnits="userSpaceOnUse">` +
      `<image href="${escapeXml(dataUrl)}" x="${x}" y="${y}" width="${width}" height="${height}"${filterAttr}/>` +
      `</mask>`,
  );
  return id;
}

function textToSvg(node: TextLayerNode): string {
  if (!node.text) return '';
  const box = normalizeRect(node.box);
  const anchor = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
  const x = node.align === 'center' ? box.x + box.width / 2
    : node.align === 'right' ? box.x + box.width
    : box.x;
  const lineHeight = node.fontSize * node.lineHeight;

  // Explicit newlines only. SVG has no automatic wrapping, so a line the canvas
  // wrapped for width is one long line here — the alternative is to bake the
  // canvas's wrap points into the file, which then stops reflowing if the box
  // is ever resized outside Neutrino.
  const tspans = node.text
    .split('\n')
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  const style = node.italic ? ' font-style="italic"' : '';
  return (
    `<text x="${x}" y="${box.y + node.fontSize}" font-family="${escapeXml(node.fontFamily)}" ` +
    `font-size="${node.fontSize}" font-weight="${node.fontWeight}"${style} ` +
    `text-anchor="${anchor}" fill="${escapeXml(node.color)}">${tspans}</text>`
  );
}

function nodeToSvg(node: DrawingNode, emitter: Emitter): string {
  if (!node.visible || node.opacity <= 0) return '';

  let inner = '';
  switch (node.type) {
    case 'raster': {
      const { x, y, width, height, dataUrl } = node.source;
      inner = `<image href="${escapeXml(dataUrl)}" x="${x}" y="${y}" width="${width}" height="${height}"/>`;
      break;
    }
    case 'text':
      inner = textToSvg(node);
      break;
    case 'vector':
      inner = paintOrderObjects(node.objects)
        .map((object) => {
          const { markup, defs } = vectorObjectToSvg(object, emitter.nextIndex());
          if (defs) emitter.defs.push(defs);
          return markup;
        })
        .filter(Boolean)
        .join('');
      break;
    case 'stack':
      inner = stackToSvg(node, emitter);
      break;
  }

  if (!inner) return '';

  const attrs: string[] = [`id="${escapeXml(node.id)}"`, `data-name="${escapeXml(node.name)}"`];
  if (node.opacity !== 1) attrs.push(`opacity="${node.opacity}"`);
  if (node.blendMode !== 'normal') attrs.push(`style="mix-blend-mode:${node.blendMode}"`);
  if (node.type === 'stack' && node.isolation === 'isolate') attrs.push('isolation="isolate"');

  const maskId = node.mask ? maskDef(node.mask, emitter) : null;
  if (maskId) attrs.push(`mask="url(#${maskId})"`);

  return `<g ${attrs.join(' ')}${transformAttr(node.transform)}>${inner}</g>`;
}

/** `objects[0]` is topmost, so painting runs backwards — as in the canvas renderer. */
function paintOrderObjects<T>(objects: readonly T[]): T[] {
  return [...objects].reverse();
}

function stackToSvg(stack: StackNode, emitter: Emitter): string {
  return paintOrder(stack).map((child) => nodeToSvg(child, emitter)).join('');
}

export interface SvgExportOptions {
  /** Overrides the canvas background. `null` exports transparent. */
  background?: string | null;
}

export function documentToSvg(doc: DrawingDocument, options: SvgExportOptions = {}): string {
  let counter = 0;
  const emitter: Emitter = { defs: [], nextIndex: () => counter++ };

  const body = stackToSvg(doc.root, emitter);
  const background = options.background !== undefined ? options.background : doc.canvas.background;
  const backgroundRect = background
    ? `<rect x="0" y="0" width="${doc.canvas.width}" height="${doc.canvas.height}" fill="${escapeXml(background)}"/>`
    : '';
  const defs = emitter.defs.length ? `<defs>${emitter.defs.join('')}</defs>` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${doc.canvas.width}" height="${doc.canvas.height}" ` +
    `viewBox="0 0 ${doc.canvas.width} ${doc.canvas.height}">` +
    `<title>${escapeXml(doc.metadata.title)}</title>` +
    `${defs}${backgroundRect}${body}</svg>`
  );
}
