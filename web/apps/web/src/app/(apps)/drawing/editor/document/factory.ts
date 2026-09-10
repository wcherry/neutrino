/**
 * Constructors for documents and nodes.
 *
 * Everything that creates a node goes through here so that the fields redesign
 * §1 requires on *every* object — id, name, parent, visibility, opacity, blend
 * mode, lock, transform, bounds, timestamps — are filled in by construction
 * rather than by each caller remembering. A node built any other way is the one
 * that turns up missing a blend mode three phases later.
 */

import { newId } from './ids';
import { pathBounds } from './path';
import {
  DOCUMENT_VERSION,
  IDENTITY,
  type CanvasSettings,
  type DrawingDocument,
  type DrawingNode,
  type GridSettings,
  type InstanceNode,
  type LayerMask,
  type NodeBase,
  type PathObject,
  type PathPoint,
  type RasterLayerNode,
  type RasterSource,
  type Rect,
  type StackNode,
  type SymbolDefinition,
  type TextLayerNode,
  type VectorLayerNode,
  type VectorObject,
  type VectorObjectKind,
  type VectorStyle,
} from './types';

export const APPLICATION_NAME = 'Neutrino Drawing';
export const APPLICATION_VERSION = '2.0';

export const DEFAULT_CANVAS: CanvasSettings = {
  width: 1920,
  height: 1080,
  dpi: 96,
  background: '#ffffff',
};

export const DEFAULT_GRID: GridSettings = {
  visible: true,
  size: 16,
  origin: { x: 0, y: 0 },
  snap: true,
  subdivisions: 4,
};

export const DEFAULT_VECTOR_STYLE: VectorStyle = {
  fill: 'none',
  stroke: '#000000',
  strokeWidth: 2,
  strokeStyle: 'solid',
};

const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

function now(): string {
  return new Date().toISOString();
}

/** The fields every node shares, with the neutral value for each. */
function baseNode(name: string, overrides: Partial<NodeBase> = {}): NodeBase {
  const timestamp = now();
  return {
    id: newId(),
    name,
    parentId: null,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    transform: { ...IDENTITY },
    bounds: { ...EMPTY_RECT },
    createdAt: timestamp,
    modifiedAt: timestamp,
    ...overrides,
  };
}

export function createStack(name = 'Group', overrides: Partial<StackNode> = {}): StackNode {
  return {
    ...baseNode(name),
    type: 'stack',
    isolation: 'auto',
    children: [],
    ...overrides,
  };
}

export function createVectorLayer(name = 'Layer', overrides: Partial<VectorLayerNode> = {}): VectorLayerNode {
  return {
    ...baseNode(name),
    type: 'vector',
    objects: [],
    ...overrides,
  };
}

export function createRasterLayer(
  source: RasterSource,
  name = 'Image',
  overrides: Partial<RasterLayerNode> = {},
): RasterLayerNode {
  return {
    ...baseNode(name),
    type: 'raster',
    source,
    bounds: { x: source.x, y: source.y, width: source.width, height: source.height },
    ...overrides,
  };
}

/**
 * A 1×1 fully transparent PNG.
 *
 * This is what a freshly created paint layer holds. A layer's `RasterSource`
 * declares its own `width`/`height` and the renderer draws the bitmap stretched
 * to them, so a one-pixel transparent image covering a 1920×1080 layer is
 * indistinguishable from a 1920×1080 transparent image — and costs 70 bytes
 * instead of encoding eight megabytes of nothing every time someone adds a
 * layer. The first brush stroke replaces it with real pixels.
 */
export const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * An empty raster layer covering the whole canvas — somewhere for a brush to
 * paint.
 *
 * Canvas-sized rather than growing to fit the strokes: a paint layer is the
 * sheet you paint on, and one that resized itself as you worked would move its
 * own OpenRaster `x`/`y` offsets under every stroke already made.
 */
export function createPaintLayer(
  canvas: { width: number; height: number },
  name = 'Paint',
  overrides: Partial<RasterLayerNode> = {},
): RasterLayerNode {
  return createRasterLayer(
    {
      dataUrl: TRANSPARENT_PIXEL,
      width: Math.max(1, Math.round(canvas.width)),
      height: Math.max(1, Math.round(canvas.height)),
      x: 0,
      y: 0,
    },
    name,
    overrides,
  );
}

