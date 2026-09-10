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
import { pathToPathData } from '../document/path';
import { findPathObject, paintOrder, symbolTable, type SymbolTable } from '../document/tree';
import { escapeXml, vectorObjectToSvg } from './vectorObject';
import type {
  DrawingDocument,
  DrawingNode,
  LayerMask,
  PathObject,
  StackNode,
  TextLayerNode,
  Transform2D,
} from '../document/types';

interface Emitter {
  defs: string[];
  /** Gives each gradient a unique id across the whole document. */
  nextIndex: () => number;
  symbols: SymbolTable;
  /** Symbol ids already emitted as a `<symbol>`, so each is written once. */
  emitted: Set<string>;
  resolvePath: (pathId: string) => PathObject | null;
  /**
   * Ids the document has actually put in the output, so a `<textPath href>`
   * only points at one that exists.
   */
  visibleIds: Set<string>;
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

/**
 * Text bound to a path, as SVG's own `<textPath>`.
 *
 * The reference is the whole point — reshape the path in any SVG editor and the
 * text re-flows — so the geometry is *not* duplicated into the text element
 * when the path is part of the output. When it is not (the path is hidden, or
 * sits in a hidden layer, so nothing emitted it), the curve is written into the
 * document's `<defs>` as a bare `<path>` with the same id. A `<textPath>`
 * pointing at nothing renders as nothing in every conforming viewer, and a
 * caption that disappears because its guide was hidden is the failure this
 * avoids.
 */
function textPathToSvg(node: TextLayerNode, path: PathObject, emitter: Emitter): string {
  const binding = node.textPath!;
  if (!emitter.visibleIds.has(path.id)) {
    emitter.defs.push(`<path id="${escapeXml(path.id)}" d="${pathToPathData(path)}" fill="none"/>`);
    emitter.visibleIds.add(path.id);
  }

  const style = node.italic ? ' font-style="italic"' : '';
  const offset = ` startOffset="${binding.startOffset}%"`;
  const side = binding.side === 'right' ? ' side="right"' : '';
  const shift = binding.baselineOffset ? ` dy="${-binding.baselineOffset}"` : '';

  return (
    `<text font-family="${escapeXml(node.fontFamily)}" font-size="${node.fontSize}" ` +
    `font-weight="${node.fontWeight}"${style} fill="${escapeXml(node.color)}" ` +
    `text-anchor="${binding.align}">` +
    `<textPath href="#${escapeXml(path.id)}" xlink:href="#${escapeXml(path.id)}"${offset}${side}${shift}>` +
    `${escapeXml(node.text.replace(/\n/g, ' '))}` +
    `</textPath></text>`
  );
}

function textToSvg(node: TextLayerNode, emitter: Emitter): string {
  if (!node.text) return '';

  const path = node.textPath ? emitter.resolvePath(node.textPath.pathId) : null;
  if (path) return textPathToSvg(node, path, emitter);

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
      inner = textToSvg(node, emitter);
      break;
    case 'vector':
      inner = paintOrderObjects(node.objects)
        .map((object) => {
          const { markup, defs } = vectorObjectToSvg(object, emitter.nextIndex());
          if (defs) emitter.defs.push(defs);
          if (markup) emitter.visibleIds.add(object.id);
          return markup;
        })
        .filter(Boolean)
        .join('');
      break;
    case 'stack':
      inner = stackToSvg(node, emitter);
      break;
    case 'instance':
      inner = instanceToSvg(node, emitter);
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

/**
 * An instance as `<use href="#…">` against a `<symbol>` in `<defs>`.
 *
 * SVG has the same idea Neutrino does, so this is a translation rather than a
 * flattening — a file with twelve instances of one tree carries the tree once,
 * and editing it in Inkscape updates all twelve. The `<symbol>` is emitted the
 * first time an instance asks for it, so an unused definition costs nothing.
 *
 * `<symbol>` deliberately carries no `viewBox`: the content is authored in the
 * document's own coordinates and a viewBox would rescale it to the `<use>`
 * element's size, which is not what an instance means here.
 */
function instanceToSvg(node: import('../document/types').InstanceNode, emitter: Emitter): string {
  const symbol = emitter.symbols.get(node.symbolId);
  if (!symbol) return '';

  if (!emitter.emitted.has(symbol.id)) {
    // Marked before the content is generated: a symbol whose content somehow
    // referred back to itself would otherwise recurse until the stack gave out.
    emitter.emitted.add(symbol.id);
    const content = nodeToSvg(symbol.content, emitter);
    emitter.defs.push(
      `<symbol id="${escapeXml(symbolElementId(symbol.id))}" overflow="visible">${content}</symbol>`,
    );
  }
  const href = `#${escapeXml(symbolElementId(symbol.id))}`;
  return `<use href="${href}" xlink:href="${href}"/>`;
}

function symbolElementId(id: string): string {
  // Prefixed so a symbol's element id cannot collide with the node id of the
  // content inside it, which `nodeToSvg` writes as a plain `id`.
  return `symbol-${id}`;
}

/** `objects[0]` is topmost, so painting runs backwards — as in the canvas renderer. */
function paintOrderObjects<T>(objects: readonly T[]): T[] {
  return [...objects].reverse();
}

/**
 * A stack's children, with clipping groups resolved the same way the canvas
 * compositor resolves them.
 *
 * SVG has no clipping-mask concept, but it has masks with an alpha source:
 * `mask-type="alpha"` makes a `<mask>` use its content's transparency rather
 * than its luminance, which is precisely "the shape of the layer below". The
 * base is therefore emitted twice — once as itself, once inside the mask — and
 * that duplication is the price of the format having no reference for it.
 */
function stackToSvg(stack: StackNode, emitter: Emitter): string {
  const out: string[] = [];
  let base: DrawingNode | null = null;

  for (const child of paintOrder(stack)) {
    if (child.mask?.kind !== 'clipping' || !child.mask.enabled) {
      base = child;
      out.push(nodeToSvg(child, emitter));
      continue;
    }

    const markup = nodeToSvg(child, emitter);
    if (!markup) continue;
    if (!base || !base.visible) continue;

    const baseMarkup = nodeToSvg(base, emitter);
    if (!baseMarkup) {
      out.push(markup);
      continue;
    }
    const id = `clip-${emitter.nextIndex()}`;
    emitter.defs.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" style="mask-type:alpha">${stripIds(baseMarkup)}</mask>`,
    );
    out.push(`<g mask="url(#${id})">${markup}</g>`);
  }

  return out.join('');
}

/**
 * The same markup with its `id` attributes removed.
 *
 * The base of a clipping group is written twice — once as itself, once inside
 * the `<mask>` — and two elements answering to one id is a document that
 * renders unpredictably and breaks every `href="#…"` pointing at it. The copy
 * inside the mask is the one that loses its identity, since nothing references
 * it. Applied only to markup this module generated a line earlier, which is why
 * a regular expression is safe here and would not be over arbitrary SVG:
 * `escapeXml` has already removed every quote that could end the attribute
 * early. Gradient references survive, because `<defs>` are collected separately
 * and keep their own ids.
 */
function stripIds(markup: string): string {
  return markup.replace(/ id="[^"]*"/g, '');
}

/**
 * Ids the export is going to contain, collected before anything is written.
 *
 * A `<textPath>` needs to know whether its target will be in the file, and the
 * target may be emitted *after* the text that references it — a caption below
 * its guide, in paint order. Deciding as we go would write an inline fallback
 * copy of a path that then appears again under the same id, which is a
 * duplicate-id document that renders unpredictably.
 */
function collectEmittedIds(node: DrawingNode, into: Set<string>): void {
  if (!node.visible || node.opacity <= 0) return;
  if (node.type === 'stack') {
    node.children.forEach((child) => collectEmittedIds(child, into));
    return;
  }
  if (node.type !== 'vector') return;
  for (const object of node.objects) {
    if (!object.visible) continue;
    // Mirrors `vectorObjectToSvg`, which emits nothing for a path too short to
    // draw — the one case where a visible object produces no element.
    if (object.kind === 'path' && object.points.length < 2) continue;
    into.add(object.id);
  }
}

export interface SvgExportOptions {
  /** Overrides the canvas background. `null` exports transparent. */
  background?: string | null;
}

export function documentToSvg(doc: DrawingDocument, options: SvgExportOptions = {}): string {
  let counter = 0;
  const visibleIds = new Set<string>();
  collectEmittedIds(doc.root, visibleIds);

  const emitter: Emitter = {
    defs: [],
    nextIndex: () => counter++,
    symbols: symbolTable(doc),
    emitted: new Set(),
    resolvePath: (pathId) => findPathObject(doc.root, pathId)?.object ?? null,
    visibleIds,
  };

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
