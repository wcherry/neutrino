'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {
  findNode,
  flattenTree,
  isEffectivelyLocked,
  isEffectivelyVisible,
  nodeCanvasBounds,
  symbolTable,
} from './document/tree';
import {
  addNode,
  addObjects,
  deleteNode,
  mapObjects,
  patchTextLayer,
  removeObjects,
  resizeObject,
  setMaskSource,
  setNodeProps,
  setRasterSource,
  setSelection,
  transformNode,
  translateNode,
  translateObject,
} from './document/edits';
import {
  createEllipse,
  createLine,
  createPath,
  createRect,
  createTextLayer,
} from './document/factory';
import {
  // Aliased: the component has its own `applyTransform`, which sets the
  // viewport rather than mapping a point through a matrix, and the two would
  // shadow each other inside it.
  applyTransform as mapPoint,
  invertTransform,
  multiplyTransform,
  normalizeRect,
  rectCenter,
  rectsIntersect,
  rotateAbout,
  scaleAbout,
  unionRects,
  unrotatePoint,
} from './document/geometry';
import { pathContours } from './document/types';
import { traceSelection } from './document/selection';
import { addGuide, moveGuide, removeGuide } from './document/edits';
import {
  rulerTicks,
  snapCandidates,
  snapValue,
  toUnits,
  workspaceOf,
  type WorkspaceState,
} from './document/workspace';
import { drawVectorObject, hitTestObject, objectSelectionBox } from './render/vectorObject';
import { documentToSvg } from './render/documentSvg';
import { domSurfaceFactory, renderDocument, type Surface } from './render/renderDocument';
import { PaintSession, strokePoint, type BrushSettings } from './paint';
import {
  isPaintTool,
  isSelectionTool,
  type DrawingDocument,
  type DrawingNode,
  type PathObject,
  type PathPoint,
  type Point,
  type Rect,
  type ResizeHandle,
  type Selection,
  type SelectionShape,
  type ToolType,
  type Transform,
  type VectorObject,
  type VectorStyle,
} from './types';

export interface DrawingCanvasHandle {
  setTransform: (t: Transform) => void;
  fitToScreen: () => void;
  exportPNG: (options?: { scale?: number; background?: string | null }) => Promise<Blob>;
  exportSVG: (options?: { background?: string | null }) => string;
}

interface DrawingCanvasProps {
  doc: DrawingDocument;
  onDocumentChange: (next: DrawingDocument) => void;
  tool: ToolType;
  onToolChange: (tool: ToolType) => void;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  activeLayerId: string;
  newObjectStyle: VectorStyle;
  onTransformChange?: (t: Transform) => void;
  bitmaps: ReadonlyMap<string, CanvasImageSource>;
  images?: ReadonlyMap<string, CanvasImageSource>;
  /** The armed brush. Only read while a paint tool is active. */
  brush: BrushSettings;
  /**
   * Paint into the active layer's mask channel rather than its pixels.
   *
   * A mode rather than a separate tool, because every brush works on a mask and
   * duplicating the five of them would double the toolbar to say so.
   */
  maskEditing?: boolean;
  /**
   * Where the viewport was when the drawing was last saved.
   *
   * Applied on first mount instead of fitting to the screen, so reopening a
   * drawing lands where it was left rather than zoomed out to the whole page —
   * which for a detail on a large canvas means finding it again every time.
   * Absent for a drawing that predates the workspace block, which still fits.
   */
  initialTransform?: Transform;
}

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 22;
const SELECTION_COLOR = '#2563eb';
/** Anchors and control handles when a path is being edited directly. */
const NODE_COLOR = '#7c3aed';
const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
/** How close, in screen pixels, the pointer must be to grab a path anchor. */
const NODE_GRAB_RADIUS = 7;
/** Width of the ruler strips, in screen pixels. */
const RULER_SIZE = 20;
/** How close, in screen pixels, the pointer must be to grab a guide. */
const GUIDE_GRAB_RADIUS = 5;
const GUIDE_COLOR = '#22d3ee';

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

/**
 * The whole viewport as one matrix: pan, zoom and canvas rotation.
 *
 * Rotation is what forces this to be a matrix rather than the three-line
 * arithmetic it used to be. A rotated view means a screen point no longer maps
 * back to a canvas point by subtracting and dividing, so **every** mapping —
 * the pointer, the text overlay's position, the ruler ticks — has to go through
 * this and its inverse, or they disagree the moment the canvas is turned.
 *
 * The rotation is about the canvas's own centre, which is what makes turning
 * the view feel like turning a sheet of paper rather than swinging it around
 * the corner of the screen.
 */
function viewportMatrix(t: Transform, rotation: number, canvas: { width: number; height: number }) {
  const pan = { a: t.scale, b: 0, c: 0, d: t.scale, e: t.x, f: t.y };
  if (!rotation) return pan;
  return multiplyTransform(pan, rotateAbout(rotation, { x: canvas.width / 2, y: canvas.height / 2 }));
}

function screenToCanvas(sx: number, sy: number, t: Transform, rotation: number, canvas: { width: number; height: number }): Point {
  return mapPoint(invertTransform(viewportMatrix(t, rotation, canvas)), { x: sx, y: sy });
}

/** Snaps a coordinate to the grid on one axis. The origin differs per axis. */
function snapToGrid(value: number, doc: DrawingDocument, axis: 'x' | 'y'): number {
  if (!doc.grid.snap) return value;
  const size = doc.grid.size || 1;
  const origin = doc.grid.origin[axis];
  return Math.round((value - origin) / size) * size + origin;
}

/**
 * A coordinate snapped to everything the workspace says it should snap to.
 *
 * The grid is tried first and the other candidates only where it did not move
 * the value: with both on, a guide two pixels from a grid line would otherwise
 * fight the grid every time the pointer crossed it, and which one won would
 * depend on the order of two `if`s rather than on anything the user could see.
 */
function snapTo(
  value: number,
  doc: DrawingDocument,
  axis: 'x' | 'y',
  rects?: readonly Rect[],
): number {
  const snapped = snapToGrid(value, doc, axis);
  if (snapped !== value) return snapped;

  const workspace = workspaceOf(doc.workspace);
  const candidates = snapCandidates(axis, {
    canvas: doc.canvas,
    guides: workspace.showGuides ? doc.guides : [],
    rects,
    settings: workspace.snap,
  });
  return snapValue(value, candidates, workspace.snap.tolerance);
}

/**
 * The bounding boxes a drag can catch on.
 *
 * Empty unless object snapping is on, so the tree walk costs nothing in the
 * default configuration — and it is a walk per pointer event, beside the hit
 * test that already does one.
 */
function snapTargets(doc: DrawingDocument, exclude?: ReadonlySet<string>): Rect[] {
  if (!workspaceOf(doc.workspace).snap.objects) return [];
  const symbols = symbolTable(doc);
  const out: Rect[] = [];
  for (const { node } of flattenTree(doc.root)) {
    if (node.type === 'stack' || exclude?.has(node.id)) continue;
    if (!isEffectivelyVisible(doc.root, node.id)) continue;
    const bounds = nodeCanvasBounds(doc.root, node, symbols);
    if (bounds) out.push(bounds);
  }
  return out;
}

function handlePositions(rect: Rect): Record<ResizeHandle, Point> {
  const { x, y, width: w, height: h } = rect;
  return {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
    rotate: { x: x + w / 2, y: y - ROTATE_OFFSET },
  };
}

