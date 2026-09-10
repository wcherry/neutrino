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
import {
  DOCUMENT_VERSION,
  IDENTITY,
  type CanvasSettings,
  type DrawingDocument,
  type GridSettings,
  type LayerMask,
  type NodeBase,
  type PathObject,
  type Point,
  type RasterLayerNode,
  type RasterSource,
  type Rect,
  type StackNode,
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

export function createPath(points: Point[], style?: Partial<VectorStyle>): PathObject {
  const frame = pointsBounds(points);
  return { ...baseObject('path', frame, style), kind: 'path', points, closed: false };
}

/** The axis-aligned extent of a point list, never zero-sized. */
export function pointsBounds(points: Point[]): Rect {
  if (points.length === 0) return { ...EMPTY_RECT };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
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
