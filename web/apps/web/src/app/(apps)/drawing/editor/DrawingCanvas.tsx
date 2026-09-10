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
} from './document/tree';
import {
  addNode,
  addObjects,
  deleteNode,
  mapObjects,
  patchTextLayer,
  removeObjects,
  resizeObject,
  setNodeProps,
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
  unionRects,
  unrotatePoint,
} from './document/geometry';
import { drawVectorObject, hitTestObject, objectSelectionBox } from './render/vectorObject';
import { documentToSvg } from './render/documentSvg';
import { domSurfaceFactory, renderDocument, type Surface } from './render/renderDocument';
import type {
  DrawingDocument,
  DrawingNode,
  Point,
  Rect,
  ResizeHandle,
  Selection,
  ToolType,
  Transform,
  VectorObject,
  VectorStyle,
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
}

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 22;
const SELECTION_COLOR = '#2563eb';
const MIN_SCALE = 0.05;
const MAX_SCALE = 16;

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

  const rects = selection.ids
    .map((id) => findNode(doc.root, id))
    .filter((n): n is DrawingNode => n !== null)
    .map((node) => nodeCanvasBounds(doc.root, node));
  const rect = unionRects(rects);
  if (!rect) return null;
  return { rect, rotation: 0, center: rectCenter(rect), resizable: selection.ids.length === 1 };
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

    const bounds = nodeCanvasBounds(doc.root, node);
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
  | 'erasing';

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
}

const IDLE: DragState = { mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0 };

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
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
    const dragRef = useRef<DragState>(IDLE);
    const spaceRef = useRef(false);
    /** The shape being dragged out, drawn on top but not yet in the document. */
    const draftRef = useRef<VectorObject | null>(null);

    // Event handlers are registered once and read live values through refs, so
    // the listeners never need re-binding mid-drag.
    const docRef = useRef(doc);
    const toolRef = useRef(tool);
    const selectionRef = useRef(selection);
    const activeLayerRef = useRef(activeLayerId);
    const styleRef = useRef(newObjectStyle);
    const bitmapsRef = useRef(bitmaps);
    const imagesRef = useRef(images);
    docRef.current = doc;
    toolRef.current = tool;
    selectionRef.current = selection;
    activeLayerRef.current = activeLayerId;
    styleRef.current = newObjectStyle;
    bitmapsRef.current = bitmaps;
    imagesRef.current = images;

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

      renderDocument(ctx, document_, {
        bitmaps: bitmapsRef.current,
        images: imagesRef.current,
        // The background is already painted as the page, above.
        drawBackground: false,
        skipNodeIds: textEditRef.current?.nodeId
          ? new Set([textEditRef.current.nodeId])
          : undefined,
      });

      if (draftRef.current) drawVectorObject(ctx, draftRef.current, imagesRef.current);

      if (document_.grid.visible) drawGrid(ctx, document_, t.scale);
      ctx.restore();

      drawPageBorder(ctx, document_, t.scale);
      drawGuides(ctx, document_, t.scale);
      drawSelection(ctx, document_, selectionRef.current, t.scale);

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

    useEffect(() => { render(); }, [doc, selection, bitmaps, images, textEdit, render]);

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

    const canvasPoint = useCallback((e: MouseEvent): Point => {
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

    const onMouseDown = useCallback((e: MouseEvent) => {
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

      if (currentTool === 'text') {
        beginTextEdit(point);
        return;
      }

      if (currentTool === 'eraser') {
        dragRef.current = { ...IDLE, mode: 'erasing', startX: point.x, startY: point.y, lastX: point.x, lastY: point.y };
        eraseAt(point);
        return;
      }

      if (currentTool === 'select') {
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

      // A drawing tool. The draft lives outside the document until the mouse is
      // released, so a drag that produces nothing leaves no undo step behind.
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
    }, [beginTextEdit, canvasPoint, commitText, findHandle, onSelectionChange, render]);

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

    const onMouseMove = useCallback((e: MouseEvent) => {
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
          if (!original || !current || current.kind !== 'objects') return;
          const frame = selectionFrame(original, current);
          if (!frame) return;
          const angle = (Math.atan2(point.y - frame.center.y, point.x - frame.center.x) * 180) / Math.PI + 90;
          onDocumentChange(mapObjects(original, current.layerId, current.ids, (object) => ({
            ...object,
            rotation: Math.round(angle),
          })));
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

    const onMouseUp = useCallback((e: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.mode === 'none') return;
      const document_ = docRef.current;

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
    }, [onDocumentChange, onSelectionChange, render]);

    const onDoubleClick = useCallback((e: MouseEvent) => {
      if (toolRef.current !== 'select') return;
      const point = canvasPoint(e);
      const hit = hitTest(docRef.current, point);
      if (hit?.kind === 'node' && hit.node.type === 'text') {
        onToolChange('text');
        beginTextEdit(point);
      }
    }, [beginTextEdit, canvasPoint, onToolChange]);

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

      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('dblclick', onDoubleClick);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);

      return () => {
        observer.disconnect();
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('dblclick', onDoubleClick);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
      };
    }, [onDoubleClick, onMouseDown, onMouseMove, onMouseUp, onWheel, render]);

    // ---------------------------------------------------------------------

    const cursor = spaceRef.current ? 'grab'
      : tool === 'select' ? 'default'
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
        <canvas ref={canvasRef} style={{ display: 'block', cursor }} />
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

  const nodeIds: string[] = [];
  for (const child of doc.root.children) {
    if (child.type === 'vector') continue;
    if (!isEffectivelyVisible(doc.root, child.id)) continue;
    const bounds = nodeCanvasBounds(doc.root, child);
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
 * needs a transform per object and this phase has no UI for the result.
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

  // A node has no frame to set, so the difference is expressed as a move. A
  // true node resize needs a transform, which arrives with the transform tool
  // in phase 4.
  const node = findNode(original.root, selection.ids[0]);
  if (!node) return original;
  return translateNode(original, node.id, next.x - frame.rect.x, next.y - frame.rect.y);
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

export { hitTest, selectionFrame };
