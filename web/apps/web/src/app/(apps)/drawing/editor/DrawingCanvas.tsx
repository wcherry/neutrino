'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Shape, ToolType, Transform, Point, ResizeHandle } from './types';

interface DrawingCanvasProps {
  shapes: Shape[];
  tool: ToolType;
  selectedIds: string[];
  onShapesChange: (shapes: Shape[]) => void;
  onSelectionChange: (ids: string[]) => void;
  onTransformChange?: (t: Transform) => void;
}

const GRID_SIZE = 16;
const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 20;

function screenToCanvas(sx: number, sy: number, t: Transform): Point {
  return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
}

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getBounds(shape: Shape): { x: number; y: number; w: number; h: number } {
  if (shape.type === 'pen' && shape.points.length > 0) {
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x || 1;
    const h = Math.max(...ys) - y || 1;
    return { x, y, w, h };
  }
  return { x: shape.x, y: shape.y, w: shape.width || 1, h: shape.height || 1 };
}

function hitTest(shape: Shape, cx: number, cy: number): boolean {
  if (shape.type === 'pen') {
    return shape.points.some((p) => Math.hypot(p.x - cx, p.y - cy) < 8);
  }
  const { x, y, w, h } = getBounds(shape);
  const pad = 4;
  return cx >= x - pad && cx <= x + w + pad && cy >= y - pad && cy <= y + h + pad;
}

function getHandlePositions(
  x: number,
  y: number,
  w: number,
  h: number,
): Record<ResizeHandle, { x: number; y: number }> {
  return {
    nw:     { x,           y           },
    n:      { x: x + w / 2, y          },
    ne:     { x: x + w,     y          },
    e:      { x: x + w,     y: y + h / 2 },
    se:     { x: x + w,     y: y + h   },
    s:      { x: x + w / 2, y: y + h   },
    sw:     { x,             y: y + h   },
    w:      { x,             y: y + h / 2 },
    rotate: { x: x + w / 2, y: y - ROTATE_OFFSET },
  };
}

function hitTestHandle(
  hx: number,
  hy: number,
  cx: number,
  cy: number,
  isRotate: boolean,
): boolean {
  const r = isRotate ? HANDLE_SIZE : HANDLE_SIZE / 2 + 2;
  return Math.abs(hx - cx) <= r && Math.abs(hy - cy) <= r;
}

