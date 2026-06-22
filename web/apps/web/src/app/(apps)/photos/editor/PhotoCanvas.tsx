'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import type { Tool, Adjustments, CropRect, MarkupStroke } from './types';
import styles from './page.module.css';

export interface PhotoCanvasHandle {
  getExportBlob(): Promise<Blob>;
}

interface PhotoCanvasProps {
  imageDataUrl: string | null;
  adjustments: Adjustments;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  cropRect: CropRect | null;
  activeTool: Tool;
  markupStrokes: MarkupStroke[];
  onStrokeAdd: (stroke: MarkupStroke) => void;
  onCropChange: (rect: CropRect | null) => void;
}

const MAX_CANVAS_WIDTH = 1600;
const MAX_CANVAS_HEIGHT = 1200;

function renderBase(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  adjustments: Adjustments,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
  cropRect: CropRect | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const brightness = 1 + adjustments.brightness / 100 + adjustments.exposure / 100;
  const contrast = 1 + adjustments.contrast / 100;
  const saturate = 1 + adjustments.saturation / 100;

  ctx.filter = [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturate})`,
  ].join(' ');

  const rad = (rotation * Math.PI) / 180;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

  if (cropRect) {
    const sx = cropRect.x * img.naturalWidth;
    const sy = cropRect.y * img.naturalHeight;
    const sw = cropRect.w * img.naturalWidth;
    const sh = cropRect.h * img.naturalHeight;
    ctx.drawImage(img, sx, sy, sw, sh, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
  } else {
    ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
  }
  ctx.restore();
  ctx.filter = 'none';

  if (adjustments.temperature !== 0) {
    const tempOpacity = (Math.abs(adjustments.temperature) / 100) * 0.3;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle =
      adjustments.temperature > 0
        ? `rgba(255, 160, 0, ${tempOpacity})`
        : `rgba(0, 140, 255, ${tempOpacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

function drawStrokes(canvas: HTMLCanvasElement, strokes: MarkupStroke[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.save();

    if (stroke.tool === 'pen') {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    } else if (stroke.tool === 'highlighter') {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    } else if (stroke.tool === 'line') {
      const last = stroke.points[stroke.points.length - 1];
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    } else if (stroke.tool === 'arrow') {
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLen = 16;
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (stroke.tool === 'rectangle') {
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (stroke.tool === 'circle') {
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      const cx = start.x + (end.x - start.x) / 2;
      const cy = start.y + (end.y - start.y) / 2;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (stroke.tool === 'blackbox') {
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];
      ctx.fillStyle = '#000000';
      ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
    }

    ctx.restore();
  }
}

export const PhotoCanvas = forwardRef<PhotoCanvasHandle, PhotoCanvasProps>(function PhotoCanvas(
  { imageDataUrl, adjustments, rotation, flipH, flipV, cropRect, activeTool, markupStrokes, onStrokeAdd, onCropChange },
  ref,
) {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<{ x: number; y: number }[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  // Active color and line width — simple defaults; parent can extend later
  const activeColor = '#e53e3e';
  const activeLineWidth = activeTool === 'highlighter' ? 18 : 2;

  useImperativeHandle(ref, () => ({
    async getExportBlob(): Promise<Blob> {
      const base = baseCanvasRef.current;
      const overlay = overlayCanvasRef.current;
      if (!base || !overlay) throw new Error('Canvas not ready');
      const merged = document.createElement('canvas');
      merged.width = base.width;
      merged.height = base.height;
      const ctx = merged.getContext('2d')!;
      ctx.drawImage(base, 0, 0);
      ctx.drawImage(overlay, 0, 0);
      return new Promise<Blob>((resolve, reject) =>
        merged.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      );
    },
  }));

  // Load image and set canvas dimensions
  useEffect(() => {
    if (!imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const w = Math.min(img.naturalWidth, MAX_CANVAS_WIDTH);
      const h = Math.min(img.naturalHeight, MAX_CANVAS_HEIGHT);
      setCanvasSize({ width: w, height: h });
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  // Re-render base canvas on any image/adjustment/transform/crop change
  useEffect(() => {
    const base = baseCanvasRef.current;
    const img = imgRef.current;
    if (!base || !img) return;
    renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect);
  }, [adjustments, rotation, flipH, flipV, cropRect, canvasSize]);

  // Re-draw overlay strokes
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    drawStrokes(overlay, markupStrokes);
  }, [markupStrokes, canvasSize]);

  const getCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activeTool === 'select') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      const pt = getCanvasPoint(e);
      currentPointsRef.current = [pt];

      if (activeTool === 'crop') {
        // start crop drag — tracked in points, applied on pointer up
      }
    },
    [activeTool, getCanvasPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      const pt = getCanvasPoint(e);
      currentPointsRef.current.push(pt);

      // Live preview on overlay
      const overlay = overlayCanvasRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      // Redraw committed strokes + current in-progress stroke
      drawStrokes(overlay, markupStrokes);

      if (activeTool === 'pen' || activeTool === 'highlighter') {
        const pts = currentPointsRef.current;
        ctx.save();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = activeLineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = activeTool === 'highlighter' ? 0.4 : 1;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.restore();
      } else if (activeTool === 'line') {
        const pts = currentPointsRef.current;
        const last = pts[pts.length - 1];
        ctx.save();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = activeLineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        ctx.restore();
      } else if (activeTool === 'arrow') {
        const pts = currentPointsRef.current;
        const start = pts[0];
        const end = pts[pts.length - 1];
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 16;
        ctx.save();
        ctx.strokeStyle = activeColor;
        ctx.fillStyle = activeColor;
        ctx.lineWidth = activeLineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (activeTool === 'rectangle') {
        const pts = currentPointsRef.current;
        const start = pts[0];
        const end = pts[pts.length - 1];
        ctx.save();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = activeLineWidth;
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        ctx.restore();
      } else if (activeTool === 'circle') {
        const pts = currentPointsRef.current;
        const start = pts[0];
        const end = pts[pts.length - 1];
        const rx = Math.abs(end.x - start.x) / 2;
        const ry = Math.abs(end.y - start.y) / 2;
        const cx = start.x + (end.x - start.x) / 2;
        const cy = start.y + (end.y - start.y) / 2;
        ctx.save();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = activeLineWidth;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (activeTool === 'blackbox') {
        const pts = currentPointsRef.current;
        const start = pts[0];
        const end = pts[pts.length - 1];
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
        ctx.restore();
      } else if (activeTool === 'crop') {
        const pts = currentPointsRef.current;
        const start = pts[0];
        const end = pts[pts.length - 1];
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        ctx.restore();
      }
    },
    [activeTool, markupStrokes, activeColor, activeLineWidth],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      const pt = getCanvasPoint(e);
      currentPointsRef.current.push(pt);
      const pts = currentPointsRef.current;

      if (activeTool === 'crop' && pts.length >= 2) {
        const start = pts[0];
        const end = pts[pts.length - 1];
        const canvas = overlayCanvasRef.current;
        if (canvas) {
          const x = Math.min(start.x, end.x) / canvas.width;
          const y = Math.min(start.y, end.y) / canvas.height;
          const w = Math.abs(end.x - start.x) / canvas.width;
          const h = Math.abs(end.y - start.y) / canvas.height;
          if (w > 0.01 && h > 0.01) {
            onCropChange({ x, y, w, h });
          }
        }
      } else if (activeTool !== 'select' && pts.length >= 2) {
        onStrokeAdd({
          id: Math.random().toString(36).slice(2, 10),
          tool: activeTool,
          color: activeColor,
          lineWidth: activeLineWidth,
          points: [...pts],
        });
      }

      currentPointsRef.current = [];
    },
    [activeTool, activeColor, activeLineWidth, getCanvasPoint, onStrokeAdd, onCropChange],
  );

  const cursor =
    activeTool === 'select'
      ? 'default'
      : activeTool === 'crop'
      ? 'crosshair'
      : activeTool === 'text'
      ? 'text'
      : 'crosshair';

  return (
    <div className={styles.canvasWrapper} style={{ width: canvasSize.width, height: canvasSize.height }}>
      <canvas
        ref={baseCanvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className={styles.baseCanvas}
        aria-hidden="true"
      />
      <canvas
        ref={overlayCanvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className={styles.overlayCanvas}
        style={{ cursor, position: 'absolute', top: 0, left: 0 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label="Photo editing canvas"
        role="img"
      />
    </div>
  );
});
