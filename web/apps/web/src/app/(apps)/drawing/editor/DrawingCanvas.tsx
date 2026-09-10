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

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

function screenToCanvas(sx: number, sy: number, t: Transform): Point {
  return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
}

/** Snaps a coordinate to the grid on one axis. The origin differs per axis. */
function snapTo(value: number, doc: DrawingDocument, axis: 'x' | 'y'): number {
  if (!doc.grid.snap) return value;
  const size = doc.grid.size || 1;
  const origin = doc.grid.origin[axis];
  return Math.round((value - origin) / size) * size + origin;
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
  | 'node';

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
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
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
      const { width, height } = canvas;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);

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
      drawGuides(ctx, document_, t.scale);

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
      const margin = 48;
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
    // canvas half off-screen.
    const centredRef = useRef(false);
    useEffect(() => {
      if (centredRef.current) return;
      centredRef.current = true;
      fitToScreen();
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
      return screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, transformRef.current);
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
      const x = snapTo(point.x, document_, 'x');
      const y = snapTo(point.y, document_, 'y');
      const style = styleRef.current;

      draftRef.current =
        currentTool === 'pen' ? createPath([{ x: point.x, y: point.y }], style)
        : currentTool === 'rectangle' ? createRect({ x, y, width: 0, height: 0 }, style)
        : currentTool === 'ellipse' ? createEllipse({ x, y, width: 0, height: 0 }, style)
        : createLine({ x, y, width: 0, height: 0 }, { arrowEnd: currentTool === 'arrow' }, style);

      dragRef.current = { ...IDLE, mode: 'drawing', startX: x, startY: y, lastX: x, lastY: y };
      render();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [beginPaint, beginTextEdit, canvasPoint, commitText, eraseAt, findHandle, onSelectionChange, render]);

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
            const x = snapTo(point.x, document_, 'x');
            const y = snapTo(point.y, document_, 'y');
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
      canvasRef.current?.releasePointerCapture?.(e.pointerId);

      if (drag.mode === 'painting') {
        const point = canvasPoint(e);
        paintRef.current?.session.end(strokePoint(point.x, point.y, e.pressure));
        dragRef.current = IDLE;
        finishPaint();
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

    const t = transformRef.current;
    const editorStyle: React.CSSProperties | null = textEdit
      ? {
          position: 'absolute',
          left: textEdit.box.x * t.scale + t.x,
          top: textEdit.box.y * t.scale + t.y,
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

function drawGuides(ctx: CanvasRenderingContext2D, doc: DrawingDocument, scale: number): void {
  if (doc.guides.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (const guide of doc.guides) {
    if (guide.orientation === 'vertical') {
      ctx.moveTo(guide.position, 0);
      ctx.lineTo(guide.position, doc.canvas.height);
    } else {
      ctx.moveTo(0, guide.position);
      ctx.lineTo(doc.canvas.width, guide.position);
    }
  }
  ctx.stroke();
  ctx.restore();
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
