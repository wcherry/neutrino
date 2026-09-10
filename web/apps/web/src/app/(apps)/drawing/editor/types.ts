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
  LayerMask,
  LineObject,
  NodeBase,
  NodeType,
  PathObject,
  Point,
  RasterLayerNode,
  RasterSource,
  Rect,
  RectObject,
  StackNode,
  StrokeStyle,
  TextLayerNode,
  Transform2D,
  VectorLayerNode,
  VectorObject,
  VectorObjectKind,
  VectorStyle,
  ViewportState,
} from './document/types';

export { BLEND_MODES, BLEND_MODE_LABELS, isStack } from './document/types';

/**
 * The armed tool.
 *
 * `pen` draws a freehand vector path, not pixels: there is no brush engine yet,
 * and painting into a raster layer is redesign phase 4. Adding an image is not
 * a tool at all — it is a one-shot action that opens the picker and inserts a
 * raster layer, so it has nothing to stay armed for.
 */
export type ToolType =
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'eraser';

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
