/**
 * Editor-only types, plus a re-export of the document model.
 *
 * The split is the point: everything in `document/` describes what a drawing
 * *is* and gets saved; everything declared here describes what the editor is
 * currently *doing* and does not — which tool is armed, what is selected, where
 * the viewport sits. The old `types.ts` mixed the two, so `Shape` carried both
 * geometry and a `locked` flag the canvas used for hit testing, and there was
 * no line to reason along.
 */

export type {
  BlendMode,
  CanvasSettings,
  ColorProfile,
  DocumentMetadata,
  DrawingDocument,
  DrawingNode,
  EllipseObject,
  Guide,
  GridSettings,
  InstanceNode,
  LayerMask,
  LineObject,
  NodeBase,
  NodeType,
  PathObject,
  PathPoint,
  Point,
  RasterLayerNode,
  RasterSource,
  Rect,
  RectObject,
  SelectionShape,
  StackNode,
  StrokeStyle,
  SubPath,
  SymbolDefinition,
  TextLayerNode,
  TextPathBinding,
  Transform2D,
  VectorLayerNode,
  VectorObject,
  VectorObjectKind,
  VectorStyle,
  ViewportState,
} from './document/types';

export { BLEND_MODES, BLEND_MODE_LABELS, isRaster, isStack, pathContours } from './document/types';

/**
 * The armed tool.
 *
 * Four families, and the distinction between the first two is the one that
 * matters: **vector tools produce objects** inside a vector layer, while
 * **paint tools produce pixels** in a raster layer. They are not two styles of
 * the same thing — `pen` draws an editable path you can reshape a week later,
 * `brush` lays down pixels that are pixels. Which is armed decides what kind of
 * layer a stroke needs, and a paint tool with no raster layer to paint into
 * creates one rather than failing silently.
 *
 * `node` is direct selection: it edits a path's own anchors and handles rather
 * than moving the object as a whole, which is what makes an imported SVG
 * genuinely editable instead of merely visible.
 *
 * Adding an image is not a tool at all — it is a one-shot action that opens the
 * picker and inserts a raster layer, so it has nothing to stay armed for.
 */
export type ToolType =
  // Selection and manipulation
  | 'select'
  | 'node'
  | 'transform'
  // Vector
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'eraser'
  // Paint
  | 'brush'
  | 'pencil'
  | 'marker'
  | 'airbrush'
  | 'paint-eraser'
  // Pixel selection
  | 'select-rect'
  | 'select-ellipse'
  | 'lasso';

/** Tools that lay down pixels rather than creating objects. */
export const PAINT_TOOLS = ['brush', 'pencil', 'marker', 'airbrush', 'paint-eraser'] as const;

export type PaintTool = (typeof PAINT_TOOLS)[number];

export function isPaintTool(tool: ToolType): tool is PaintTool {
  return (PAINT_TOOLS as readonly string[]).includes(tool);
}

/** Tools that define a pixel selection rather than editing content. */
export const SELECTION_TOOLS = ['select-rect', 'select-ellipse', 'lasso'] as const;

export type SelectionTool = (typeof SELECTION_TOOLS)[number];

export function isSelectionTool(tool: ToolType): tool is SelectionTool {
  return (SELECTION_TOOLS as readonly string[]).includes(tool);
}

/** The brush preset a paint tool arms. `paint-eraser` is the one that removes. */
export const PAINT_TOOL_BRUSH: Record<PaintTool, import('./paint').BrushType> = {
  brush: 'brush',
  pencil: 'pencil',
  marker: 'marker',
  airbrush: 'airbrush',
  'paint-eraser': 'eraser',
};

/** The viewport: where the canvas sits on screen and how far it is zoomed. */
export interface Transform {
  x: number;
  y: number;
  scale: number;
}

/**
 * What is selected.
 *
 * Two kinds, because there are two things a click can land on. Objects inside a
 * vector layer are selected individually and always within one layer — a
 * cross-layer object selection would have no single place to draw into and no
 * meaningful z-order. Everything else (a raster layer, a text layer, a group)
 * is selected as a *node*, which is what the layers panel selects too.
 */
export type Selection =
  | { kind: 'objects'; layerId: string; ids: string[] }
  | { kind: 'nodes'; ids: string[] }
  | null;

export function selectedNodeIds(selection: Selection): string[] {
  return selection?.kind === 'nodes' ? selection.ids : [];
}

export function selectedObjectIds(selection: Selection): string[] {
  return selection?.kind === 'objects' ? selection.ids : [];
}

export function selectionCount(selection: Selection): number {
  return selection ? selection.ids.length : 0;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}
