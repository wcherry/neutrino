/**
 * Reading an SVG into the drawing model — redesign phase 5.
 *
 * The mapping is the one the redesign asks for: shapes stay shapes, text stays
 * text, groups stay groups, ids and transforms survive, and `<use>` against a
 * `<symbol>` comes in as a **symbol plus instances** rather than as copies —
 * which is the same "stored once, referenced by UUID" the model already has for
 * reusable objects, so the round trip out through `documentSvg` produces the
 * same structure it read.
 *
 * Two mapping decisions are worth stating, because both are places where
 * something has to give:
 *
 * **A shape's own `transform` is absorbed where it can be and worn where it
 * cannot.** A `VectorObject` carries a frame and a rotation, not a matrix. A
 * translate or an axis-aligned scale is folded straight into the geometry, so
 * the rectangle stays an editable rectangle. Anything with rotation or shear in
 * it puts the object alone in a vector layer whose *node* carries the matrix —
 * the object stays exactly where the file says, and stays editable, at the cost
 * of a layer per such shape. Flattening the matrix into the geometry instead
 * would turn every rotated rectangle into a four-point path.
 *
 * **A group becomes a stack, and loose shapes inside it become one vector
 * layer.** SVG lets shapes and groups interleave freely; the model has objects
 * *inside* layers. So a run of consecutive shape siblings is gathered into one
 * layer, and the run is broken whenever a group, a text element or an image
 * appears between them — which preserves paint order exactly, at the cost of
 * occasionally producing two layers where a person would have drawn one.
 *
 * Nothing is fetched. An `<image>` with an external `href` is kept as a node
 * only when the href is a `data:` URL; a document is not a place from which to
 * go and get things, and a layer pointing at somebody's server would break the
 * moment the drawing was shared.
 */

import { newId } from '../../document/ids';
import { multiplyTransform } from '../../document/geometry';
import { normalizeTree, refreshBounds, symbolTable } from '../../document/tree';
import {
  createDocument,
  createEllipse,
  createInstance,
  createLine,
  createPath,
  createRasterLayer,
  createRect,
  createStack,
  createTextLayer,
  createVectorLayer,
} from '../../document/factory';
import { parsePathData } from './pathData';
import { isAxisAligned, isTranslationOnly, parseTransform } from './transform';
import {
  IDENTITY,
  type BlendMode,
  type DrawingDocument,
  type DrawingNode,
  type PathObject,
  type Point,
  type RasterSource,
  type StackNode,
  type SubPath,
  type SymbolDefinition,
  type TextLayerNode,
  type Transform2D,
  type VectorObject,
  type VectorStyle,
} from '../../document/types';

export class SvgReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgReadError';
  }
}

export interface SvgReadResult {
  document: DrawingDocument;
  /** Elements recognised but not representable, for the import dialog to report. */
  skipped: string[];
}

/** A canvas size for an SVG that declares none — neither width/height nor viewBox. */
const FALLBACK_CANVAS = { width: 1024, height: 768 };

// ---------------------------------------------------------------------------
// Attribute reading
// ---------------------------------------------------------------------------

function num(element: Element, name: string, fallback: number): number {
  const raw = element.getAttribute(name);
  if (raw === null) return fallback;
  // Units are stripped rather than converted: everything but a percentage is a
  // length in user units for our purposes, and a percentage of an unknown
  // viewport is not resolvable without laying the document out.
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * A presentation attribute, taking `style="…"` over the attribute of the same
 * name.
 *
 * That order is CSS's: a declaration in a `style` attribute beats a
 * presentation attribute. Getting it backwards means a shape that looks one
 * colour in a browser and another here, which is the sort of difference nobody
 * thinks to check.
 */
function styleValue(element: Element, name: string): string | null {
  const style = element.getAttribute('style');
  if (style) {
    const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(style);
    if (match) return match[1].trim();
  }
  return element.getAttribute(name);
}

/**
 * Style, resolved against the values inherited from enclosing groups.
 *
 * SVG paint properties inherit, and a `<g fill="red">` around an unpainted
 * `<path>` is how a great many files are written — reading only the element's
 * own attributes turns all of them black.
 */
interface InheritedStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDash: string | null;
  opacity: number;
}