/** The corner a scale drag holds still — the one opposite the handle being dragged. */
function anchorFor(rect: Rect, handle: ResizeHandle): Point {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const x = handle.includes('w') ? right : handle.includes('e') ? rect.x : rect.x + rect.width / 2;
  const y = handle.includes('n') ? bottom : handle.includes('s') ? rect.y : rect.y + rect.height / 2;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Selection geometry
// ---------------------------------------------------------------------------

interface SelectionFrame {
  rect: Rect;
  /** Set only for a single rotated object, so the frame can be drawn rotated too. */
  rotation: number;
  center: Point;
  /** Handles are offered for a single target; a multi-selection only moves. */
  resizable: boolean;
}

function selectionFrame(doc: DrawingDocument, selection: Selection): SelectionFrame | null {
  if (!selection) return null;

  if (selection.kind === 'objects') {
    const layer = findNode(doc.root, selection.layerId);
    if (!layer || layer.type !== 'vector') return null;
    const chosen = layer.objects.filter((o) => selection.ids.includes(o.id));
    if (chosen.length === 0) return null;

    if (chosen.length === 1) {
      const object = chosen[0];
      const frame = normalizeRect(object.frame);
      return {
        rect: frame,
        rotation: object.rotation,
        center: rectCenter(frame),
        resizable: true,
      };
    }
    const rect = unionRects(chosen.map(objectSelectionBox));
    if (!rect) return null;
    return { rect, rotation: 0, center: rectCenter(rect), resizable: false };
  }

  const symbols = symbolTable(doc);
  const rects = selection.ids
    .map((id) => findNode(doc.root, id))
    .filter((n): n is DrawingNode => n !== null)
    .map((node) => nodeCanvasBounds(doc.root, node, symbols));
  const rect = unionRects(rects);
  if (!rect) return null;
  return { rect, rotation: 0, center: rectCenter(rect), resizable: selection.ids.length === 1 };
}

/** The single path being edited by the node tool, or null. */
function editablePath(doc: DrawingDocument, selection: Selection): { layerId: string; object: PathObject } | null {
  if (selection?.kind !== 'objects' || selection.ids.length !== 1) return null;
  const layer = findNode(doc.root, selection.layerId);
  if (layer?.type !== 'vector') return null;
  const object = layer.objects.find((o) => o.id === selection.ids[0]);
  return object?.kind === 'path' ? { layerId: layer.id, object } : null;
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

interface ObjectHit {
  kind: 'object';
  layerId: string;
  object: VectorObject;
}

interface NodeHit {
  kind: 'node';
  node: DrawingNode;
}

type Hit = ObjectHit | NodeHit;

/**
 * What is under the cursor, topmost first.
 *
 * The walk follows paint order in reverse — the last thing painted is the first
 * thing hit — and skips anything hidden or locked, directly or through a group.
 * A vector layer reports the *object* that was hit rather than the layer,
 * because objects are what the select tool moves; every other layer type
 * reports itself.
 */
function hitTest(doc: DrawingDocument, point: Point): Hit | null {
  let found: Hit | null = null;
  const symbols = symbolTable(doc);

  const walk = (node: DrawingNode): void => {
    if (found) return;
    if (!isEffectivelyVisible(doc.root, node.id)) return;

    if (node.type === 'stack') {
      // `children` order is topmost-first, which is exactly hit-test order —
      // the reverse of the order the renderer paints in.
      for (const child of node.children) {
        walk(child);
        if (found) return;
      }
      return;
    }

    if (isEffectivelyLocked(doc.root, node.id)) return;

    if (node.type === 'vector') {
      for (const object of node.objects) {
        if (object.locked) continue;
        if (hitTestObject(object, point)) {
          found = { kind: 'object', layerId: node.id, object };
          return;
        }
      }
      return;
    }

    const bounds = nodeCanvasBounds(doc.root, node, symbols);
    if (bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y && point.y <= bounds.y + bounds.height) {
      found = { kind: 'node', node };
    }
  };

  for (const child of doc.root.children) {
    walk(child);
    if (found) break;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Path anchors
// ---------------------------------------------------------------------------

/** Which piece of a path's skeleton a pointer landed on. */
interface NodeTarget {
  contour: number;
  index: number;
  part: 'anchor' | 'in' | 'out';
}

function nodeTargetAt(object: PathObject, point: Point, reach: number): NodeTarget | null {
  const contours = pathContours(object);
  // Handles are tested before anchors: a handle pulled in close sits on top of
  // its anchor, and testing anchors first would make it ungrabbable.
  for (const part of ['in', 'out', 'anchor'] as const) {
    for (let c = 0; c < contours.length; c++) {
      const points = contours[c].points;
      for (let i = 0; i < points.length; i++) {
        const at = part === 'anchor' ? points[i] : points[i][part];
        if (!at) continue;
        if (Math.hypot(at.x - point.x, at.y - point.y) <= reach) {
          return { contour: c, index: i, part };
        }
      }
    }
  }
  return null;
}

/** Rewrites one point of one contour. */
function updatePathPoint(
  object: PathObject,
  target: NodeTarget,
  update: (point: PathPoint) => PathPoint,
): PathObject {
  const contours = pathContours(object);
  const next = contours.map((contour, c) => (c !== target.contour ? contour : {
    ...contour,
    points: contour.points.map((p, i) => (i === target.index ? update(p) : p)),
  }));
  return {
    ...object,
    points: next[0].points,
    closed: next[0].closed,
    ...(next.length > 1 ? { subpaths: next.slice(1) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

type DragMode =
  | 'none'
  | 'panning'
  | 'drawing'
  | 'moving'
  | 'resizing'
  | 'rotating'
  | 'marquee'
  | 'erasing'
  | 'painting'
  | 'selecting'
  | 'node'
  | 'guide';

interface DragState {
  mode: DragMode;
  /** Canvas-space anchor for content drags, screen-space for a pan. */
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  handle?: ResizeHandle;
  /** The document as it was when the drag began — every frame is a delta from it. */
  originalDoc?: DrawingDocument;
  marquee?: Rect;
  /** The pixel selection being dragged out, before it is committed. */
  selectionDraft?: SelectionShape;
  nodeTarget?: NodeTarget;
  /** The guide being dragged, or created. */
  guide?: GuideDrag;
}

/**
 * A guide being pulled out of a ruler, or moved.
 *
 * `id` is absent while one is being created, which is the whole difference
 * between the two gestures: a new guide exists only in this state until the
 * pointer comes up inside the canvas, so dragging off a ruler and letting go
 * outside leaves no guide and no undo step.
 */
interface GuideDrag {
  orientation: 'horizontal' | 'vertical';
  id?: string;
  position: number;
}

const IDLE: DragState = { mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0 };

/** A stroke in progress, and where its pixels are going. */
interface PaintState {
  session: PaintSession;
  nodeId: string;
  rect: Rect;
  mode: 'layer' | 'mask';
  /**
   * Set once the stroke is committed, to the data URL the layer now holds.
   *
   * The session outlives its own commit on purpose. Decoding the new PNG is
   * asynchronous and painting a frame is not, so between the document changing
   * and the bitmap arriving there is at least one frame where the layer has
   * pixels nothing can draw — which reads as the stroke flashing away and
   * coming back. Keeping the preview on screen until `bitmaps` has the new URL
   * closes that gap.
   */
  committedUrl?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas(props, ref) {
    const {
      doc,
      onDocumentChange,
      tool,
      onToolChange,
      selection,
      onSelectionChange,
      activeLayerId,
      newObjectStyle,
      onTransformChange,
      bitmaps,
      images,
      brush,
      maskEditing,
      initialTransform,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const topRulerRef = useRef<HTMLCanvasElement>(null);
    const leftRulerRef = useRef<HTMLCanvasElement>(null);
    const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
    const dragRef = useRef<DragState>(IDLE);
    const spaceRef = useRef(false);
    /** The shape being dragged out, drawn on top but not yet in the document. */
    const draftRef = useRef<VectorObject | null>(null);
    const paintRef = useRef<PaintState | null>(null);
    /** Advances the marching ants, so a selection reads as active rather than drawn. */
    const antsRef = useRef(0);

    // Event handlers are registered once and read live values through refs, so
    // the listeners never need re-binding mid-drag.
    const docRef = useRef(doc);
    const toolRef = useRef(tool);
    const selectionRef = useRef(selection);
    const activeLayerRef = useRef(activeLayerId);
    const styleRef = useRef(newObjectStyle);
    const bitmapsRef = useRef(bitmaps);
    const imagesRef = useRef(images);
    const brushRef = useRef(brush);
    const maskEditingRef = useRef(maskEditing);
    docRef.current = doc;
    toolRef.current = tool;
    selectionRef.current = selection;
    activeLayerRef.current = activeLayerId;
    styleRef.current = newObjectStyle;
    bitmapsRef.current = bitmaps;
    imagesRef.current = images;
    brushRef.current = brush;
    maskEditingRef.current = maskEditing;

    const [textEdit, setTextEdit] = useState<{ nodeId: string | null; box: Rect; value: string } | null>(null);
    const textEditRef = useRef(textEdit);
    textEditRef.current = textEdit;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // Guards against the spurious blur React 18 StrictMode fires while removing
    // the textarea during effect cleanup, which would commit an empty edit.
    const textReadyRef = useRef(false);

    // ---------------------------------------------------------------------
    // Painting
    // ---------------------------------------------------------------------

    const render = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const document_ = docRef.current;
      const t = transformRef.current;
      const workspace = workspaceOf(document_.workspace);
      const { width, height } = canvas;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      const view = viewportMatrix(t, workspace.canvasRotation, document_.canvas);
      ctx.transform(view.a, view.b, view.c, view.d, view.e, view.f);

      // The page: a bordered rectangle with a drop shadow, so the fixed canvas
      // reads as a sheet of paper rather than as an arbitrary crop.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 16 / t.scale;
      ctx.shadowOffsetY = 2 / t.scale;
      ctx.fillStyle = document_.canvas.background ?? '#ffffff';
      ctx.fillRect(0, 0, document_.canvas.width, document_.canvas.height);
      ctx.restore();

      // Everything outside the page is clipped away: a layer can extend past
      // the canvas, and the export crops it, so the editor must too or the two
      // disagree about what the drawing is.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, document_.canvas.width, document_.canvas.height);
      ctx.clip();

      const paint = paintRef.current;
      const skip = new Set<string>();
      if (textEditRef.current?.nodeId) skip.add(textEditRef.current.nodeId);
      // A layer being painted is drawn from the session's own preview instead,
      // which holds the base pixels with the live stroke already composited —
      // the only way an eraser stroke can be shown while it is still undoable.
      if (paint && paint.mode === 'layer') skip.add(paint.nodeId);

      renderDocument(ctx, document_, {
        bitmaps: bitmapsRef.current,
        images: imagesRef.current,
        // The background is already painted as the page, above.
        drawBackground: false,
        skipNodeIds: skip.size > 0 ? skip : undefined,
      });

      if (paint) drawPaintPreview(ctx, paint);
      if (draftRef.current) drawVectorObject(ctx, draftRef.current, imagesRef.current);

      if (document_.grid.visible) drawGrid(ctx, document_, t.scale);
      ctx.restore();

      drawPageBorder(ctx, document_, t.scale);
      if (workspace.showGuides) drawGuides(ctx, document_, t.scale, dragRef.current.guide);

      const pixelSelection = dragRef.current.selectionDraft ?? document_.selection;
      if (pixelSelection) drawMarchingAnts(ctx, pixelSelection, t.scale, antsRef.current);

      const path = toolRef.current === 'node' ? editablePath(document_, selectionRef.current) : null;
      if (path) drawPathNodes(ctx, path.object, t.scale);
      else drawSelection(ctx, document_, selectionRef.current, t.scale);

      const marquee = dragRef.current.marquee;
      if (marquee) {
        ctx.save();
        ctx.fillStyle = 'rgba(37,99,235,0.08)';
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = 1 / t.scale;
        ctx.setLineDash([4 / t.scale, 3 / t.scale]);
        ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
        ctx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);
        ctx.restore();
      }

      ctx.restore();

      // Drawn last and outside the viewport transform: a ruler is chrome in
      // screen space that happens to be labelled in canvas units, and putting
      // it under the transform would zoom the numbers along with the drawing.
      if (workspace.rulers) drawRulers(topRulerRef.current, leftRulerRef.current, document_, workspace, t);
    }, []);

    useEffect(() => { render(); }, [doc, selection, bitmaps, images, textEdit, tool, render]);

    // The ants only run while something is selected, so an idle editor is not
    // repainting the whole canvas twice a second for nothing.
    useEffect(() => {
      if (!doc.selection) return;
      const timer = setInterval(() => {
        antsRef.current = (antsRef.current + 1) % 8;
        render();
      }, 120);
      return () => clearInterval(timer);
    }, [doc.selection, render]);

    // ---------------------------------------------------------------------
    // Viewport
    // ---------------------------------------------------------------------

    const applyTransform = useCallback((next: Transform) => {
      transformRef.current = next;
      onTransformChange?.(next);
      render();
    }, [onTransformChange, render]);

    const fitToScreen = useCallback(() => {
      const container = containerRef.current;
      if (!container) return;
      const { clientWidth, clientHeight } = container;
      const document_ = docRef.current;
      // The rulers sit over the top-left corner of the same canvas, so fitting
      // has to leave room for them or the page's first inch is under a ruler.
      const margin = 48 + (workspaceOf(document_.workspace).rulers ? RULER_SIZE * 2 : 0);
      const scale = Math.max(
        MIN_SCALE,
        Math.min(
          MAX_SCALE,
          Math.min(
            (clientWidth - margin) / document_.canvas.width,
            (clientHeight - margin) / document_.canvas.height,
          ),
        ),
      );
      applyTransform({
        scale,
        x: (clientWidth - document_.canvas.width * scale) / 2,
        y: (clientHeight - document_.canvas.height * scale) / 2,
      });
    }, [applyTransform]);

    // Centre the page on first mount, so a new drawing does not open with its
    // canvas half off-screen — unless the document remembers where it was left,
    // which takes precedence.
    const centredRef = useRef(false);
    useEffect(() => {
      if (centredRef.current) return;
      centredRef.current = true;
      if (initialTransform) applyTransform({ ...initialTransform });
      else fitToScreen();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitToScreen]);

    useImperativeHandle(ref, () => ({
      setTransform: applyTransform,
      fitToScreen,
      exportPNG: async ({ scale = 2, background } = {}) => {
        const document_ = docRef.current;
        const width = Math.max(1, Math.round(document_.canvas.width * scale));
        const height = Math.max(1, Math.round(document_.canvas.height * scale));
        const surface = domSurfaceFactory(width, height);
        const ctx = surface.getContext('2d');
        if (!ctx) throw new Error('cannot render the export');
        ctx.scale(scale, scale);
        renderDocument(
          ctx,
          background === undefined ? document_ : { ...document_, canvas: { ...document_.canvas, background } },
          { bitmaps: bitmapsRef.current, images: imagesRef.current },
        );
        return surfaceToBlob(surface);
      },
      exportSVG: ({ background } = {}) => documentToSvg(docRef.current, { background }),
    }), [applyTransform, fitToScreen]);

    // ---------------------------------------------------------------------
    // Text editing
    // ---------------------------------------------------------------------

    const commitText = useCallback(() => {
      const edit = textEditRef.current;
      if (!edit) return;
      textEditRef.current = null;
      setTextEdit(null);

      const trimmed = edit.value.trim();
      const document_ = docRef.current;

      if (edit.nodeId === null) {
        if (!trimmed) return;
        const layer = createTextLayer(edit.box, trimmed);
        onDocumentChange(addNode(document_, layer));
        onSelectionChange({ kind: 'nodes', ids: [layer.id] });
        return;
      }

      // An emptied text layer is deleted rather than left as an invisible node
      // nothing can select and nothing draws.
      if (!trimmed) {
        onDocumentChange(deleteNode(document_, edit.nodeId));
        onSelectionChange(null);
        return;
      }
      onDocumentChange(setTextContent(document_, edit.nodeId, trimmed));
    }, [onDocumentChange, onSelectionChange]);

    useEffect(() => {
      if (!textEdit) return;
      textReadyRef.current = false;
      const raf = requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
        textReadyRef.current = true;
      });
      return () => {
        cancelAnimationFrame(raf);
        textReadyRef.current = false;
      };
    }, [textEdit?.nodeId, textEdit !== null]); // eslint-disable-line react-hooks/exhaustive-deps

    const beginTextEdit = useCallback((point: Point) => {
      const document_ = docRef.current;
      const hit = hitTest(document_, point);
      if (hit?.kind === 'node' && hit.node.type === 'text') {
        const edit = { nodeId: hit.node.id, box: hit.node.box, value: hit.node.text };
        textEditRef.current = edit;
        setTextEdit(edit);
        onSelectionChange({ kind: 'nodes', ids: [hit.node.id] });
        return;
      }
      const box: Rect = { x: point.x, y: point.y, width: 320, height: 48 };
      const edit = { nodeId: null, box, value: '' };
      textEditRef.current = edit;
      setTextEdit(edit);
      onSelectionChange(null);
    }, [onSelectionChange]);

    // ---------------------------------------------------------------------
    // Pointer handling
    // ---------------------------------------------------------------------

    const canvasPoint = useCallback((e: PointerEvent | MouseEvent): Point => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const document_ = docRef.current;
      return screenToCanvas(
        e.clientX - rect.left,
        e.clientY - rect.top,
        transformRef.current,
        workspaceOf(document_.workspace).canvasRotation,
        document_.canvas,
      );
    }, []);

    /** Where a canvas point lands on screen — the inverse of `canvasPoint`. */
    const screenPoint = useCallback((point: Point): Point => {
      const document_ = docRef.current;
      const view = viewportMatrix(
        transformRef.current,
        workspaceOf(document_.workspace).canvasRotation,
        document_.canvas,
      );
      return mapPoint(view, point);
    }, []);

    /**
     * The guide under the pointer, if one is grabbable.
     *
     * Tested in **canvas** units scaled from a screen tolerance, so a guide is
     * as easy to grab at 10% zoom as at 400% — a fixed canvas-space tolerance
     * would make one unhittable zoomed out and sticky zoomed in.
     */
    const guideAt = useCallback((point: Point): { id: string; orientation: 'horizontal' | 'vertical'; position: number } | null => {
      const document_ = docRef.current;
      const workspace = workspaceOf(document_.workspace);
      if (!workspace.showGuides || workspace.lockGuides) return null;

      const reach = GUIDE_GRAB_RADIUS / transformRef.current.scale;
      for (const guide of document_.guides) {
        const distance = guide.orientation === 'vertical'
          ? Math.abs(guide.position - point.x)
          : Math.abs(guide.position - point.y);
        if (distance <= reach) return guide;
      }
      return null;
    }, []);

    const findHandle = useCallback((point: Point): ResizeHandle | null => {
      const frame = selectionFrame(docRef.current, selectionRef.current);
      if (!frame || !frame.resizable) return null;
      const local = frame.rotation ? unrotatePoint(point, frame.center, frame.rotation) : point;
      const reach = (HANDLE_SIZE / 2 + 3) / transformRef.current.scale;
      for (const [key, position] of Object.entries(handlePositions(frame.rect)) as [ResizeHandle, Point][]) {
        const r = key === 'rotate' ? reach * 1.6 : reach;
        if (Math.abs(position.x - local.x) <= r && Math.abs(position.y - local.y) <= r) return key;
      }
      return null;
    }, []);

    /**
     * Opens a paint session over whatever the brush should be painting.
     *
     * Returns null when there is nothing to paint into — no active raster
     * layer, a locked one, or mask editing with no mask. The caller then does
     * nothing at all, which is better than painting into a layer the user did
     * not choose.
     */
    const beginPaint = useCallback((point: Point, pressure: number): boolean => {
      const document_ = docRef.current;
      const node = findNode(document_.root, activeLayerRef.current);
      if (!node || isEffectivelyLocked(document_.root, node.id)) return false;

      const painting = maskEditingRef.current ? node.mask?.source : (node.type === 'raster' ? node.source : null);
      if (!painting) return false;

      const rect: Rect = { x: painting.x, y: painting.y, width: painting.width, height: painting.height };
      const session = PaintSession.begin({
        bitmap: bitmapsRef.current.get(painting.dataUrl) ?? null,
        rect,
        brush: brushRef.current,
        createSurface: domSurfaceFactory,
        selection: document_.selection,
        bitmaps: bitmapsRef.current,
        mask: Boolean(maskEditingRef.current),
      });
      if (!session) return false;

      session.begin(strokePoint(point.x, point.y, pressure));
      paintRef.current = {
        session,
        nodeId: node.id,
        rect,
        mode: maskEditingRef.current ? 'mask' : 'layer',
      };
      render();
      return true;
    }, [render]);

    const finishPaint = useCallback(() => {
      const paint = paintRef.current;
      if (!paint) return;

      const source = paint.session.commit();
      // A click that laid nothing down leaves no undo step and no re-encoded
      // PNG — which is what makes tapping the canvas with a brush free.
      if (!source) {
        paintRef.current = null;
        render();
        return;
      }

      // Held, not cleared — see `committedUrl`. The effect below drops it once
      // the new pixels are decoded and the layer can draw itself again.
      paint.committedUrl = source.dataUrl;
      const document_ = docRef.current;
      onDocumentChange(paint.mode === 'mask'
        ? setMaskSource(document_, paint.nodeId, source)
        : setRasterSource(document_, paint.nodeId, source));
    }, [onDocumentChange, render]);

    useEffect(() => {
      const paint = paintRef.current;
      if (!paint?.committedUrl) return;
      if (!bitmaps.has(paint.committedUrl)) return;
      paintRef.current = null;
      render();
    }, [bitmaps, render]);

    const eraseAt = useCallback((point: Point) => {
      const document_ = docRef.current;
      const hit = hitTest(document_, point);
      if (!hit) return;
      if (hit.kind === 'object') {
        onDocumentChange(removeObjects(document_, hit.layerId, [hit.object.id]));
      } else {
        onDocumentChange(deleteNode(document_, hit.node.id));
      }
      onSelectionChange(null);
    }, [onDocumentChange, onSelectionChange]);

    const onPointerDown = useCallback((e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        dragRef.current = { ...IDLE, mode: 'panning', startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      if (textEditRef.current) commitText();

      const point = canvasPoint(e);
      const currentTool = toolRef.current;
      const document_ = docRef.current;
      // Pointer capture keeps the stroke alive when the cursor leaves the
      // canvas mid-drag, which for a brush is the difference between a stroke
      // that ends at the edge and one that stops wherever the mouse left.
      canvasRef.current?.setPointerCapture(e.pointerId);

      if (isPaintTool(currentTool)) {
        if (beginPaint(point, e.pressure)) {
          dragRef.current = { ...IDLE, mode: 'painting', startX: point.x, startY: point.y, lastX: point.x, lastY: point.y };
        }
        return;
      }

      if (isSelectionTool(currentTool)) {
        dragRef.current = {
          ...IDLE,
          mode: 'selecting',
          startX: point.x, startY: point.y, lastX: point.x, lastY: point.y,
          selectionDraft: currentTool === 'lasso'
            ? { kind: 'lasso', points: [point] }
            : { kind: currentTool === 'select-ellipse' ? 'ellipse' : 'rect', rect: { x: point.x, y: point.y, width: 0, height: 0 } },
        };
        render();
        return;
      }

      if (currentTool === 'text') {
        beginTextEdit(point);
        return;
      }

      if (currentTool === 'eraser') {
        dragRef.current = { ...IDLE, mode: 'erasing', startX: point.x, startY: point.y, lastX: point.x, lastY: point.y };
        eraseAt(point);
        return;
      }

      if (currentTool === 'node') {
        const path = editablePath(document_, selectionRef.current);
        if (path) {
          const target = nodeTargetAt(path.object, point, NODE_GRAB_RADIUS / transformRef.current.scale);
          if (target) {
            dragRef.current = {
              mode: 'node',
              startX: point.x, startY: point.y, lastX: point.x, lastY: point.y,
              originalDoc: document_,
              nodeTarget: target,
            };
            return;
          }
        }
        // Nothing under the cursor: fall through to ordinary selection, so the
        // node tool can still be used to pick the path to edit.
      }

      if (currentTool === 'select' || currentTool === 'node' || currentTool === 'transform') {
        // A guide is tested before the resize handles and before hit testing:
        // it sits over the drawing and a guide laid across a shape would
        // otherwise be ungrabbable exactly where it is most likely to be.
        const guide = guideAt(point);
        if (guide) {
          dragRef.current = {
            ...IDLE,
            mode: 'guide',
            startX: point.x, startY: point.y, lastX: point.x, lastY: point.y,
            guide: { orientation: guide.orientation, id: guide.id, position: guide.position },
          };
          render();
          return;
        }

        const handle = findHandle(point);
        if (handle) {
          dragRef.current = {
            mode: handle === 'rotate' ? 'rotating' : 'resizing',
            startX: point.x, startY: point.y, lastX: point.x, lastY: point.y,
            handle,
            originalDoc: document_,
          };
          return;
        }

        const hit = hitTest(document_, point);
        if (hit) {
          const next = extendSelection(selectionRef.current, hit, e.shiftKey);
          onSelectionChange(next);
          dragRef.current = {
            mode: 'moving',
            startX: point.x, startY: point.y, lastX: point.x, lastY: point.y,
            originalDoc: document_,
          };
          return;
        }

        if (!e.shiftKey) onSelectionChange(null);
        dragRef.current = {
          ...IDLE,
          mode: 'marquee',
          startX: point.x, startY: point.y, lastX: point.x, lastY: point.y,
          marquee: { x: point.x, y: point.y, width: 0, height: 0 },
        };
        return;
      }

      // A vector drawing tool. The draft lives outside the document until the
      // mouse is released, so a drag that produces nothing leaves no undo step.
      const targets = snapTargets(document_);
      const x = snapTo(point.x, document_, 'x', targets);
      const y = snapTo(point.y, document_, 'y', targets);
      const style = styleRef.current;

      draftRef.current =
        currentTool === 'pen' ? createPath([{ x: point.x, y: point.y }], style)
        : currentTool === 'rectangle' ? createRect({ x, y, width: 0, height: 0 }, style)
        : currentTool === 'ellipse' ? createEllipse({ x, y, width: 0, height: 0 }, style)
        : createLine({ x, y, width: 0, height: 0 }, { arrowEnd: currentTool === 'arrow' }, style);

      dragRef.current = { ...IDLE, mode: 'drawing', startX: x, startY: y, lastX: x, lastY: y };
      render();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [beginPaint, beginTextEdit, canvasPoint, commitText, eraseAt, findHandle, guideAt, onSelectionChange, render]);

    /**
     * Starts pulling a guide out of a ruler.
     *
     * The guide does not exist in the document until the pointer comes up, so a
     * drag that ends back over the ruler — or anywhere off the page — leaves
     * nothing behind and no undo step to step over.
     */
    const onRulerPointerDown = useCallback((orientation: 'horizontal' | 'vertical') => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const document_ = docRef.current;
      const workspace = workspaceOf(document_.workspace);
      if (!workspace.showGuides || workspace.lockGuides) return;

      e.preventDefault();
      const point = canvasPoint(e.nativeEvent);
      dragRef.current = {
        ...IDLE,
        mode: 'guide',
        startX: point.x, startY: point.y, lastX: point.x, lastY: point.y,
        guide: {
          orientation,
          position: orientation === 'horizontal'
            ? snapTo(point.y, document_, 'y', snapTargets(document_))
            : snapTo(point.x, document_, 'x', snapTargets(document_)),
        },
      };
      render();
    }, [canvasPoint, render]);

    const onPointerMove = useCallback((e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag.mode === 'none') return;

      if (drag.mode === 'panning') {
        const t = transformRef.current;
        applyTransform({ ...t, x: t.x + (e.clientX - drag.lastX), y: t.y + (e.clientY - drag.lastY) });
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        return;
      }

      const point = canvasPoint(e);
      const document_ = docRef.current;

      switch (drag.mode) {
        case 'painting': {
          paintRef.current?.session.extend(strokePoint(point.x, point.y, e.pressure));
          render();
          return;
        }

        case 'guide': {
          const guide = drag.guide;
          if (!guide) return;
          // Tracked in the drag rather than written to the document per frame:
          // a guide dragged across a page would otherwise be one undo step per
          // pointer event, and the history would be nothing else.
          const targets = snapTargets(document_);
          guide.position = guide.orientation === 'horizontal'
            ? snapTo(point.y, document_, 'y', targets)
            : snapTo(point.x, document_, 'x', targets);
          render();
          return;
        }

        case 'selecting': {
          const draft = drag.selectionDraft;
          // `mask` never appears here — the selection tools produce only the
          // three shapes below — but the type admits it, and narrowing rather
          // than casting is what keeps that true if a fourth tool is added.
          if (!draft || draft.kind === 'mask') return;
          drag.selectionDraft = draft.kind === 'lasso'
            ? { kind: 'lasso', points: [...draft.points, point] }
            : {
                kind: draft.kind,
                rect: {
                  x: Math.min(drag.startX, point.x),
                  y: Math.min(drag.startY, point.y),
                  width: Math.abs(point.x - drag.startX),
                  height: Math.abs(point.y - drag.startY),
                },
              };
          render();
          return;
        }

        case 'node': {
          const original = drag.originalDoc;
          const target = drag.nodeTarget;
          const current = selectionRef.current;
          if (!original || !target || current?.kind !== 'objects') return;
          onDocumentChange(mapObjects(original, current.layerId, current.ids, (object) =>
            object.kind === 'path' ? dragPathPoint(object, target, point, drag) : object));
          return;
        }

        case 'erasing':
          eraseAt(point);
          return;

        case 'drawing': {
          const draft = draftRef.current;
          if (!draft) return;
          if (draft.kind === 'path') {
            draft.points.push({ x: point.x, y: point.y });
          } else {
            const targets = snapTargets(document_);
            const x = snapTo(point.x, document_, 'x', targets);
            const y = snapTo(point.y, document_, 'y', targets);
            if (draft.kind === 'line') {
              // Signed width and height: a line's frame records direction.
              draft.frame = { x: drag.startX, y: drag.startY, width: x - drag.startX, height: y - drag.startY };
            } else {
              draft.frame = {
                x: Math.min(drag.startX, x),
                y: Math.min(drag.startY, y),
                width: Math.abs(x - drag.startX),
                height: Math.abs(y - drag.startY),
              };
            }
          }
          render();
          return;
        }

        case 'moving': {
          const original = drag.originalDoc;
          const current = selectionRef.current;
          if (!original || !current) return;
          const dx = point.x - drag.startX;
          const dy = point.y - drag.startY;

          if (current.kind === 'objects') {
            onDocumentChange(mapObjects(original, current.layerId, current.ids, (object) =>
              translateObject(object, dx, dy)));
          } else {
            let next = original;
            for (const id of current.ids) next = translateNode(next, id, dx, dy);
            onDocumentChange(next);
          }
          return;
        }

        case 'resizing': {
          const original = drag.originalDoc;
          const current = selectionRef.current;
          if (!original || !current || !drag.handle) return;
          onDocumentChange(applyResize(original, current, drag, point));
          return;
        }

        case 'rotating': {
          const original = drag.originalDoc;
          const current = selectionRef.current;
          if (!original || !current) return;
          const frame = selectionFrame(original, current);
          if (!frame) return;
          const angle = (Math.atan2(point.y - frame.center.y, point.x - frame.center.x) * 180) / Math.PI + 90;

          if (current.kind === 'objects') {
            onDocumentChange(mapObjects(original, current.layerId, current.ids, (object) => ({
              ...object,
              rotation: Math.round(angle),
            })));
            return;
          }
          // A node has no `rotation` field — its orientation lives in its
          // matrix — so the gesture becomes a rotation about the frame's centre
          // composed onto whatever transform it already had.
          onDocumentChange(transformNode(original, current.ids[0], rotateAbout(Math.round(angle), frame.center)));
          return;
        }

        case 'marquee': {
          drag.marquee = {
            x: Math.min(drag.startX, point.x),
            y: Math.min(drag.startY, point.y),
            width: Math.abs(point.x - drag.startX),
            height: Math.abs(point.y - drag.startY),
          };
          render();
          return;
        }
      }
    }, [applyTransform, canvasPoint, eraseAt, onDocumentChange, render]);

    const onPointerUp = useCallback((e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag.mode === 'none') return;
      const document_ = docRef.current;
      // Only where it was actually taken: a guide dragged out of a ruler never
      // captured the canvas, and releasing a pointer that was not captured
      // throws rather than being ignored.
      if (canvasRef.current?.hasPointerCapture?.(e.pointerId)) {
        canvasRef.current.releasePointerCapture(e.pointerId);
      }

      if (drag.mode === 'painting') {
        const point = canvasPoint(e);
        paintRef.current?.session.end(strokePoint(point.x, point.y, e.pressure));
        dragRef.current = IDLE;
        finishPaint();
        return;
      }

      if (drag.mode === 'guide') {
        const guide = drag.guide;
        dragRef.current = IDLE;
        if (guide) commitGuide(document_, guide, onDocumentChange);
        render();
        return;
      }

      if (drag.mode === 'selecting') {
        const draft = drag.selectionDraft;
        dragRef.current = IDLE;
        // A click with a selection tool, rather than a drag, deselects — which
        // is what every editor does and the only gesture that would otherwise
        // have no meaning.
        onDocumentChange(setSelection(document_, isMeaningfulSelection(draft) ? draft : undefined));
        return;
      }

      if (drag.mode === 'drawing') {
        const draft = draftRef.current;
        draftRef.current = null;
        if (draft) {
          const meaningful = draft.kind === 'path'
            ? draft.points.length > 1
            : Math.abs(draft.frame.width) > 2 || Math.abs(draft.frame.height) > 2;
          if (meaningful) {
            const finished = draft.kind === 'path'
              ? createPath(draft.points, draft.style)
              : draft;
            const layer = findNode(document_.root, activeLayerRef.current);
            // Nothing to draw into: a raster or text layer is active, or the id
            // is stale. Refusing beats silently retargeting another layer.
            if (layer && layer.type === 'vector') {
              onDocumentChange(addObjects(document_, layer.id, [finished]));
              onSelectionChange({ kind: 'objects', layerId: layer.id, ids: [finished.id] });
            }
          }
        }
      }

      if (drag.mode === 'marquee' && drag.marquee) {
        onSelectionChange(marqueeSelection(document_, drag.marquee, activeLayerRef.current, e.shiftKey ? selectionRef.current : null));
      }

      dragRef.current = IDLE;
      render();
    }, [canvasPoint, finishPaint, onDocumentChange, onSelectionChange, render]);

    const onDoubleClick = useCallback((e: MouseEvent) => {
      const point = canvasPoint(e);
      const currentTool = toolRef.current;

      if (currentTool === 'node') {
        // Double-clicking an anchor toggles it between a corner and a smooth
        // point, which is the one path edit that has no drag to express it.
        const path = editablePath(docRef.current, selectionRef.current);
        const current = selectionRef.current;
        if (path && current?.kind === 'objects') {
          const target = nodeTargetAt(path.object, point, NODE_GRAB_RADIUS / transformRef.current.scale);
          if (target?.part === 'anchor') {
            onDocumentChange(mapObjects(docRef.current, current.layerId, current.ids, (object) =>
              object.kind === 'path' ? toggleSmooth(object, target) : object));
            return;
          }
        }
      }

      if (currentTool !== 'select') return;
      const hit = hitTest(docRef.current, point);
      if (hit?.kind === 'node' && hit.node.type === 'text') {
        onToolChange('text');
        beginTextEdit(point);
      }
    }, [beginTextEdit, canvasPoint, onDocumentChange, onToolChange]);

    const onWheel = useCallback((e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;

      if (e.ctrlKey || e.metaKey) {
        const rect = canvasRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1 / 0.9;
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * factor));
        applyTransform({
          scale,
          x: mx - (mx - t.x) * (scale / t.scale),
          y: my - (my - t.y) * (scale / t.scale),
        });
        return;
      }
      applyTransform({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY });
    }, [applyTransform]);

    // ---------------------------------------------------------------------
    // Listeners
    // ---------------------------------------------------------------------

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const resize = () => {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        // The rulers overlay the same area rather than insetting the canvas, so
        // they share its width and height — which is also what keeps a canvas
        // point mapping to the same screen pixel whether they are shown or not.
        if (topRulerRef.current) {
          topRulerRef.current.width = container.clientWidth;
          topRulerRef.current.height = RULER_SIZE;
        }
        if (leftRulerRef.current) {
          leftRulerRef.current.width = RULER_SIZE;
          leftRulerRef.current.height = container.clientHeight;
        }
        render();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(container);

      const keyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
          spaceRef.current = true;
          e.preventDefault();
        }
      };
      const keyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') spaceRef.current = false;
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('dblclick', onDoubleClick);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);

      return () => {
        observer.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('dblclick', onDoubleClick);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
      };
    }, [onDoubleClick, onPointerDown, onPointerMove, onPointerUp, onWheel, render]);

    // ---------------------------------------------------------------------

    const cursor = spaceRef.current ? 'grab'
      : tool === 'select' || tool === 'transform' ? 'default'
      : tool === 'text' ? 'text'
      : 'crosshair';

    const workspace = workspaceOf(doc.workspace);
    const t = transformRef.current;
    // Through the viewport matrix, so the overlay lands on the text it is
    // editing when the canvas is rotated. The textarea itself is not rotated —
    // a rotated input is unusable — so at an angle it sits over its layer
    // rather than exactly on it, which is the honest compromise.
    const editorOrigin = textEdit ? screenPoint({ x: textEdit.box.x, y: textEdit.box.y }) : null;
    const editorStyle: React.CSSProperties | null = textEdit && editorOrigin
      ? {
          position: 'absolute',
          left: editorOrigin.x,
          top: editorOrigin.y,
          width: Math.max(80, textEdit.box.width * t.scale),
          fontSize: 24 * t.scale,
          lineHeight: 1.2,
          fontFamily: 'sans-serif',
          border: `1.5px dashed ${SELECTION_COLOR}`,
          borderRadius: 2,
          outline: 'none',
          background: 'transparent',
          color: '#000000',
          resize: 'none',
          overflow: 'hidden',
          padding: '0 2px',
          zIndex: 10,
        }
      : null;

    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
        {/* `touch-action: none` so a stylus or finger paints instead of scrolling
            the page out from under the stroke. */}
        <canvas ref={canvasRef} style={{ display: 'block', cursor, touchAction: 'none' }} />

        {/* The rulers overlay the canvas rather than insetting it, so turning
            them on does not move the drawing — and so a guide dragged out of
            one lands where the pointer is, with no coordinate offset to get
            wrong. Both are `hidden` rather than unmounted, because unmounting
            them would drop the refs `render` draws through. */}
        <canvas
          ref={topRulerRef}
          hidden={!workspace.rulers}
          aria-hidden="true"
          onPointerDown={onRulerPointerDown('vertical')}
          style={{ position: 'absolute', left: 0, top: 0, cursor: 'ew-resize', touchAction: 'none' }}
        />
        <canvas
          ref={leftRulerRef}
          hidden={!workspace.rulers}
          aria-hidden="true"
          onPointerDown={onRulerPointerDown('horizontal')}
          style={{ position: 'absolute', left: 0, top: 0, cursor: 'ns-resize', touchAction: 'none' }}
        />
        {workspace.rulers && (
          <div
            title="Ruler units"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: RULER_SIZE,
              height: RULER_SIZE,
              background: '#ffffff',
              borderRight: '1px solid #e5e7eb',
              borderBottom: '1px solid #e5e7eb',
              fontSize: 8,
              color: '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
            }}
          >
            {workspace.units}
          </div>
        )}
        {textEdit && editorStyle && (
          <textarea
            ref={textareaRef}
            aria-label="Text layer content"
            value={textEdit.value}
            style={editorStyle}
            onChange={(e) => {
              const next = { ...textEdit, value: e.target.value };
              textEditRef.current = next;
              setTextEdit(next);
            }}
            onBlur={() => { if (textReadyRef.current) commitText(); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                textEditRef.current = null;
                setTextEdit(null);
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commitText();
              }
            }}
          />
        )}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function drawGrid(ctx: CanvasRenderingContext2D, doc: DrawingDocument, scale: number): void {
  const size = doc.grid.size;
  // Below this the lines are closer together than they are wide and the grid
  // reads as a grey wash.
  if (size * scale < 6) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let x = doc.grid.origin.x % size; x <= doc.canvas.width; x += size) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, doc.canvas.height);
  }
  for (let y = doc.grid.origin.y % size; y <= doc.canvas.height; y += size) {
    ctx.moveTo(0, y);
    ctx.lineTo(doc.canvas.width, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPageBorder(ctx: CanvasRenderingContext2D, doc: DrawingDocument, scale: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1 / scale;
  ctx.strokeRect(0, 0, doc.canvas.width, doc.canvas.height);
  ctx.restore();
}

/**
 * The guides, plus the one being dragged.
 *
 * The dragged one is drawn from the drag state rather than from the document,
 * which is what lets a *new* guide be visible before it exists — and lets one
 * being moved be drawn at the pointer while the document still holds where it
 * started.
 */
function drawGuides(
  ctx: CanvasRenderingContext2D,
  doc: DrawingDocument,
  scale: number,
  dragging?: GuideDrag,
): void {
  const lines = doc.guides
    .filter((guide) => guide.id !== dragging?.id)
    .map((guide) => ({ orientation: guide.orientation, position: guide.position }));
  if (dragging) lines.push({ orientation: dragging.orientation, position: dragging.position });
  if (lines.length === 0) return;

  ctx.save();
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (const line of lines) {
    if (line.orientation === 'vertical') {
      ctx.moveTo(line.position, 0);
      ctx.lineTo(line.position, doc.canvas.height);
    } else {
      ctx.moveTo(0, line.position);
      ctx.lineTo(doc.canvas.width, line.position);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Where a finished guide drag lands.
 *
 * **Dragging a guide off the page deletes it**, which is how every editor
 * disposes of one and the only gesture that does not need a second control.
 * That also settles what happens when a guide is pulled out of a ruler and let
 * go before it reaches the page: it is never created.
 */
function commitGuide(
  doc: DrawingDocument,
  guide: GuideDrag,
  onDocumentChange: (doc: DrawingDocument) => void,
): void {
  const limit = guide.orientation === 'horizontal' ? doc.canvas.height : doc.canvas.width;
  const onPage = guide.position >= 0 && guide.position <= limit;

  if (!guide.id) {
    if (onPage) onDocumentChange(addGuide(doc, { orientation: guide.orientation, position: guide.position }));
    return;
  }
  onDocumentChange(onPage
    ? moveGuide(doc, guide.id, guide.position)
    : removeGuide(doc, guide.id));
}

// ---------------------------------------------------------------------------
// Rulers
// ---------------------------------------------------------------------------

/**
 * The two ruler strips.
 *
 * Drawn in screen space and labelled in canvas units, so the numbers stay the
 * same size at every zoom while the marks they point at move. `rulerTicks`
 * chooses the spacing from the zoom, which is what keeps a ruler readable at 8%
 * and at 1600% without a special case for either.
 *
 * Ticks are laid out along the *axis*, so a rotated canvas is the one case this
 * cannot describe honestly — a ruler across the top of a canvas turned 30° is
 * measuring a direction the page no longer runs in. It is drawn anyway, against
 * the unrotated axis, because the alternative is a ruler that disappears when
 * the view is turned; the marks still say where the guides will land, which is
 * what they are used for.
 */
function drawRulers(
  top: HTMLCanvasElement | null,
  left: HTMLCanvasElement | null,
  doc: DrawingDocument,
  workspace: WorkspaceState,
  t: Transform,
): void {
  const ticks = rulerTicks(workspace.units, doc.canvas.dpi, t.scale);
  drawRuler(top, 'horizontal', doc, workspace, t, ticks);
  drawRuler(left, 'vertical', doc, workspace, t, ticks);
}

function drawRuler(
  canvas: HTMLCanvasElement | null,
  orientation: 'horizontal' | 'vertical',
  doc: DrawingDocument,
  workspace: WorkspaceState,
  t: Transform,
  ticks: { step: number; subdivisions: number },
): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;

  const length = orientation === 'horizontal' ? canvas.width : canvas.height;
  const offset = orientation === 'horizontal' ? t.x : t.y;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (orientation === 'horizontal') {
    ctx.moveTo(0, RULER_SIZE - 0.5);
    ctx.lineTo(canvas.width, RULER_SIZE - 0.5);
  } else {
    ctx.moveTo(RULER_SIZE - 0.5, 0);
    ctx.lineTo(RULER_SIZE - 0.5, canvas.height);
  }
  ctx.stroke();

  // The page itself, so the ruler shows where the canvas starts and ends.
  const extent = orientation === 'horizontal' ? doc.canvas.width : doc.canvas.height;
  ctx.fillStyle = '#f3f4f6';
  const pageStart = offset;
  const pageLength = extent * t.scale;
  if (orientation === 'horizontal') ctx.fillRect(pageStart, 0, pageLength, RULER_SIZE - 1);
  else ctx.fillRect(0, pageStart, RULER_SIZE - 1, pageLength);

  const minor = ticks.step / ticks.subdivisions;
  const firstCanvas = Math.floor((-offset / t.scale) / minor) * minor;
  const lastCanvas = (length - offset) / t.scale;

  ctx.strokeStyle = '#9ca3af';
  ctx.fillStyle = '#6b7280';
  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'top';

  for (let value = firstCanvas; value <= lastCanvas; value += minor) {
    const screen = Math.round(value * t.scale + offset) + 0.5;
    if (screen < 0 || screen > length) continue;
    // A major tick is one that lands on the labelled step. Compared with a
    // tolerance because the accumulating `+= minor` drifts by a float ulp or
    // two over a long ruler, and an exact modulo would drop labels at random.
    const major = Math.abs(value / ticks.step - Math.round(value / ticks.step)) < 1e-6;
    const size = major ? RULER_SIZE - 6 : RULER_SIZE / 3;

    ctx.beginPath();
    if (orientation === 'horizontal') {
      ctx.moveTo(screen, RULER_SIZE - 1);
      ctx.lineTo(screen, RULER_SIZE - 1 - size);
    } else {
      ctx.moveTo(RULER_SIZE - 1, screen);
      ctx.lineTo(RULER_SIZE - 1 - size, screen);
    }
    ctx.stroke();

    if (!major) continue;
    const label = formatTick(value, workspace, doc.canvas.dpi);
    if (orientation === 'horizontal') {
      ctx.fillText(label, screen + 2, 2);
    } else {
      // Rotated so a vertical ruler's numbers read along the ruler rather than
      // one digit per line down it.
      ctx.save();
      ctx.translate(3, screen + 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  // Guides marked on the ruler, so one hidden behind a layer is still findable.
  if (workspace.showGuides) {
    ctx.fillStyle = GUIDE_COLOR;
    const wanted = orientation === 'horizontal' ? 'vertical' : 'horizontal';
    for (const guide of doc.guides) {
      if (guide.orientation !== wanted) continue;
      const screen = Math.round(guide.position * t.scale + offset);
      if (screen < 0 || screen > length) continue;
      if (orientation === 'horizontal') ctx.fillRect(screen - 1, RULER_SIZE - 4, 2, 3);
      else ctx.fillRect(RULER_SIZE - 4, screen - 1, 3, 2);
    }
  }
}

/** A tick's number, without the unit — the unit is on the corner box. */
function formatTick(value: number, workspace: WorkspaceState, dpi: number): string {
  const measure = toUnits(value, workspace.units, dpi);
  return workspace.units === 'px' ? String(Math.round(measure)) : String(Math.round(measure * 100) / 100);
}

/**
 * The stroke in progress, drawn over the layer it belongs to.
 *
 * A layer stroke replaces the layer, because the session's preview already
 * holds the layer's pixels with the stroke composited — which is the only way
 * an eraser can be shown before it is committed. A **mask** stroke is drawn as a
 * translucent red wash instead: a mask is a channel and has no appearance of its
 * own, and tinting the area being revealed is how every editor makes one
 * visible while it is being painted.
 */
function drawPaintPreview(ctx: CanvasRenderingContext2D, paint: PaintState): void {
  const surface = paint.session.preview();
  if (!surface) return;

  ctx.save();
  if (paint.mode === 'mask') {
    ctx.globalAlpha = 0.5;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(surface as CanvasImageSource, paint.rect.x, paint.rect.y, paint.rect.width, paint.rect.height);
  ctx.restore();
}

/**
 * The active pixel selection, as marching ants.
 *
 * Two passes — a solid light line, then a dashed dark one over it — so the
 * boundary reads against both a white canvas and a dark drawing. `phase` walks
 * the dash offset, which is the movement that says "this is a live selection"
 * rather than "somebody drew a dotted rectangle".
 */
function drawMarchingAnts(
  ctx: CanvasRenderingContext2D,
  shape: SelectionShape,
  scale: number,
  phase: number,
): void {
  ctx.save();
  if (shape.kind === 'mask') {
    // A mask has no outline to trace, so its extent is shown instead. Deriving
    // the true boundary would mean tracing the channel's alpha every frame.
    const { x, y, width, height } = shape.source;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
  } else if (!traceSelection(ctx, shape)) {
    ctx.restore();
    return;
  }

  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  ctx.setLineDash([4 / scale, 4 / scale]);
  ctx.lineDashOffset = phase / scale;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.stroke();
  ctx.restore();
}

/** A path's anchors and control handles, for direct editing. */
function drawPathNodes(ctx: CanvasRenderingContext2D, object: PathObject, scale: number): void {
  const size = HANDLE_SIZE / scale;
  ctx.save();
  ctx.lineWidth = 1 / scale;

  for (const contour of pathContours(object)) {
    for (const point of contour.points) {
      for (const handle of [point.in, point.out]) {
        if (!handle) continue;
        ctx.strokeStyle = 'rgba(124,58,237,0.6)';
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(handle.x, handle.y);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = NODE_COLOR;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, size / 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Anchors last so they sit above the handle lines crossing them.
  for (const contour of pathContours(object)) {
    for (const point of contour.points) {
      ctx.fillStyle = point.in || point.out ? NODE_COLOR : '#ffffff';
      ctx.strokeStyle = NODE_COLOR;
      ctx.beginPath();
      ctx.rect(point.x - size / 2, point.y - size / 2, size, size);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  doc: DrawingDocument,
  selection: Selection,
  scale: number,
): void {
  const frame = selectionFrame(doc, selection);
  if (!frame) return;

  ctx.save();
  if (frame.rotation) {
    ctx.translate(frame.center.x, frame.center.y);
    ctx.rotate((frame.rotation * Math.PI) / 180);
    ctx.translate(-frame.center.x, -frame.center.y);
  }

  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([4 / scale, 3 / scale]);
  ctx.strokeRect(frame.rect.x, frame.rect.y, frame.rect.width, frame.rect.height);
  ctx.setLineDash([]);

  if (frame.resizable) {
    const size = HANDLE_SIZE / scale;
    const handles = handlePositions(frame.rect);
    ctx.fillStyle = '#ffffff';
    for (const key of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[]) {
      const p = handles[key];
      ctx.beginPath();
      ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.fill();
      ctx.stroke();
    }

    const rotate = handles.rotate;
    ctx.beginPath();
    ctx.moveTo(frame.rect.x + frame.rect.width / 2, frame.rect.y);
    ctx.lineTo(rotate.x, rotate.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rotate.x, rotate.y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = SELECTION_COLOR;
    ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

function extendSelection(current: Selection, hit: Hit, additive: boolean): Selection {
  if (hit.kind === 'object') {
    const sameLayer = current?.kind === 'objects' && current.layerId === hit.layerId;
    if (additive && sameLayer) {
      const ids = current.ids.includes(hit.object.id)
        ? current.ids.filter((id) => id !== hit.object.id)
        : [...current.ids, hit.object.id];
      return ids.length ? { kind: 'objects', layerId: hit.layerId, ids } : null;
    }
    if (sameLayer && current.ids.includes(hit.object.id)) return current;
    return { kind: 'objects', layerId: hit.layerId, ids: [hit.object.id] };
  }

  if (additive && current?.kind === 'nodes') {
    const ids = current.ids.includes(hit.node.id)
      ? current.ids.filter((id) => id !== hit.node.id)
      : [...current.ids, hit.node.id];
    return ids.length ? { kind: 'nodes', ids } : null;
  }
  if (current?.kind === 'nodes' && current.ids.includes(hit.node.id)) return current;
  return { kind: 'nodes', ids: [hit.node.id] };
}

/**
 * What a marquee caught.
 *
 * Objects on the active layer win over whole nodes: a rubber band inside a
 * drawing almost always means "these shapes", and returning a mix of objects
 * and layers would give the style panel two different things to edit at once.
 */
function marqueeSelection(
  doc: DrawingDocument,
  marquee: Rect,
  activeLayerId: string,
  additiveTo: Selection,
): Selection {
  const layer = findNode(doc.root, activeLayerId);
  if (layer && layer.type === 'vector') {
    const ids = layer.objects
      .filter((o) => o.visible && !o.locked && rectsIntersect(objectSelectionBox(o), marquee))
      .map((o) => o.id);
    if (ids.length > 0) {
      const existing = additiveTo?.kind === 'objects' && additiveTo.layerId === activeLayerId
        ? additiveTo.ids
        : [];
      return { kind: 'objects', layerId: activeLayerId, ids: [...new Set([...existing, ...ids])] };
    }
  }

  const symbols = symbolTable(doc);
  const nodeIds: string[] = [];
  for (const child of doc.root.children) {
    if (child.type === 'vector') continue;
    if (!isEffectivelyVisible(doc.root, child.id)) continue;
    const bounds = nodeCanvasBounds(doc.root, child, symbols);
    if (bounds && rectsIntersect(bounds, marquee)) nodeIds.push(child.id);
  }
  if (nodeIds.length === 0) return null;
  const existing = additiveTo?.kind === 'nodes' ? additiveTo.ids : [];
  return { kind: 'nodes', ids: [...new Set([...existing, ...nodeIds])] };
}

/**
 * The document with a resize applied.
 *
 * Only ever one target — `selectionFrame` withholds handles from a
 * multi-selection, because resizing several rotated objects against one box
 * needs a transform per object and there is no UI for the result.
 */
function applyResize(
  original: DrawingDocument,
  selection: Selection,
  drag: DragState,
  point: Point,
): DrawingDocument {
  const frame = selectionFrame(original, selection);
  if (!frame || !selection || !drag.handle) return original;

  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  const next = resizeRect(frame.rect, drag.handle, dx, dy);

  if (selection.kind === 'objects') {
    return mapObjects(original, selection.layerId, selection.ids, (object) =>
      resizeObject(object, next));
  }

  // A node has no frame to set, so the resize becomes a scale about the corner
  // opposite the handle — the anchor the gesture holds still. Expressing it as
  // a matrix is what makes a raster or text layer scalable at all; before this
  // the handles could only move a node.
  const node = findNode(original.root, selection.ids[0]);
  if (!node) return original;

  const anchor = anchorFor(frame.rect, drag.handle);
  // A zero-sized frame has no ratio to scale by, and dividing through it would
  // put NaN in the matrix and lose the layer entirely.
  const scaleX = frame.rect.width === 0 ? 1 : next.width / frame.rect.width;
  const scaleY = frame.rect.height === 0 ? 1 : next.height / frame.rect.height;
  const safeX = drag.handle === 'n' || drag.handle === 's' ? 1 : scaleX;
  const safeY = drag.handle === 'e' || drag.handle === 'w' ? 1 : scaleY;
  if (!Number.isFinite(safeX) || !Number.isFinite(safeY) || safeX === 0 || safeY === 0) return original;

  return transformNode(original, node.id, scaleAbout(safeX, safeY, anchor));
}

/** Whether a dragged-out selection covers anything, or was really just a click. */
function isMeaningfulSelection(draft: SelectionShape | undefined): draft is SelectionShape {
  if (!draft) return false;
  switch (draft.kind) {
    case 'lasso': return draft.points.length > 2;
    case 'mask': return draft.source.width > 0 && draft.source.height > 0;
    default: return draft.rect.width > 1 && draft.rect.height > 1;
  }
}

function resizeRect(rect: Rect, handle: ResizeHandle, dx: number, dy: number): Rect {
  let { x, y, width, height } = rect;
  if (handle.includes('n')) { y += dy; height -= dy; }
  if (handle.includes('s')) { height += dy; }
  if (handle.includes('w')) { x += dx; width -= dx; }
  if (handle.includes('e')) { width += dx; }
  return normalizeRect({ x, y, width, height });
}

// ---------------------------------------------------------------------------
// Path editing
// ---------------------------------------------------------------------------

/**
 * One anchor or handle dragged to a new position.
 *
 * Dragging an **anchor** carries its handles with it, so the curvature either
 * side is preserved — moving the anchor alone reshapes both adjacent spans in a
 * way nobody asked for. Dragging a **handle** moves only that handle, and
 * mirrors the opposite one when the point is smooth, which is what keeps a
 * smooth point smooth.
 */
function dragPathPoint(
  object: PathObject,
  target: NodeTarget,
  point: Point,
  drag: DragState,
): PathObject {
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;

  return updatePathPoint(object, target, (original) => {
    if (target.part === 'anchor') {
      const moved: PathPoint = { x: original.x + dx, y: original.y + dy };
      if (original.in) moved.in = { x: original.in.x + dx, y: original.in.y + dy };
      if (original.out) moved.out = { x: original.out.x + dx, y: original.out.y + dy };
      return moved;
    }

    const handle = original[target.part];
    if (!handle) return original;
    const next: PathPoint = { ...original, [target.part]: { x: handle.x + dx, y: handle.y + dy } };

    const opposite = target.part === 'in' ? 'out' : 'in';
    if (original[opposite]) {
      // Mirrored through the anchor at the same distance it already had, so
      // pulling one handle rotates the pair without changing the other's
      // weight — the standard behaviour of a smooth point.
      const moved = next[target.part]!;
      const length = Math.hypot(original[opposite]!.x - original.x, original[opposite]!.y - original.y);
      const reach = Math.hypot(moved.x - original.x, moved.y - original.y);
      if (reach > 0) {
        next[opposite] = {
          x: original.x - ((moved.x - original.x) / reach) * length,
          y: original.y - ((moved.y - original.y) / reach) * length,
        };
      }
    }
    return next;
  });
}

/**
 * An anchor turned from a corner into a smooth point, or back.
 *
 * A corner gains handles pointing along the line to each neighbour, at a third
 * of the distance — which is the cubic that most nearly reproduces the straight
 * spans it replaces, so toggling a point does not jerk the path.
 */
function toggleSmooth(object: PathObject, target: NodeTarget): PathObject {
  const contours = pathContours(object);
  const contour = contours[target.contour];
  if (!contour) return object;
  const points = contour.points;
  const at = points[target.index];
  if (!at) return object;

  if (at.in || at.out) {
    return updatePathPoint(object, target, ({ x, y }) => ({ x, y }));
  }

  const previous = points[(target.index - 1 + points.length) % points.length];
  const next = points[(target.index + 1) % points.length];
  return updatePathPoint(object, target, (point) => ({
    ...point,
    in: { x: point.x + (previous.x - point.x) / 3, y: point.y + (previous.y - point.y) / 3 },
    out: { x: point.x + (next.x - point.x) / 3, y: point.y + (next.y - point.y) / 3 },
  }));
}

// ---------------------------------------------------------------------------

/** Rewrites a text layer's content, keeping its layer name in step. */
function setTextContent(doc: DrawingDocument, id: string, text: string): DrawingDocument {
  return setNodeProps(patchTextLayer(doc, id, { text }), id, { name: text.slice(0, 24) });
}

function surfaceToBlob(surface: Surface): Promise<Blob> {
  const canvas = surface as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob produced nothing'));
    }, 'image/png');
  });
}

export { editablePath, hitTest, nodeTargetAt, selectionFrame };