function renderShape(ctx: CanvasRenderingContext2D, shape: Shape, isSelected: boolean) {
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;
  ctx.strokeStyle = shape.stroke || '#000000';
  ctx.lineWidth = shape.strokeWidth || 2;
  ctx.fillStyle = shape.fill || 'transparent';

  const { x, y, w, h } = getBounds(shape);
  const cx = x + w / 2;
  const cy = y + h / 2;

  if (shape.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  switch (shape.type) {
    case 'rectangle': {
      ctx.beginPath();
      ctx.rect(shape.x, shape.y, shape.width, shape.height);
      if (shape.fill && shape.fill !== 'transparent') ctx.fill();
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      const rx = Math.abs(shape.width) / 2;
      const ry = Math.abs(shape.height) / 2;
      const ecx = shape.x + shape.width / 2;
      const ecy = shape.y + shape.height / 2;
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, rx || 1, ry || 1, 0, 0, Math.PI * 2);
      if (shape.fill && shape.fill !== 'transparent') ctx.fill();
      ctx.stroke();
      break;
    }
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(shape.x, shape.y);
      ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const ex = shape.x + shape.width;
      const ey = shape.y + shape.height;
      const angle = Math.atan2(ey - shape.y, ex - shape.x);
      const headLen = 14;
      ctx.beginPath();
      ctx.moveTo(shape.x, shape.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - headLen * Math.cos(angle - Math.PI / 6),
        ey - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        ex - headLen * Math.cos(angle + Math.PI / 6),
        ey - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fillStyle = shape.stroke || '#000000';
      ctx.fill();
      break;
    }
    case 'pen': {
      if (shape.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      const fontSize = Math.abs(shape.height) || 16;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = shape.stroke || '#000000';
      ctx.fillText(shape.text || '', shape.x, shape.y + fontSize);
      break;
    }
  }

  ctx.restore();

  if (isSelected) {
    renderHandles(ctx, shape);
  }
}

function renderHandles(ctx: CanvasRenderingContext2D, shape: Shape) {
  const { x, y, w, h } = getBounds(shape);
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.5;

  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.setLineDash([]);

  const handles = getHandlePositions(x, y, w, h);
  const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  for (const key of resizeHandles) {
    const hp = handles[key];
    ctx.beginPath();
    ctx.rect(hp.x - HANDLE_SIZE / 2, hp.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }

  const rp = handles.rotate;
  ctx.beginPath();
  ctx.arc(rp.x, rp.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#2563eb';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(rp.x, rp.y);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function renderGrid(ctx: CanvasRenderingContext2D, transform: Transform, width: number, height: number) {
  if (transform.scale < 0.3) return;
  ctx.save();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 0.5;

  const startX = Math.floor(-transform.x / transform.scale / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(-transform.y / transform.scale / GRID_SIZE) * GRID_SIZE;
  const endX = startX + width / transform.scale + GRID_SIZE * 2;
  const endY = startY + height / transform.scale + GRID_SIZE * 2;

  for (let gx = startX; gx <= endX; gx += GRID_SIZE) {
    const sx = gx * transform.scale + transform.x;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
  }
  for (let gy = startY; gy <= endY; gy += GRID_SIZE) {
    const sy = gy * transform.scale + transform.y;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
  }

  ctx.restore();
}

type DragMode = 'none' | 'drawing' | 'moving' | 'resizing' | 'rotating' | 'box-select' | 'panning';

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  handle?: ResizeHandle;
  initialShapes?: Shape[];
  boxX?: number;
  boxY?: number;
  boxW?: number;
  boxH?: number;
  penShapeId?: string;
}

export function DrawingCanvas({
  shapes,
  tool,
  selectedIds,
  onShapesChange,
  onSelectionChange,
  onTransformChange,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const shapesRef = useRef(shapes);
  const toolRef = useRef(tool);
  const selectedIdsRef = useRef(selectedIds);
  const dragRef = useRef<DragState>({ mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0 });
  const spaceDownRef = useRef(false);
  const currentShapeRef = useRef<Shape | null>(null);

  const [, forceRender] = useState(0);

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    const t = transformRef.current;

    ctx.clearRect(0, 0, width, height);
    renderGrid(ctx, t, width, height);

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);

    for (const shape of shapesRef.current) {
      renderShape(ctx, shape, selectedIdsRef.current.includes(shape.id));
    }
    if (currentShapeRef.current) {
      renderShape(ctx, currentShapeRef.current, false);
    }

    const drag = dragRef.current;
    if (drag.mode === 'box-select' && drag.boxW !== undefined && drag.boxH !== undefined) {
      ctx.save();
      ctx.fillStyle = 'rgba(37,99,235,0.08)';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1 / t.scale;
      ctx.setLineDash([4 / t.scale, 3 / t.scale]);
      ctx.fillRect(drag.boxX!, drag.boxY!, drag.boxW, drag.boxH);
      ctx.strokeRect(drag.boxX!, drag.boxY!, drag.boxW, drag.boxH);
      ctx.restore();
    }

    ctx.restore();
  }, []);

  useEffect(() => { render(); }, [shapes, selectedIds, render]);

  const getCanvasPos = useCallback((e: MouseEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, transformRef.current);
  }, []);

  const findHitHandle = useCallback(
    (cp: Point): { shapeId: string; handle: ResizeHandle } | null => {
      for (const id of selectedIdsRef.current) {
        const shape = shapesRef.current.find((s) => s.id === id);
        if (!shape) continue;
        const { x, y, w, h } = getBounds(shape);
        const handles = getHandlePositions(x, y, w, h);
        for (const [key, hp] of Object.entries(handles) as [ResizeHandle, Point][]) {
          if (hitTestHandle(hp.x, hp.y, cp.x, cp.y, key === 'rotate')) {
            return { shapeId: id, handle: key };
          }
        }
      }
      return null;
    },
    [],
  );

  const onMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
        dragRef.current = {
          mode: 'panning',
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
        };
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      const cp = getCanvasPos(e);
      const currentTool = toolRef.current;

      if (currentTool === 'select') {
        const hitHandle = findHitHandle(cp);
        if (hitHandle) {
          const initialShapes = shapesRef.current.map((s) => ({ ...s, points: [...s.points] }));
          if (hitHandle.handle === 'rotate') {
            dragRef.current = {
              mode: 'rotating',
              startX: cp.x, startY: cp.y,
              lastX: cp.x, lastY: cp.y,
              handle: hitHandle.handle,
              initialShapes,
            };
          } else {
            dragRef.current = {
              mode: 'resizing',
              startX: cp.x, startY: cp.y,
              lastX: cp.x, lastY: cp.y,
              handle: hitHandle.handle,
              initialShapes,
            };
          }
          return;
        }

        const hit = [...shapesRef.current].reverse().find((s) => hitTest(s, cp.x, cp.y));
        if (hit) {
          const newSel = e.shiftKey
            ? selectedIdsRef.current.includes(hit.id)
              ? selectedIdsRef.current.filter((id) => id !== hit.id)
              : [...selectedIdsRef.current, hit.id]
            : selectedIdsRef.current.includes(hit.id)
            ? selectedIdsRef.current
            : [hit.id];
          onSelectionChange(newSel);
          const initialShapes = shapesRef.current.map((s) => ({ ...s, points: [...s.points] }));
          dragRef.current = {
            mode: 'moving',
            startX: cp.x, startY: cp.y,
            lastX: cp.x, lastY: cp.y,
            initialShapes,
          };
        } else {
          if (!e.shiftKey) onSelectionChange([]);
          dragRef.current = {
            mode: 'box-select',
            startX: cp.x, startY: cp.y,
            lastX: cp.x, lastY: cp.y,
            boxX: cp.x, boxY: cp.y, boxW: 0, boxH: 0,
          };
        }
        return;
      }

      if (currentTool === 'eraser') {
        const hit = [...shapesRef.current].reverse().find((s) => hitTest(s, cp.x, cp.y));
        if (hit) {
          onShapesChange(shapesRef.current.filter((s) => s.id !== hit.id));
          onSelectionChange(selectedIdsRef.current.filter((id) => id !== hit.id));
        }
        dragRef.current = { mode: 'drawing', startX: cp.x, startY: cp.y, lastX: cp.x, lastY: cp.y };
        return;
      }

      const snappedX = snapToGrid(cp.x);
      const snappedY = snapToGrid(cp.y);

      if (currentTool === 'pen') {
        const newShape: Shape = {
          id: generateId(),
          type: 'pen',
          x: snappedX, y: snappedY,
          width: 0, height: 0,
          points: [{ x: snappedX, y: snappedY }],
          text: '',
          fill: 'transparent',
          stroke: '#000000',
          strokeWidth: 2,
          rotation: 0,
          opacity: 1,
        };
        currentShapeRef.current = newShape;
        dragRef.current = {
          mode: 'drawing',
          startX: snappedX, startY: snappedY,
          lastX: snappedX, lastY: snappedY,
          penShapeId: newShape.id,
        };
      } else if (currentTool === 'text') {
        const text = window.prompt('Enter text:');
        if (text) {
          const newShape: Shape = {
            id: generateId(),
            type: 'text',
            x: snappedX, y: snappedY,
            width: 100, height: 20,
            points: [],
            text,
            fill: 'transparent',
            stroke: '#000000',
            strokeWidth: 1,
            rotation: 0,
            opacity: 1,
          };
          onShapesChange([...shapesRef.current, newShape]);
          onSelectionChange([newShape.id]);
        }
      } else {
        const shapeType = currentTool as Shape['type'];
        const newShape: Shape = {
          id: generateId(),
          type: shapeType,
          x: snappedX, y: snappedY,
          width: 0, height: 0,
          points: [],
          text: '',
          fill: 'transparent',
          stroke: '#000000',
          strokeWidth: 2,
          rotation: 0,
          opacity: 1,
        };
        currentShapeRef.current = newShape;
        dragRef.current = {
          mode: 'drawing',
          startX: snappedX, startY: snappedY,
          lastX: snappedX, lastY: snappedY,
        };
      }
      render();
    },
    [getCanvasPos, findHitHandle, onSelectionChange, onShapesChange, render],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.mode === 'none') return;

      if (drag.mode === 'panning') {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        transformRef.current = {
          ...transformRef.current,
          x: transformRef.current.x + dx,
          y: transformRef.current.y + dy,
        };
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        onTransformChange?.(transformRef.current);
        render();
        return;
      }

      const cp = getCanvasPos(e);

      if (drag.mode === 'drawing') {
        const cur = currentShapeRef.current;
        if (!cur) {
          if (toolRef.current === 'eraser') {
            const hit = [...shapesRef.current].reverse().find((s) => hitTest(s, cp.x, cp.y));
            if (hit) {
              onShapesChange(shapesRef.current.filter((s) => s.id !== hit.id));
              onSelectionChange(selectedIdsRef.current.filter((id) => id !== hit.id));
            }
          }
          return;
        }
        const sx = drag.startX;
        const sy = drag.startY;

        if (cur.type === 'pen') {
          cur.points.push({ x: cp.x, y: cp.y });
        } else {
          const snappedX2 = snapToGrid(cp.x);
          const snappedY2 = snapToGrid(cp.y);
          cur.x = Math.min(sx, snappedX2);
          cur.y = Math.min(sy, snappedY2);
          cur.width = Math.abs(snappedX2 - sx);
          cur.height = Math.abs(snappedY2 - sy);
          if (cur.type === 'line' || cur.type === 'arrow') {
            cur.x = sx;
            cur.y = sy;
            cur.width = snappedX2 - sx;
            cur.height = snappedY2 - sy;
          }
        }
        render();
        return;
      }

      if (drag.mode === 'moving' && drag.initialShapes) {
        const dx = cp.x - drag.startX;
        const dy = cp.y - drag.startY;
        const updated = shapesRef.current.map((s) => {
          if (!selectedIdsRef.current.includes(s.id)) return s;
          const orig = drag.initialShapes!.find((o) => o.id === s.id);
          if (!orig) return s;
          if (s.type === 'pen') {
            return {
              ...s,
              x: orig.x + dx,
              y: orig.y + dy,
              points: orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            };
          }
          return { ...s, x: snapToGrid(orig.x + dx), y: snapToGrid(orig.y + dy) };
        });
        onShapesChange(updated);
        return;
      }

      if (drag.mode === 'resizing' && drag.initialShapes && drag.handle) {
        const targetId = selectedIdsRef.current[0];
        if (!targetId) return;
        const orig = drag.initialShapes.find((s) => s.id === targetId);
        if (!orig) return;
        const dx = cp.x - drag.startX;
        const dy = cp.y - drag.startY;
        let { x, y, width: w, height: h } = orig;

        switch (drag.handle) {
          case 'se': w = snapToGrid(orig.width + dx); h = snapToGrid(orig.height + dy); break;
          case 'sw': x = snapToGrid(orig.x + dx); w = snapToGrid(orig.width - dx); h = snapToGrid(orig.height + dy); break;
          case 'ne': w = snapToGrid(orig.width + dx); y = snapToGrid(orig.y + dy); h = snapToGrid(orig.height - dy); break;
          case 'nw': x = snapToGrid(orig.x + dx); y = snapToGrid(orig.y + dy); w = snapToGrid(orig.width - dx); h = snapToGrid(orig.height - dy); break;
          case 'e':  w = snapToGrid(orig.width + dx); break;
          case 'w':  x = snapToGrid(orig.x + dx); w = snapToGrid(orig.width - dx); break;
          case 's':  h = snapToGrid(orig.height + dy); break;
          case 'n':  y = snapToGrid(orig.y + dy); h = snapToGrid(orig.height - dy); break;
        }
        onShapesChange(
          shapesRef.current.map((s) =>
            s.id === targetId ? { ...s, x, y, width: w, height: h } : s,
          ),
        );
        return;
      }

      if (drag.mode === 'rotating' && drag.initialShapes) {
        const targetId = selectedIdsRef.current[0];
        if (!targetId) return;
        const orig = drag.initialShapes.find((s) => s.id === targetId);
        if (!orig) return;
        const { x, y, w, h } = getBounds(orig);
        const cx = x + w / 2;
        const cy = y + h / 2;
        const angle = (Math.atan2(cp.y - cy, cp.x - cx) * 180) / Math.PI + 90;
        onShapesChange(
          shapesRef.current.map((s) => (s.id === targetId ? { ...s, rotation: angle } : s)),
        );
        return;
      }

      if (drag.mode === 'box-select') {
        const bx = Math.min(drag.startX, cp.x);
        const by = Math.min(drag.startY, cp.y);
        const bw = Math.abs(cp.x - drag.startX);
        const bh = Math.abs(cp.y - drag.startY);
        drag.boxX = bx;
        drag.boxY = by;
        drag.boxW = bw;
        drag.boxH = bh;
        render();
      }
    },
    [getCanvasPos, onShapesChange, onSelectionChange, onTransformChange, render],
  );

  const onMouseUp = useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.mode === 'none') return;

      if (drag.mode === 'drawing') {
        const cur = currentShapeRef.current;
        if (cur) {
          const hasContent =
            cur.type === 'pen'
              ? cur.points.length > 1
              : Math.abs(cur.width) > 2 || Math.abs(cur.height) > 2;
          if (hasContent) {
            onShapesChange([...shapesRef.current, cur]);
            onSelectionChange([cur.id]);
          }
          currentShapeRef.current = null;
        }
      }

      if (drag.mode === 'box-select') {
        const bx = drag.boxX ?? 0;
        const by = drag.boxY ?? 0;
        const bw = drag.boxW ?? 0;
        const bh = drag.boxH ?? 0;
        const newSel = shapesRef.current
          .filter((s) => {
            const { x, y, w, h } = getBounds(s);
            return x < bx + bw && x + w > bx && y < by + bh && y + h > by;
          })
          .map((s) => s.id);
        onSelectionChange(e.shiftKey ? [...new Set([...selectedIdsRef.current, ...newSel])] : newSel);
      }

      dragRef.current = { mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0 };
      render();
    },
    [onShapesChange, onSelectionChange, render],
  );

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = transformRef.current;
      const factor = e.deltaY > 0 ? 0.9 : 1 / 0.9;
      const newScale = Math.max(0.1, Math.min(10, t.scale * factor));
      const newX = mx - (mx - t.x) * (newScale / t.scale);
      const newY = my - (my - t.y) * (newScale / t.scale);
      transformRef.current = { x: newX, y: newY, scale: newScale };
      onTransformChange?.(transformRef.current);
      forceRender((n) => n + 1);
      render();
    },
    [onTransformChange, render],
  );

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

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onMouseDown, onMouseMove, onMouseUp, onWheel, render]);

  const cursorStyle: React.CSSProperties['cursor'] = (() => {
    if (spaceDownRef.current) return 'grab';
    switch (tool) {
      case 'select': return 'default';
      case 'eraser': return 'crosshair';
      case 'text': return 'text';
      default: return 'crosshair';
    }
  })();

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: cursorStyle }}
      />
    </div>
  );
}