const ROOT_STYLE: InheritedStyle = {
  // SVG's initial values: filled black, unstroked.
  fill: '#000000',
  stroke: 'none',
  strokeWidth: 1,
  strokeDash: null,
  opacity: 1,
};

function inheritStyle(element: Element, parent: InheritedStyle): InheritedStyle {
  const fill = styleValue(element, 'fill');
  const stroke = styleValue(element, 'stroke');
  const width = styleValue(element, 'stroke-width');
  const dash = styleValue(element, 'stroke-dasharray');
  const opacity = styleValue(element, 'opacity');

  return {
    // `inherit` is explicit in enough generated SVG to be worth honouring
    // rather than storing as the literal string, which would paint nothing.
    fill: fill && fill !== 'inherit' ? fill : parent.fill,
    stroke: stroke && stroke !== 'inherit' ? stroke : parent.stroke,
    strokeWidth: width !== null ? (Number.parseFloat(width) || 0) : parent.strokeWidth,
    strokeDash: dash && dash !== 'none' ? dash : parent.strokeDash,
    opacity: opacity !== null ? clamp01(Number.parseFloat(opacity)) : parent.opacity,
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/**
 * Paint, as the model stores it.
 *
 * `url(#…)` references — a gradient or a pattern in `<defs>` — are the one
 * thing not resolved. The model's fill *is* a CSS string and can hold a
 * gradient, but only as `linear-gradient(…)`, and translating an SVG gradient's
 * units, spread method and transform into the CSS equivalent is a conversion
 * with several ways to be subtly wrong. A referenced fill is reported as
 * skipped and the shape comes in unfilled, which is visible rather than
 * plausible-and-wrong.
 */
function toVectorStyle(style: InheritedStyle, skipped: Set<string>): VectorStyle {
  const usesReference = /^url\(/i.test(style.fill);
  if (usesReference) skipped.add('gradient or pattern fill');

  return {
    fill: usesReference || style.fill === 'none' ? 'none' : style.fill,
    stroke: style.stroke === 'none' ? 'none' : style.stroke,
    strokeWidth: Math.max(0, style.strokeWidth),
    strokeStyle: style.strokeDash ? 'dashed' : 'solid',
  };
}

/** SVG's `mix-blend-mode` is spelled exactly as the model's blend modes are. */
function blendModeOf(element: Element): BlendMode | null {
  const value = styleValue(element, 'mix-blend-mode');
  if (!value) return null;
  const known = value.trim().toLowerCase();
  return known === 'normal' ? 'normal' : (known as BlendMode);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * One shape element, with its own transform applied.
 *
 * Returns null for an element that is not a shape, and for a shape whose
 * transform cannot be absorbed — the caller handles that case by giving the
 * object a layer of its own.
 */
function toShape(
  element: Element,
  style: VectorStyle,
  opacity: number,
  transform: Transform2D,
): VectorObject | null {
  const absorb = (point: Point): Point => ({
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  });
  const scaleX = transform.a;
  const scaleY = transform.d;

  const finish = (object: VectorObject): VectorObject => ({
    ...object,
    id: element.getAttribute('id') || object.id,
    opacity,
    // A scaled shape's stroke scales with it. Using the average of the two axes
    // is what every renderer does for a non-uniform scale, since a stroke has
    // one width and the transform gave it two.
    style: { ...object.style, strokeWidth: object.style.strokeWidth * (Math.abs(scaleX) + Math.abs(scaleY)) / 2 },
  });

  switch (element.localName) {
    case 'rect': {
      const origin = absorb({ x: num(element, 'x', 0), y: num(element, 'y', 0) });
      const width = num(element, 'width', 0) * scaleX;
      const height = num(element, 'height', 0) * scaleY;
      if (width === 0 || height === 0) return null;
      const rect = createRect({ x: origin.x, y: origin.y, width, height }, style);
      // SVG's `rx`/`ry` can differ; the model has one radius, so the smaller
      // wins — a corner cannot be rounder than its tighter axis allows.
      const rx = num(element, 'rx', num(element, 'ry', 0)) * Math.abs(scaleX);
      const ry = num(element, 'ry', num(element, 'rx', 0)) * Math.abs(scaleY);
      return finish(rect.kind === 'rect' ? { ...rect, cornerRadius: Math.min(rx, ry) } : rect);
    }

    case 'circle': {
      const r = num(element, 'r', 0);
      if (r === 0) return null;
      const centre = absorb({ x: num(element, 'cx', 0), y: num(element, 'cy', 0) });
      const rx = r * Math.abs(scaleX);
      const ry = r * Math.abs(scaleY);
      return finish(createEllipse({ x: centre.x - rx, y: centre.y - ry, width: rx * 2, height: ry * 2 }, style));
    }

    case 'ellipse': {
      const rx = num(element, 'rx', 0) * Math.abs(scaleX);
      const ry = num(element, 'ry', 0) * Math.abs(scaleY);
      if (rx === 0 || ry === 0) return null;
      const centre = absorb({ x: num(element, 'cx', 0), y: num(element, 'cy', 0) });
      return finish(createEllipse({ x: centre.x - rx, y: centre.y - ry, width: rx * 2, height: ry * 2 }, style));
    }

    case 'line': {
      const from = absorb({ x: num(element, 'x1', 0), y: num(element, 'y1', 0) });
      const to = absorb({ x: num(element, 'x2', 0), y: num(element, 'y2', 0) });
      return finish(createLine(
        { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y },
        {},
        style,
      ));
    }

    case 'polyline':
    case 'polygon': {
      const points = parsePoints(element.getAttribute('points') ?? '').map(absorb);
      if (points.length < 2) return null;
      return finish(createPath(points, style, { closed: element.localName === 'polygon' }));
    }

    case 'path': {
      const contours = parsePathData(element.getAttribute('d') ?? '');
      if (contours.length === 0) return null;
      const moved = contours.map((contour) => mapContour(contour, absorb));
      const object = createPath(moved[0].points, style, {
        closed: moved[0].closed,
        ...(moved.length > 1 ? { subpaths: moved.slice(1) } : {}),
        ...(styleValue(element, 'fill-rule') === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
      });
      return finish(object);
    }

    default:
      return null;
  }
}

function mapContour(contour: SubPath, map: (p: Point) => Point): SubPath {
  return {
    closed: contour.closed,
    points: contour.points.map((p) => {
      const moved = map(p);
      const next: typeof p = { x: moved.x, y: moved.y };
      if (p.in) next.in = map(p.in);
      if (p.out) next.out = map(p.out);
      return next;
    }),
  };
}

function parsePoints(raw: string): Point[] {
  const values = raw
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value));
  const points: Point[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
  return points;
}

const SHAPE_ELEMENTS = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * A `<text>` element as a text layer.
 *
 * A `<textPath>` child becomes a binding to the path it references — which is
 * the whole point of the reference surviving the round trip: the path is
 * already an object in the document, so the caption re-flows when it is
 * reshaped, exactly as it did in the file.
 */
function toTextLayer(
  element: Element,
  style: InheritedStyle,
  transform: Transform2D,
  bindings: PendingBinding[],
): TextLayerNode | null {
  const content = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!content) return null;

  const fontSize = Number.parseFloat(styleValue(element, 'font-size') ?? '') || 16;
  const anchor = styleValue(element, 'text-anchor') ?? 'start';
  const x = num(element, 'x', 0);
  const y = num(element, 'y', 0);

  const layer = createTextLayer(
    // `y` is a *baseline* in SVG and the top of the box in the model, so the
    // box starts one font size higher. Without this every imported caption sits
    // a line too low.
    { x, y: y - fontSize, width: Math.max(fontSize * content.length * 0.6, fontSize), height: fontSize * 1.4 },
    content,
    {
      id: element.getAttribute('id') || undefined,
      fontFamily: styleValue(element, 'font-family') ?? 'sans-serif',
      fontSize,
      fontWeight: Number.parseFloat(styleValue(element, 'font-weight') ?? '') || 400,
      italic: styleValue(element, 'font-style') === 'italic',
      align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
      color: style.fill === 'none' ? '#000000' : style.fill,
      opacity: style.opacity,
      transform,
    },
  );

  const textPath = Array.from(element.children).find((child) => child.localName === 'textPath');
  if (textPath) {
    const href = textPath.getAttribute('href') ?? textPath.getAttribute('xlink:href') ?? '';
    const target = href.startsWith('#') ? href.slice(1) : '';
    if (target) {
      // Recorded rather than bound: the path may be defined later in the
      // document, and an id that resolves to nothing must not become a binding
      // the renderer then has to guard against on every frame.
      bindings.push({
        layerId: layer.id,
        pathId: target,
        startOffset: parsePercent(textPath.getAttribute('startOffset')),
        align: anchor === 'middle' ? 'middle' : anchor === 'end' ? 'end' : 'start',
        baselineOffset: -num(textPath, 'dy', 0),
        side: textPath.getAttribute('side') === 'right' ? 'right' : 'left',
      });
    }
  }

  return layer;
}

interface PendingBinding {
  layerId: string;
  pathId: string;
  startOffset: number;
  align: 'start' | 'middle' | 'end';
  baselineOffset: number;
  side: 'left' | 'right';
}

function parsePercent(raw: string | null): number {
  if (!raw) return 0;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  // A bare number is a length along the path, which we cannot resolve to a
  // percentage without measuring — and measuring needs the path, which may not
  // exist yet. Zero is the honest answer and matches the default.
  return raw.trim().endsWith('%') ? Math.min(100, Math.max(0, value)) : 0;
}

// ---------------------------------------------------------------------------
// Walking the tree
// ---------------------------------------------------------------------------

interface WalkContext {
  style: InheritedStyle;
  skipped: Set<string>;
  bindings: PendingBinding[];
  /** `<symbol>` and `<g>` elements in `<defs>`, by id, for `<use>` to resolve. */
  definitions: Map<string, Element>;
  /** Symbols already materialised, so a repeated `<use>` shares one definition. */
  symbols: Map<string, SymbolDefinition>;
  /** Guards a `<use>` chain that refers back to something already being built. */
  building: Set<string>;
}

/**
 * The children of one container element as document nodes.
 *
 * Consecutive shapes are gathered into a single vector layer, because objects
 * live in layers in this model and one layer per shape would produce an
 * unreadable panel for a file of any size.
 */
function walkChildren(parent: Element, context: WalkContext): DrawingNode[] {
  const out: DrawingNode[] = [];
  let pending: VectorObject[] = [];

  const flush = (): void => {
    if (pending.length === 0) return;
    const layer = createVectorLayer('Shapes');
    // Reversed because `objects[0]` is topmost in the model and SVG paints in
    // document order — the last element drawn is the one on top.
    out.push({ ...layer, objects: [...pending].reverse() });
    pending = [];
  };

  for (const child of Array.from(parent.children)) {
    const name = child.localName;

    if (name === 'defs') {
      collectDefinitions(child, context);
      continue;
    }
    // Metadata, titles and scripts carry nothing to draw. `<style>` is listed
    // here because a stylesheet is not applied — see the module note on
    // presentation attributes — and reporting it is more use than ignoring it.
    if (name === 'title' || name === 'desc' || name === 'metadata' || name === 'script') continue;
    if (name === 'style') {
      context.skipped.add('CSS stylesheet');
      continue;
    }
    // A `<symbol>` is a definition, never drawn where it sits. Every definition
    // in the file was already indexed by the up-front `collectDefinitions`, so
    // there is nothing to do here but skip it.
    if (name === 'symbol') continue;

    const style = inheritStyle(child, context.style);
    const transform = parseTransform(child.getAttribute('transform'));

    if (SHAPE_ELEMENTS.has(name)) {
      const object = toShape(child, toVectorStyle(style, context.skipped), style.opacity, absorbable(transform) ? transform : { ...IDENTITY });
      if (!object) continue;
      if (absorbable(transform)) {
        pending.push(object);
        continue;
      }
      // A rotated or sheared shape wears its matrix on a layer of its own, so
      // the geometry stays editable instead of being frozen into a polygon.
      flush();
      const layer = createVectorLayer(child.getAttribute('id') || 'Shape', { transform });
      out.push({ ...layer, objects: [object] });
      continue;
    }

    if (name === 'g' || name === 'a') {
      flush();
      const children = walkChildren(child, { ...context, style });
      if (children.length === 0) continue;
      const group = createStack(child.getAttribute('id') || 'Group', {
        transform,
        opacity: style.opacity,
        ...(blendModeOf(child) ? { blendMode: blendModeOf(child)! } : {}),
      });
      // `walkChildren` already returns model order — topmost first — so the
      // list is used as it comes. Reversing here as well put every group's
      // contents back into document order, i.e. upside down.
      out.push({ ...group, children });
      continue;
    }

    if (name === 'text') {
      flush();
      const layer = toTextLayer(child, style, transform, context.bindings);
      if (layer) out.push(layer);
      continue;
    }

    if (name === 'image') {
      flush();
      const layer = toImageLayer(child, transform, context.skipped);
      if (layer) out.push(layer);
      continue;
    }

    if (name === 'use') {
      flush();
      const instance = toInstance(child, transform, style, context);
      if (instance) out.push(instance);
      continue;
    }

    context.skipped.add(`<${name}>`);
  }

  flush();
  // The whole list is reversed once at the end for the same reason the objects
  // are: document order paints bottom-up, `children[0]` is the top.
  return out.reverse();
}

/** Whether a matrix can be folded into a shape's own frame without loss. */
function absorbable(t: Transform2D): boolean {
  return isTranslationOnly(t) || isAxisAligned(t);
}

function collectDefinitions(container: Element, context: WalkContext): void {
  for (const child of Array.from(container.children)) {
    const id = child.getAttribute('id');
    if (id) context.definitions.set(id, child);
    // Definitions nest: a `<symbol>` inside `<defs>` can contain a `<g>` that
    // something else references directly.
    if (child.children.length > 0) collectDefinitions(child, context);
  }
}

function toImageLayer(element: Element, transform: Transform2D, skipped: Set<string>) {
  const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
  if (!href.startsWith('data:image/')) {
    // An external reference is not followed — see the module note. Reporting it
    // is what lets the import dialog say the picture is missing rather than
    // leaving someone to notice a hole in the drawing.
    skipped.add('externally linked <image>');
    return null;
  }
  const width = num(element, 'width', 0);
  const height = num(element, 'height', 0);
  if (width <= 0 || height <= 0) return null;

  const source: RasterSource = {
    dataUrl: href,
    width: Math.round(width),
    height: Math.round(height),
    x: Math.round(num(element, 'x', 0)),
    y: Math.round(num(element, 'y', 0)),
  };
  return createRasterLayer(source, element.getAttribute('id') || 'Image', { transform });
}

/**
 * A `<use>` as an instance of a symbol.
 *
 * The referenced element is materialised once, as a `SymbolDefinition`, and
 * every `<use>` of it becomes an `InstanceNode` — so a file with two hundred
 * repeats of an icon imports as two hundred references to one definition rather
 * than two hundred copies, and exports back out the same way.
 *
 * `<use>`'s own `x`/`y` are a translation on top of its `transform`, per the
 * specification, which is why they are composed rather than assigned.
 */
function toInstance(element: Element, transform: Transform2D, style: InheritedStyle, context: WalkContext): DrawingNode | null {
  const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
  if (!href.startsWith('#')) return null;
  const targetId = href.slice(1);
  const target = context.definitions.get(targetId);
  if (!target) {
    context.skipped.add('<use> with no matching definition');
    return null;
  }
  if (context.building.has(targetId)) {
    // A definition that uses itself. Refusing the inner reference leaves the
    // outer one intact and terminates, where following it would recurse until
    // the stack ran out.
    context.skipped.add('self-referencing <use>');
    return null;
  }

  let symbol = context.symbols.get(targetId);
  if (!symbol) {
    context.building.add(targetId);
    const children = walkChildren(target, { ...context, style: inheritStyle(target, context.style) });
    context.building.delete(targetId);
    if (children.length === 0) return null;

    const content: DrawingNode = children.length === 1
      ? children[0]
      : { ...createStack(target.getAttribute('id') || 'Symbol'), children };
    symbol = {
      id: newId(),
      name: targetId,
      content: { ...content, parentId: null, transform: { ...IDENTITY } },
      createdAt: new Date().toISOString(),
    };
    context.symbols.set(targetId, symbol);
  }

  const offset: Transform2D = { ...IDENTITY, e: num(element, 'x', 0), f: num(element, 'y', 0) };
  return createInstance(symbol, {
    id: element.getAttribute('id') || undefined,
    transform: multiplyTransform(transform, offset),
    opacity: style.opacity,
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * An SVG document as a drawing.
 *
 * Throws `SvgReadError` for markup that is not an SVG at all; anything else it
 * cannot represent is reported in `skipped` and the rest of the file still
 * comes in. That asymmetry is deliberate — an SVG is usually somebody's whole
 * artwork, and losing a gradient is a far better outcome than losing the
 * drawing.
 */
export function readSvg(markup: string, options: { title?: string } = {}): SvgReadResult {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  } catch {
    throw new SvgReadError('That file could not be parsed as SVG.');
  }
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    throw new SvgReadError('That SVG file is malformed.');
  }

  const svg = parsed.documentElement;
  if (!svg || svg.localName !== 'svg') {
    throw new SvgReadError('That file is not an SVG.');
  }

  const canvas = canvasFromSvg(svg);
  const context: WalkContext = {
    style: ROOT_STYLE,
    skipped: new Set(),
    bindings: [],
    definitions: new Map(),
    symbols: new Map(),
    building: new Set(),
  };
  // Definitions are gathered up front so a `<use>` can resolve a `<symbol>`
  // declared after it, which is legal and common in exported files.
  collectDefinitions(svg, context);

  const children = walkChildren(svg, context);
  const base = createDocument({
    title: options.title ?? svg.querySelector('title')?.textContent?.trim() ?? 'Imported drawing',
    canvas,
  });

  const symbols = [...context.symbols.values()];
  let root: StackNode = children.length > 0 ? { ...base.root, children } : base.root;
  root = applyBindings(root, context.bindings);

  const document_: DrawingDocument = {
    ...base,
    ...(symbols.length ? { symbols } : {}),
    root,
  };

  return {
    document: {
      ...document_,
      root: refreshBounds(normalizeTree(document_.root), symbolTable(document_)),
    },
    skipped: [...context.skipped],
  };
}

/**
 * Binds every `<textPath>` whose target actually made it into the document.
 *
 * Done in a second pass because a caption can reference a path defined further
 * down the file. A binding whose target is absent is dropped rather than
 * stored — the layer then lays out in its box, which is visible and editable.
 */
function applyBindings(root: StackNode, bindings: readonly PendingBinding[]): StackNode {
  if (bindings.length === 0) return root;

  const paths = new Map<string, PathObject>();
  const collect = (node: DrawingNode): void => {
    if (node.type === 'vector') {
      for (const object of node.objects) {
        if (object.kind === 'path') paths.set(object.id, object);
      }
    }
    if (node.type === 'stack') node.children.forEach(collect);
  };
  collect(root);

  const rewrite = (node: DrawingNode): DrawingNode => {
    if (node.type === 'stack') return { ...node, children: node.children.map(rewrite) };
    if (node.type !== 'text') return node;
    const binding = bindings.find((b) => b.layerId === node.id);
    if (!binding || !paths.has(binding.pathId)) return node;
    return {
      ...node,
      textPath: {
        pathId: binding.pathId,
        startOffset: binding.startOffset,
        align: binding.align,
        baselineOffset: binding.baselineOffset,
        side: binding.side,
      },
    };
  };

  return { ...root, children: root.children.map(rewrite) };
}

/**
 * The canvas an SVG describes.
 *
 * `width`/`height` win when both are present, because they are what the file
 * says it *is*; the viewBox is the coordinate system it is drawn in, and the
 * two agree in most files. When only a viewBox exists its size is used, and
 * when neither does there is nothing to go on and a default is picked — an SVG
 * with no dimensions at all is sized by whatever embeds it.
 */
function canvasFromSvg(svg: Element): { width: number; height: number } {
  const width = num(svg, 'width', 0);
  const height = num(svg, 'height', 0);
  if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };

  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value));
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: Math.round(viewBox[2]), height: Math.round(viewBox[3]) };
  }
  return { ...FALLBACK_CANVAS };
}