export function createTextLayer(
  box: Rect,
  text = '',
  overrides: Partial<TextLayerNode> = {},
): TextLayerNode {
  return {
    ...baseNode(text.trim().slice(0, 24) || 'Text'),
    type: 'text',
    text,
    fontFamily: 'sans-serif',
    fontSize: 24,
    fontWeight: 400,
    italic: false,
    align: 'left',
    lineHeight: 1.2,
    color: '#000000',
    box,
    bounds: { ...box },
    ...overrides,
  };
}

/**
 * A mask over a node.
 *
 * `source` is null for a clipping mask, whose shape comes from the layer below
 * rather than from a channel of its own — the one kind with nothing to store.
 */
export function createMask(kind: LayerMask['kind'], source: RasterSource | null = null): LayerMask {
  return { id: newId(), kind, source, enabled: true, inverted: false };
}

// ---------------------------------------------------------------------------
// Vector objects
// ---------------------------------------------------------------------------

const OBJECT_LABELS: Record<VectorObjectKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  path: 'Path',
};

function baseObject(kind: VectorObjectKind, frame: Rect, style?: Partial<VectorStyle>) {
  return {
    id: newId(),
    name: OBJECT_LABELS[kind],
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    frame,
    style: { ...DEFAULT_VECTOR_STYLE, ...style },
  };
}

export function createRect(frame: Rect, style?: Partial<VectorStyle>): VectorObject {
  return { ...baseObject('rect', frame, style), kind: 'rect', cornerRadius: 0 };
}

export function createEllipse(frame: Rect, style?: Partial<VectorStyle>): VectorObject {
  return { ...baseObject('ellipse', frame, style), kind: 'ellipse' };
}

export function createLine(
  frame: Rect,
  opts: { arrowStart?: boolean; arrowEnd?: boolean } = {},
  style?: Partial<VectorStyle>,
): VectorObject {
  return {
    ...baseObject('line', frame, style),
    kind: 'line',
    arrowStart: opts.arrowStart ?? false,
    arrowEnd: opts.arrowEnd ?? false,
  };
}

export function createPath(
  points: PathPoint[],
  style?: Partial<VectorStyle>,
  overrides: Partial<Omit<PathObject, 'kind' | 'points'>> = {},
): PathObject {
  const draft: PathObject = {
    ...baseObject('path', { ...EMPTY_RECT }, style),
    kind: 'path',
    points,
    closed: false,
    ...overrides,
  };
  // The frame is derived rather than passed in, because a path's extent comes
  // from its curve — `pathBounds` flattens it — and a caller computing that by
  // hand from the anchors would clip every curve that bulges past them.
  return { ...draft, frame: pathBounds(draft) };
}

// ---------------------------------------------------------------------------
// Symbols and instances
// ---------------------------------------------------------------------------

/**
 * A reusable definition made from an existing node.
 *
 * The content's own transform is reset: an instance's transform is what places
 * it, and a symbol that kept the position of the node it was made from would
 * offset every instance by that amount on top of its own.
 */
export function createSymbol(content: DrawingNode, name?: string): SymbolDefinition {
  return {
    id: newId(),
    name: name ?? content.name ?? 'Symbol',
    content: { ...content, parentId: null, transform: { ...IDENTITY } },
    createdAt: now(),
  };
}

export function createInstance(
  symbol: SymbolDefinition,
  overrides: Partial<InstanceNode> = {},
): InstanceNode {
  return {
    ...baseNode(symbol.name),
    type: 'instance',
    symbolId: symbol.id,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * A new drawing: one empty vector layer inside the root stack.
 *
 * One layer and not none, because every drawing tool needs somewhere to put
 * what it draws and a first-run empty-tree state would be a special case in
 * every one of them.
 */
export function createDocument(opts: { title?: string; canvas?: Partial<CanvasSettings> } = {}): DrawingDocument {
  const timestamp = now();
  const root = createStack('Root');
  const layer = createVectorLayer('Layer 1', { parentId: root.id });
  root.children = [layer];

  return {
    version: DOCUMENT_VERSION,
    canvas: { ...DEFAULT_CANVAS, ...opts.canvas },
    root,
    guides: [],
    grid: { ...DEFAULT_GRID, origin: { ...DEFAULT_GRID.origin } },
    colorProfile: { name: 'sRGB' },
    metadata: {
      title: opts.title ?? 'Untitled drawing',
      createdAt: timestamp,
      modifiedAt: timestamp,
      application: { name: APPLICATION_NAME, version: APPLICATION_VERSION },
    },
  };
}
