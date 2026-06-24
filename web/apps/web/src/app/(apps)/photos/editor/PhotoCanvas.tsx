'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import type { Tool, Adjustments, CropRect, MarkupStroke, PhotoFilter, CloneShape, CloneStampSettings, TextSettings, StrokeSettings, AreaSelection } from './types';
import { FILTER_PRESET_CSS, DEFAULT_CLONE_SETTINGS, DEFAULT_TEXT_SETTINGS, DEFAULT_STROKE_SETTINGS } from './types';
import styles from './page.module.css';

export interface PhotoCanvasHandle {
  getExportBlob(): Promise<Blob>;
  applyBaseRegionOp(rect: AreaSelection, op: 'blur' | 'pixelate' | 'fill'): string;
  detectEdges(threshold: number): { mask: ImageData; bounds: AreaSelection };
  cutEdgeRegion(mask: ImageData): string;
  applyEdgeMaskAsOverlay(mask: ImageData): string;
  getEdgeRegionBlob(mask: ImageData): Promise<Blob>;
  eraseObjects(normalizedRects: Array<{ x: number; y: number; w: number; h: number }>): string;
}

interface PhotoCanvasProps {
  imageDataUrl: string | null;
  adjustments: Adjustments;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  cropRect: CropRect | null;
  photoFilter: PhotoFilter;
  activeTool: Tool;
  markupStrokes: MarkupStroke[];
  zoom?: number;
  panOffset?: { x: number; y: number };
  cloneSettings?: CloneStampSettings;
  textSettings?: TextSettings;
  strokeSettings?: StrokeSettings;
  selectedStrokeIds?: string[];
  areaSelection?: AreaSelection | null;
  edgeMask?: ImageData | null;
  detectedObjects?: Array<{ x: number; y: number; w: number; h: number; label: string }> | null;
  onStrokeAdd: (stroke: MarkupStroke) => void;
  onCropChange: (rect: CropRect | null) => void;
  onSelectionChange?: (ids: string[]) => void;
  onAreaSelect?: (rect: AreaSelection | null) => void;
}

const MAX_CANVAS_WIDTH = 1600;
const MAX_CANVAS_HEIGHT = 1200;

function buildFilterString(adjustments: Adjustments, photoFilter: PhotoFilter): string {
  const brightness = 1 + adjustments.brightness / 100 + adjustments.exposure / 100;
  const contrast = 1 + adjustments.contrast / 100;
  const baseSaturate = Math.max(0, 1 + adjustments.saturation / 100);
  const vibranceMult = 1 + adjustments.vibrance / 200;
  const saturate = Math.max(0, baseSaturate * vibranceMult);
  const hue = adjustments.hue;

  let f = `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) hue-rotate(${hue}deg)`;

  const preset = FILTER_PRESET_CSS[photoFilter];
  if (preset) f += ` ${preset}`;

  return f;
}

function renderBase(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  adjustments: Adjustments,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
  cropRect: CropRect | null,
  photoFilter: PhotoFilter,
  comparisonPos?: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const rad = (rotation * Math.PI) / 180;
  const filterStr = buildFilterString(adjustments, photoFilter);

  function drawSide(c: CanvasRenderingContext2D, withFilter: boolean, clipLeft: number, clipRight: number) {
    c.save();
    c.beginPath();
    c.rect(clipLeft, 0, clipRight - clipLeft, ch);
    c.clip();

    if (withFilter) {
      c.filter = filterStr;
    }

    c.translate(cw / 2, ch / 2);
    c.rotate(rad);
    c.scale(flipH ? -1 : 1, flipV ? -1 : 1);

    if (cropRect) {
      const sx = cropRect.x * img.naturalWidth;
      const sy = cropRect.y * img.naturalHeight;
      const sw = cropRect.w * img.naturalWidth;
      const sh = cropRect.h * img.naturalHeight;
      c.drawImage(img, sx, sy, sw, sh, -cw / 2, -ch / 2, cw, ch);
    } else {
      c.drawImage(img, -cw / 2, -ch / 2, cw, ch);
    }

    c.restore();
    c.filter = 'none';

    if (withFilter) {
      // Temperature overlay
      if (adjustments.temperature !== 0) {
        const tempOpacity = (Math.abs(adjustments.temperature) / 100) * 0.3;
        c.save();
        c.beginPath();
        c.rect(clipLeft, 0, clipRight - clipLeft, ch);
        c.clip();
        c.globalCompositeOperation = 'soft-light';
        c.fillStyle =
          adjustments.temperature > 0
            ? `rgba(255, 160, 0, ${tempOpacity})`
            : `rgba(0, 140, 255, ${tempOpacity})`;
        c.fillRect(0, 0, cw, ch);
        c.restore();
      }

      // Color balance overlay (magenta/green tint)
      if (adjustments.colorBalance !== 0) {
        const balOpacity = (Math.abs(adjustments.colorBalance) / 100) * 0.25;
        c.save();
        c.beginPath();
        c.rect(clipLeft, 0, clipRight - clipLeft, ch);
        c.clip();
        c.globalCompositeOperation = 'soft-light';
        c.fillStyle =
          adjustments.colorBalance > 0
            ? `rgba(255, 0, 128, ${balOpacity})`
            : `rgba(0, 200, 100, ${balOpacity})`;
        c.fillRect(0, 0, cw, ch);
        c.restore();
      }
    }
  }

  if (comparisonPos !== undefined) {
    const splitX = Math.round(comparisonPos * cw);
    drawSide(ctx, false, 0, splitX);
    drawSide(ctx, true, splitX, cw);
  } else {
    drawSide(ctx, true, 0, cw);
  }
}

function drawBlurBrushAt(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  pt: { x: number; y: number },
  radius: number,
  shape: CloneShape,
  edgeBlur: number,
  amount: number,
) {
  const sz = Math.max(2, Math.round(radius * 2));
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = sz;
  blurCanvas.height = sz;
  const bCtx = blurCanvas.getContext('2d')!;
  bCtx.filter = `blur(${amount}px)`;
  bCtx.drawImage(base, pt.x - radius, pt.y - radius, sz, sz, 0, 0, sz, sz);
  bCtx.filter = 'none';
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sz;
  maskCanvas.height = sz;
  const mCtx = maskCanvas.getContext('2d')!;
  const inset = edgeBlur > 0 ? edgeBlur : 0;
  if (edgeBlur > 0) mCtx.filter = `blur(${edgeBlur}px)`;
  if (shape === 'circle') {
    mCtx.beginPath();
    mCtx.arc(radius, radius, Math.max(1, radius - inset), 0, Math.PI * 2);
    mCtx.fill();
  } else {
    mCtx.fillRect(inset, inset, sz - inset * 2, sz - inset * 2);
  }
  bCtx.globalCompositeOperation = 'destination-in';
  bCtx.drawImage(maskCanvas, 0, 0);
  ctx.drawImage(blurCanvas, 0, 0, sz, sz, pt.x - radius, pt.y - radius, sz, sz);
}

function drawPixelateBrushAt(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  pt: { x: number; y: number },
  radius: number,
  shape: CloneShape,
  edgeBlur: number,
  amount: number,
) {
  const sz = Math.max(2, Math.round(radius * 2));
  const pixelSize = Math.max(1, amount);
  const smallW = Math.max(1, Math.floor(sz / pixelSize));
  const smallH = Math.max(1, Math.floor(sz / pixelSize));
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = smallW;
  smallCanvas.height = smallH;
  const sCtx = smallCanvas.getContext('2d')!;
  sCtx.imageSmoothingEnabled = false;
  sCtx.drawImage(base, pt.x - radius, pt.y - radius, sz, sz, 0, 0, smallW, smallH);
  const pixCanvas = document.createElement('canvas');
  pixCanvas.width = sz;
  pixCanvas.height = sz;
  const pCtx = pixCanvas.getContext('2d')!;
  pCtx.imageSmoothingEnabled = false;
  pCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, sz, sz);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sz;
  maskCanvas.height = sz;
  const mCtx = maskCanvas.getContext('2d')!;
  const inset = edgeBlur > 0 ? edgeBlur : 0;
  if (edgeBlur > 0) mCtx.filter = `blur(${edgeBlur}px)`;
  if (shape === 'circle') {
    mCtx.beginPath();
    mCtx.arc(radius, radius, Math.max(1, radius - inset), 0, Math.PI * 2);
    mCtx.fill();
  } else {
    mCtx.fillRect(inset, inset, sz - inset * 2, sz - inset * 2);
  }
  pCtx.globalCompositeOperation = 'destination-in';
  pCtx.drawImage(maskCanvas, 0, 0);
  ctx.drawImage(pixCanvas, 0, 0, sz, sz, pt.x - radius, pt.y - radius, sz, sz);
}

function drawCloneBrushAt(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  pt: { x: number; y: number },
  sourceX: number,
  sourceY: number,
  radius: number,
  shape: CloneShape,
  edgeBlur: number,
) {
  const sz = Math.max(2, Math.round(radius * 2));

  // Draw the source pixels onto a temp canvas
  const pixCanvas = document.createElement('canvas');
  pixCanvas.width = sz;
  pixCanvas.height = sz;
  const pCtx = pixCanvas.getContext('2d')!;
  pCtx.drawImage(base, sourceX - radius, sourceY - radius, sz, sz, 0, 0, sz, sz);

  // Build an alpha mask that defines the brush shape and edge feathering
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sz;
  maskCanvas.height = sz;
  const mCtx = maskCanvas.getContext('2d')!;
  const inset = edgeBlur > 0 ? edgeBlur : 0;
  if (edgeBlur > 0) mCtx.filter = `blur(${edgeBlur}px)`;
  if (shape === 'circle') {
    mCtx.beginPath();
    mCtx.arc(radius, radius, Math.max(1, radius - inset), 0, Math.PI * 2);
    mCtx.fill();
  } else {
    mCtx.fillRect(inset, inset, sz - inset * 2, sz - inset * 2);
  }

  // Punch the mask through the pixel canvas
  pCtx.globalCompositeOperation = 'destination-in';
  pCtx.drawImage(maskCanvas, 0, 0);

  ctx.drawImage(pixCanvas, 0, 0, sz, sz, pt.x - radius, pt.y - radius, sz, sz);
}

function getStrokeBounds(stroke: MarkupStroke): { x1: number; y1: number; x2: number; y2: number } | null {
  if (stroke.points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const relevant =
    stroke.tool === 'line' || stroke.tool === 'arrow' || stroke.tool === 'rectangle' || stroke.tool === 'circle' || stroke.tool === 'blackbox'
      ? [stroke.points[0], stroke.points[stroke.points.length - 1]]
      : stroke.points;
  for (const p of relevant) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const pad = (stroke.lineWidth ?? 2) / 2 + 4;
  return { x1: minX - pad, y1: minY - pad, x2: maxX + pad, y2: maxY + pad };
}

function strokesInSelection(
  strokes: MarkupStroke[],
  sel: { x: number; y: number; w: number; h: number },
): string[] {
  const sx1 = Math.min(sel.x, sel.x + sel.w);
  const sy1 = Math.min(sel.y, sel.y + sel.h);
  const sx2 = Math.max(sel.x, sel.x + sel.w);
  const sy2 = Math.max(sel.y, sel.y + sel.h);
  return strokes
    .filter((s) => {
      const b = getStrokeBounds(s);
      if (!b) return false;
      return !(b.x2 < sx1 || b.x1 > sx2 || b.y2 < sy1 || b.y1 > sy2);
    })
    .map((s) => s.id);
}

function drawSelectionHighlights(
  ctx: CanvasRenderingContext2D,
  strokes: MarkupStroke[],
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return;
  const idSet = new Set(selectedIds);
  ctx.save();
  ctx.strokeStyle = 'rgba(100,160,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  for (const stroke of strokes) {
    if (!idSet.has(stroke.id)) continue;
    const b = getStrokeBounds(stroke);
    if (!b) continue;
    ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
  }
  ctx.restore();
}

function drawStrokes(
  canvas: HTMLCanvasElement,
  strokes: MarkupStroke[],
  baseCanvas?: HTMLCanvasElement | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const stroke of strokes) {
    if (stroke.tool === 'text') {
      if (stroke.text && stroke.points[0]) {
        const fontSize = stroke.lineWidth || 20;
        const pt = stroke.points[0];
        ctx.save();
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = stroke.color;
        ctx.textBaseline = 'top';
        const lines = stroke.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], pt.x, pt.y + i * Math.round(fontSize * 1.3));
        }
        ctx.restore();
      }
      continue;
    }

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
      const headLen = Math.min(80, stroke.lineWidth * 4 + 8);
      const lineEnd = { x: end.x - (headLen - stroke.lineWidth) * Math.cos(angle), y: end.y - (headLen - stroke.lineWidth) * Math.sin(angle) };
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(lineEnd.x, lineEnd.y);
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
    } else if (stroke.tool === 'blur' && baseCanvas) {
      const brushRadius = stroke.lineWidth / 2;
      const shape = stroke.cloneShape ?? 'circle';
      const edgeBlur = stroke.cloneEdgeBlur ?? 0;
      const amount = stroke.brushAmount ?? 12;
      for (const pt of stroke.points) {
        drawBlurBrushAt(ctx, baseCanvas, pt, brushRadius, shape, edgeBlur, amount);
      }
    } else if (stroke.tool === 'pixelate' && baseCanvas) {
      const brushRadius = stroke.lineWidth / 2;
      const shape = stroke.cloneShape ?? 'circle';
      const edgeBlur = stroke.cloneEdgeBlur ?? 0;
      const amount = stroke.brushAmount ?? 12;
      for (const pt of stroke.points) {
        drawPixelateBrushAt(ctx, baseCanvas, pt, brushRadius, shape, edgeBlur, amount);
      }
    } else if (stroke.tool === 'clone' && stroke.cloneSource && stroke.cloneDragStart && baseCanvas) {
      const { cloneSource: source, cloneDragStart: dragStart } = stroke;
      const brushRadius = stroke.lineWidth / 2;
      const shape = stroke.cloneShape ?? 'circle';
      const edgeBlur = stroke.cloneEdgeBlur ?? 0;
      for (const pt of stroke.points) {
        const offsetX = pt.x - dragStart.x;
        const offsetY = pt.y - dragStart.y;
        drawCloneBrushAt(ctx, baseCanvas, pt, source.x + offsetX, source.y + offsetY, brushRadius, shape, edgeBlur);
      }
    }

    ctx.restore();
  }
}

function drawCloneSourceIndicator(canvas: HTMLCanvasElement, source: { x: number; y: number }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { x, y } = source;
  const r = 14;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 220, 0, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, r / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.restore();
}

// ── Region operation helpers ───────────────────────────────────────────────

function applyBlurToRegion(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const radius = Math.max(8, Math.round(Math.min(w, h) / 6));
  const pad = radius * 2;
  const tmp = document.createElement('canvas');
  tmp.width = w + pad * 2;
  tmp.height = h + pad * 2;
  const tCtx = tmp.getContext('2d')!;
  tCtx.filter = `blur(${radius}px)`;
  tCtx.drawImage(ctx.canvas, x - pad, y - pad, w + pad * 2, h + pad * 2, 0, 0, tmp.width, tmp.height);
  tCtx.filter = 'none';
  ctx.drawImage(tmp, pad, pad, w, h, x, y, w, h);
}

function applyPixelateToRegion(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const blockSize = Math.max(4, Math.round(Math.min(w, h) / 20));
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tCtx = tmp.getContext('2d')!;
  tCtx.imageSmoothingEnabled = false;
  tCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.floor(w / blockSize));
  small.height = Math.max(1, Math.floor(h / blockSize));
  const sCtx = small.getContext('2d')!;
  sCtx.imageSmoothingEnabled = false;
  sCtx.drawImage(tmp, 0, 0, w, h, 0, 0, small.width, small.height);
  tCtx.imageSmoothingEnabled = false;
  tCtx.drawImage(small, 0, 0, small.width, small.height, 0, 0, w, h);
  ctx.drawImage(tmp, 0, 0, w, h, x, y, w, h);
}

function applyContentFillToRegion(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const sampleBand = Math.max(4, Math.min(30, Math.round(Math.min(w, h) * 0.1)));
  const full = ctx.getImageData(0, 0, cw, ch);
  const d = full.data;

  const px = (ex: number, ey: number): [number, number, number] => {
    const ix = Math.max(0, Math.min(cw - 1, ex));
    const iy = Math.max(0, Math.min(ch - 1, ey));
    const i = (iy * cw + ix) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };

  // Average a band of pixels along each edge
  const rowLeft: [number, number, number][] = [];
  const rowRight: [number, number, number][] = [];
  for (let row = 0; row < h; row++) {
    const ey = y + row;
    let lr = 0, lg = 0, lb = 0, rr = 0, rg = 0, rb = 0;
    for (let s = 1; s <= sampleBand; s++) {
      const [a, b, c] = px(x - s, ey); lr += a; lg += b; lb += c;
      const [e, f, g] = px(x + w - 1 + s, ey); rr += e; rg += f; rb += g;
    }
    rowLeft.push([lr / sampleBand, lg / sampleBand, lb / sampleBand]);
    rowRight.push([rr / sampleBand, rg / sampleBand, rb / sampleBand]);
  }
  const colTop: [number, number, number][] = [];
  const colBot: [number, number, number][] = [];
  for (let col = 0; col < w; col++) {
    const ex = x + col;
    let tr = 0, tg = 0, tb = 0, br = 0, bg = 0, bb = 0;
    for (let s = 1; s <= sampleBand; s++) {
      const [a, b, c] = px(ex, y - s); tr += a; tg += b; tb += c;
      const [e, f, g] = px(ex, y + h - 1 + s); br += e; bg += f; bb += g;
    }
    colTop.push([tr / sampleBand, tg / sampleBand, tb / sampleBand]);
    colBot.push([br / sampleBand, bg / sampleBand, bb / sampleBand]);
  }

  const result = ctx.createImageData(w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const t = w > 1 ? col / (w - 1) : 0.5;
      const s = h > 1 ? row / (h - 1) : 0.5;
      const [lr, lg, lb] = rowLeft[row];
      const [rr, rg, rb] = rowRight[row];
      const [tr, tg, tb] = colTop[col];
      const [_br, _bg, _bb] = colBot[col];
      const hr = lr * (1 - t) + rr * t;
      const hg = lg * (1 - t) + rg * t;
      const hb = lb * (1 - t) + rb * t;
      const vr = tr * (1 - s) + _br * s;
      const vg = tg * (1 - s) + _bg * s;
      const vb = tb * (1 - s) + _bb * s;
      const dh = 1 - Math.min(t, 1 - t) * 2;
      const dv = 1 - Math.min(s, 1 - s) * 2;
      const tw = dh + dv || 1;
      const ri = (row * w + col) * 4;
      result.data[ri] = (hr * dh + vr * dv) / tw;
      result.data[ri + 1] = (hg * dh + vg * dv) / tw;
      result.data[ri + 2] = (hb * dh + vb * dv) / tw;
      result.data[ri + 3] = 255;
    }
  }

  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tCtx = tmp.getContext('2d')!;
  tCtx.putImageData(result, 0, 0);
  const smoothed = document.createElement('canvas');
  smoothed.width = w; smoothed.height = h;
  const smCtx = smoothed.getContext('2d')!;
  smCtx.filter = 'blur(2px)';
  smCtx.drawImage(tmp, 0, 0);
  smCtx.filter = 'none';
  ctx.drawImage(smoothed, 0, 0, w, h, x, y, w, h);
}

function detectEdgesFromImageData(
  imageData: ImageData,
  threshold: number,
): { mask: ImageData; bounds: AreaSelection } {
  const { data, width, height } = imageData;
  const mask = new ImageData(width, height);
  const md = mask.data;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let hasEdge = false;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gray = (px: number, py: number) => {
        const i = (py * width + px) * 4;
        return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      };
      const gx =
        -gray(x - 1, y - 1) + gray(x + 1, y - 1) +
        -2 * gray(x - 1, y) + 2 * gray(x + 1, y) +
        -gray(x - 1, y + 1) + gray(x + 1, y + 1);
      const gy =
        -gray(x - 1, y - 1) - 2 * gray(x, y - 1) - gray(x + 1, y - 1) +
        gray(x - 1, y + 1) + 2 * gray(x, y + 1) + gray(x + 1, y + 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      const i = (y * width + x) * 4;
      if (mag >= threshold) {
        md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = 255;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        hasEdge = true;
      }
    }
  }

  const bounds: AreaSelection = hasEdge
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : { x: 0, y: 0, w: width, h: height };
  return { mask, bounds };
}

export const PhotoCanvas = forwardRef<PhotoCanvasHandle, PhotoCanvasProps>(function PhotoCanvas(
  {
    imageDataUrl,
    adjustments,
    rotation,
    flipH,
    flipV,
    cropRect,
    photoFilter,
    activeTool,
    markupStrokes,
    zoom = 100,
    panOffset,
    cloneSettings = DEFAULT_CLONE_SETTINGS,
    textSettings = DEFAULT_TEXT_SETTINGS,
    strokeSettings = DEFAULT_STROKE_SETTINGS,
    selectedStrokeIds,
    areaSelection,
    edgeMask,
    detectedObjects,
    onStrokeAdd,
    onCropChange,
    onSelectionChange,
    onAreaSelect,
  },
  ref,
) {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<{ x: number; y: number }[]>([]);
  const isAreaDragRef = useRef(false);
  const areaDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [imgLoadCount, setImgLoadCount] = useState(0);
  const edgeOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastEdgeMaskRef = useRef<ImageData | null>(null);

  // Before/after comparison slider
  const [comparisonPos, setComparisonPos] = useState(0.5);
  const isDraggingComparison = useRef(false);

  // Clone stamp source point (set via Alt+click)
  const [cloneSource, setCloneSource] = useState<{ x: number; y: number } | null>(null);

  // Pending text input
  const [pendingText, setPendingText] = useState<{ x: number; y: number; value: string } | null>(null);
  const pendingTextRef = useRef<HTMLTextAreaElement>(null);
  // Always-current commit function, used by document listener without stale closure
  const commitFnRef = useRef<() => void>(() => {});

  const activeColor = strokeSettings.color;
  const activeLineWidth = strokeSettings.lineWidth;
  const cloneBrushRadius = cloneSettings.size / 2;

  // Off-screen canvas holding the fully-rendered committed stroke state.
  // Kept in sync by the markupStrokes useEffect so handlePointerMove can
  // stamp it in one drawImage instead of replaying all strokes each frame.
  const committedOverlayRef = useRef<HTMLCanvasElement | null>(null);
  // Index into currentPointsRef up to which brush strokes have already been
  // drawn into the overlay, so pointermove only draws the new tail.
  const lastDrawnIdxRef = useRef(0);

  // Clear clone source when switching away from clone tool
  useEffect(() => {
    if (activeTool !== 'clone') setCloneSource(null);
  }, [activeTool]);

  // Cancel pending text when switching away from text tool
  useEffect(() => {
    if (activeTool !== 'text') setPendingText(null);
  }, [activeTool]);

  const commitPendingText = useCallback(() => {
    if (!pendingText) return;
    if (pendingText.value.trim()) {
      onStrokeAdd({
        id: Math.random().toString(36).slice(2, 10),
        tool: 'text',
        color: textSettings.color,
        lineWidth: textSettings.size,
        points: [{ x: pendingText.x, y: pendingText.y }],
        text: pendingText.value,
      });
    }
    setPendingText(null);
  }, [pendingText, textSettings, onStrokeAdd]);

  // Keep ref current so the document listener always calls the latest version
  commitFnRef.current = commitPendingText;

  // Commit when clicking outside the textarea. Using capture-phase so it fires
  // before the canvas's own onPointerDown (which would start a new text input).
  // We deliberately avoid onBlur because React Strict Mode fires blur during its
  // simulated unmount/remount cycle, which would kill the textarea immediately.
  const isPendingTextActive = pendingText !== null;
  useEffect(() => {
    if (!isPendingTextActive) return;
    const handleOutside = (e: PointerEvent) => {
      if (pendingTextRef.current?.contains(e.target as Node)) return;
      commitFnRef.current();
    };
    document.addEventListener('pointerdown', handleOutside, true);
    return () => document.removeEventListener('pointerdown', handleOutside, true);
  }, [isPendingTextActive]);

  useImperativeHandle(ref, () => ({
    async getExportBlob(): Promise<Blob> {
      const base = baseCanvasRef.current;
      const overlay = overlayCanvasRef.current;
      if (!base || !overlay) throw new Error('Canvas not ready');
      const img = imgRef.current;
      if (img) renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter);
      drawStrokes(overlay, markupStrokes, base);
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
    applyBaseRegionOp(rect: AreaSelection, op: 'blur' | 'pixelate' | 'fill'): string {
      const base = baseCanvasRef.current;
      if (!base) throw new Error('Canvas not ready');
      const img = imgRef.current;
      if (img) renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter);
      const ctx = base.getContext('2d')!;
      const bx = Math.max(0, Math.round(rect.x));
      const by = Math.max(0, Math.round(rect.y));
      const bw = Math.min(base.width - bx, Math.round(rect.w));
      const bh = Math.min(base.height - by, Math.round(rect.h));
      if (bw <= 0 || bh <= 0) return base.toDataURL('image/png');
      if (op === 'blur') applyBlurToRegion(ctx, bx, by, bw, bh);
      else if (op === 'pixelate') applyPixelateToRegion(ctx, bx, by, bw, bh);
      else applyContentFillToRegion(ctx, bx, by, bw, bh);
      return base.toDataURL('image/png');
    },
    detectEdges(threshold: number): { mask: ImageData; bounds: AreaSelection } {
      const base = baseCanvasRef.current;
      if (!base) throw new Error('Canvas not ready');
      const img = imgRef.current;
      if (img) renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter);
      const ctx = base.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, base.width, base.height);
      return detectEdgesFromImageData(imageData, threshold);
    },
    cutEdgeRegion(mask: ImageData): string {
      const base = baseCanvasRef.current;
      if (!base) throw new Error('Canvas not ready');
      const img = imgRef.current;
      if (img) renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter);
      const ctx = base.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, base.width, base.height);
      const d = imageData.data;
      const md = mask.data;
      for (let i = 0; i < d.length; i += 4) {
        if (md[i + 3] > 128) d[i + 3] = 0;
      }
      ctx.putImageData(imageData, 0, 0);
      return base.toDataURL('image/png');
    },
    applyEdgeMaskAsOverlay(mask: ImageData): string {
      const base = baseCanvasRef.current;
      if (!base) throw new Error('Canvas not ready');
      const img = imgRef.current;
      if (img) renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter);
      const ctx = base.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, base.width, base.height);
      const d = imageData.data;
      const md = mask.data;
      for (let i = 0; i < d.length; i += 4) {
        if (md[i + 3] > 128) {
          d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return base.toDataURL('image/png');
    },
    async getEdgeRegionBlob(mask: ImageData): Promise<Blob> {
      const base = baseCanvasRef.current;
      if (!base) throw new Error('Canvas not ready');
      const img = imgRef.current;
      if (img) renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter);
      const ctx = base.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, base.width, base.height);
      const d = imageData.data;
      const md = mask.data;
      for (let i = 0; i < d.length; i += 4) {
        if (md[i + 3] <= 128) d[i + 3] = 0;
      }
      const out = document.createElement('canvas');
      out.width = base.width;
      out.height = base.height;
      out.getContext('2d')!.putImageData(imageData, 0, 0);
      return new Promise((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      );
    },
    eraseObjects(normalizedRects: Array<{ x: number; y: number; w: number; h: number }>): string {
      const base = baseCanvasRef.current;
      if (!base) throw new Error('Canvas not ready');
      const img = imgRef.current;
      if (img) renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter);
      const ctx = base.getContext('2d')!;
      for (const rect of normalizedRects) {
        const bx = Math.max(0, Math.round(rect.x * base.width));
        const by = Math.max(0, Math.round(rect.y * base.height));
        const bw = Math.min(base.width - bx, Math.round(rect.w * base.width));
        const bh = Math.min(base.height - by, Math.round(rect.h * base.height));
        if (bw > 0 && bh > 0) applyContentFillToRegion(ctx, bx, by, bw, bh);
      }
      return base.toDataURL('image/png');
    },
  }));

  // Load image and set canvas dimensions
  useEffect(() => {
    if (!imageDataUrl) return;
    const img = new Image();
    img.onerror = () => console.error('[PhotoCanvas] failed to load image src');
    img.onload = () => {
      imgRef.current = img;
      const w = Math.min(img.naturalWidth, MAX_CANVAS_WIDTH);
      const h = Math.min(img.naturalHeight, MAX_CANVAS_HEIGHT);
      setCanvasSize({ width: w, height: h });
      setImgLoadCount((c) => c + 1);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  useLayoutEffect(() => {
    const base = baseCanvasRef.current;
    const img = imgRef.current;
    if (!base || !img) return;
    renderBase(base, img, adjustments, rotation, flipH, flipV, cropRect, photoFilter, comparisonPos);
  }, [adjustments, rotation, flipH, flipV, cropRect, photoFilter, canvasSize, imgLoadCount, comparisonPos]);

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;

    // Ensure the off-screen committed canvas matches current dimensions.
    if (
      !committedOverlayRef.current ||
      committedOverlayRef.current.width !== canvasSize.width ||
      committedOverlayRef.current.height !== canvasSize.height
    ) {
      const c = document.createElement('canvas');
      c.width = canvasSize.width;
      c.height = canvasSize.height;
      committedOverlayRef.current = c;
    }
    const committed = committedOverlayRef.current;
    drawStrokes(committed, markupStrokes, baseCanvasRef.current);
    if (cloneSource && activeTool === 'clone') {
      drawCloneSourceIndicator(committed, cloneSource);
    }

    // Stamp committed state onto the visible overlay.
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.drawImage(committed, 0, 0);
    if (selectedStrokeIds && selectedStrokeIds.length > 0) {
      drawSelectionHighlights(ctx, markupStrokes, selectedStrokeIds);
    }
    if (areaSelection) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 140, 0, 0.95)';
      ctx.fillStyle = 'rgba(255, 140, 0, 0.08)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(areaSelection.x, areaSelection.y, areaSelection.w, areaSelection.h);
      ctx.fillRect(areaSelection.x, areaSelection.y, areaSelection.w, areaSelection.h);
      ctx.restore();
    }
    if (edgeMask) {
      if (edgeMask !== lastEdgeMaskRef.current) {
        lastEdgeMaskRef.current = edgeMask;
        const c = document.createElement('canvas');
        c.width = edgeMask.width;
        c.height = edgeMask.height;
        const eCtx = c.getContext('2d')!;
        const colored = new ImageData(edgeMask.width, edgeMask.height);
        const ed = edgeMask.data;
        const cd = colored.data;
        for (let i = 0; i < ed.length; i += 4) {
          if (ed[i + 3] > 0) {
            cd[i] = 0; cd[i + 1] = 220; cd[i + 2] = 255; cd[i + 3] = 190;
          }
        }
        eCtx.putImageData(colored, 0, 0);
        edgeOverlayCanvasRef.current = c;
      }
      if (edgeOverlayCanvasRef.current) {
        ctx.drawImage(edgeOverlayCanvasRef.current, 0, 0);
      }
    } else {
      edgeOverlayCanvasRef.current = null;
      lastEdgeMaskRef.current = null;
    }
    if (detectedObjects && detectedObjects.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 180, 255, 0.9)';
      ctx.fillStyle = 'rgba(0, 180, 255, 0.08)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      for (const obj of detectedObjects) {
        const px = obj.x * canvasSize.width;
        const py = obj.y * canvasSize.height;
        const pw = obj.w * canvasSize.width;
        const ph = obj.h * canvasSize.height;
        ctx.strokeRect(px, py, pw, ph);
        ctx.fillRect(px, py, pw, ph);
      }
      ctx.restore();
    }
  }, [markupStrokes, canvasSize, cloneSource, activeTool, selectedStrokeIds, areaSelection, edgeMask, detectedObjects]);

  // ── Comparison handle ──────────────────────────────────────────────────────

  const handleComparisonDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingComparison.current = true;
  }, []);

  const handleComparisonMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingComparison.current) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const pos = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    setComparisonPos(pos);
  }, []);

  const handleComparisonUp = useCallback(() => {
    isDraggingComparison.current = false;
  }, []);

  // ── Drawing tool pointer events ────────────────────────────────────────────

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
      if (activeTool === 'select') {
        if (e.shiftKey) {
          e.currentTarget.setPointerCapture(e.pointerId);
          isAreaDragRef.current = true;
          areaDragStartRef.current = getCanvasPoint(e);
          onAreaSelect?.(null);
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        isDrawingRef.current = true;
        onSelectionChange?.([]);
        const pt = getCanvasPoint(e);
        currentPointsRef.current = [pt];
        return;
      }

      if (activeTool === 'text') {
        const pt = getCanvasPoint(e);
        setPendingText({ x: pt.x, y: pt.y, value: '' });
        return;
      }

      if (activeTool === 'clone') {
        if (e.altKey) {
          // Alt+click sets the clone source
          setCloneSource(getCanvasPoint(e));
          e.preventDefault();
          return;
        }
        if (!cloneSource) return;
      }

      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      lastDrawnIdxRef.current = 0;
      const pt = getCanvasPoint(e);
      currentPointsRef.current = [pt];
    },
    [activeTool, cloneSource, getCanvasPoint, onSelectionChange, onAreaSelect, setPendingText],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const overlay = overlayCanvasRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;
      const committed = committedOverlayRef.current;

      if (isAreaDragRef.current && areaDragStartRef.current) {
        const pt = getCanvasPoint(e);
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (committed) ctx.drawImage(committed, 0, 0);
        const start = areaDragStartRef.current;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 140, 0, 0.9)';
        ctx.fillStyle = 'rgba(255, 140, 0, 0.08)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(start.x, start.y, pt.x - start.x, pt.y - start.y);
        ctx.fillRect(start.x, start.y, pt.x - start.x, pt.y - start.y);
        ctx.restore();
        return;
      }

      const isBrushTool = activeTool === 'clone' || activeTool === 'blur' || activeTool === 'pixelate';
      if (!isDrawingRef.current && !isBrushTool) return;

      const pt = getCanvasPoint(e);
      if (isDrawingRef.current) currentPointsRef.current.push(pt);

      const base = baseCanvasRef.current;

      // Stamp committed state onto overlay — one drawImage instead of full replay.
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (committed) ctx.drawImage(committed, 0, 0);

      if (isDrawingRef.current) {
        const pts = currentPointsRef.current;

        if (activeTool === 'pen' || activeTool === 'highlighter') {
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
          const start = pts[0];
          const end = pts[pts.length - 1];
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const headLen = Math.min(80, activeLineWidth * 4 + 8);
          const lineEnd = { x: end.x - (headLen - activeLineWidth) * Math.cos(angle), y: end.y - (headLen - activeLineWidth) * Math.sin(angle) };
          ctx.save();
          ctx.strokeStyle = activeColor;
          ctx.fillStyle = activeColor;
          ctx.lineWidth = activeLineWidth;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(lineEnd.x, lineEnd.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (activeTool === 'rectangle') {
          const start = pts[0];
          const end = pts[pts.length - 1];
          ctx.save();
          ctx.strokeStyle = activeColor;
          ctx.lineWidth = activeLineWidth;
          ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
          ctx.restore();
        } else if (activeTool === 'circle') {
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
          const start = pts[0];
          const end = pts[pts.length - 1];
          ctx.save();
          ctx.fillStyle = '#000000';
          ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
          ctx.restore();
        } else if (activeTool === 'blur' && base) {
          // Only draw new points since last frame to avoid O(n²) work.
          const from = lastDrawnIdxRef.current;
          for (let i = from; i < pts.length; i++) {
            drawBlurBrushAt(ctx, base, pts[i], cloneBrushRadius, cloneSettings.shape, cloneSettings.edgeBlur, cloneSettings.amount);
          }
          lastDrawnIdxRef.current = pts.length;
        } else if (activeTool === 'pixelate' && base) {
          const from = lastDrawnIdxRef.current;
          for (let i = from; i < pts.length; i++) {
            drawPixelateBrushAt(ctx, base, pts[i], cloneBrushRadius, cloneSettings.shape, cloneSettings.edgeBlur, cloneSettings.amount);
          }
          lastDrawnIdxRef.current = pts.length;
        } else if (activeTool === 'crop') {
          const start = pts[0];
          const end = pts[pts.length - 1];
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
          ctx.restore();
        } else if (activeTool === 'clone' && cloneSource && base) {
          // Only draw new points since last frame.
          const from = lastDrawnIdxRef.current;
          const dragStart = pts[0];
          for (let i = from; i < pts.length; i++) {
            const offsetX = pts[i].x - dragStart.x;
            const offsetY = pts[i].y - dragStart.y;
            drawCloneBrushAt(ctx, base, pts[i], cloneSource.x + offsetX, cloneSource.y + offsetY, cloneBrushRadius, cloneSettings.shape, cloneSettings.edgeBlur);
          }
          lastDrawnIdxRef.current = pts.length;
        } else if (activeTool === 'select') {
          const start = pts[0];
          if (start) {
            ctx.save();
            ctx.strokeStyle = 'rgba(100,160,255,0.8)';
            ctx.fillStyle = 'rgba(100,160,255,0.06)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(start.x, start.y, pt.x - start.x, pt.y - start.y);
            ctx.fillRect(start.x, start.y, pt.x - start.x, pt.y - start.y);
            ctx.restore();
          }
        }
      }

      // Brush cursor outline — shown while hovering and while drawing
      if (isBrushTool && (activeTool !== 'clone' || cloneSource)) {
        const cursorPt = isDrawingRef.current && currentPointsRef.current.length > 0
          ? currentPointsRef.current[currentPointsRef.current.length - 1]
          : pt;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        if (cloneSettings.shape === 'circle') {
          ctx.arc(cursorPt.x, cursorPt.y, cloneBrushRadius, 0, Math.PI * 2);
        } else {
          ctx.rect(cursorPt.x - cloneBrushRadius, cursorPt.y - cloneBrushRadius, cloneBrushRadius * 2, cloneBrushRadius * 2);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
    [activeTool, activeColor, activeLineWidth, cloneSource, cloneBrushRadius, cloneSettings, getCanvasPoint, onAreaSelect],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (isAreaDragRef.current) {
        isAreaDragRef.current = false;
        const start = areaDragStartRef.current;
        areaDragStartRef.current = null;
        if (start) {
          const end = getCanvasPoint(e);
          const ax = Math.min(start.x, end.x);
          const ay = Math.min(start.y, end.y);
          const aw = Math.abs(end.x - start.x);
          const ah = Math.abs(end.y - start.y);
          if (aw > 4 && ah > 4) {
            onAreaSelect?.({ x: ax, y: ay, w: aw, h: ah });
          } else {
            onAreaSelect?.(null);
          }
          const overlay = overlayCanvasRef.current;
          if (overlay) drawStrokes(overlay, markupStrokes, baseCanvasRef.current);
        }
        return;
      }

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
      } else if (activeTool === 'clone' && cloneSource && pts.length >= 2) {
        onStrokeAdd({
          id: Math.random().toString(36).slice(2, 10),
          tool: 'clone',
          color: '',
          lineWidth: cloneBrushRadius * 2,
          points: [...pts],
          cloneSource: { ...cloneSource },
          cloneDragStart: { ...pts[0] },
          cloneShape: cloneSettings.shape,
          cloneEdgeBlur: cloneSettings.edgeBlur,
        });
      } else if ((activeTool === 'blur' || activeTool === 'pixelate') && pts.length >= 2) {
        onStrokeAdd({
          id: Math.random().toString(36).slice(2, 10),
          tool: activeTool,
          color: '',
          lineWidth: cloneBrushRadius * 2,
          points: [...pts],
          cloneShape: cloneSettings.shape,
          cloneEdgeBlur: cloneSettings.edgeBlur,
          brushAmount: cloneSettings.amount,
        });
      } else if (activeTool === 'select' && pts.length >= 2) {
        const start = pts[0];
        const end = pts[pts.length - 1];
        const dx = Math.abs(end.x - start.x);
        const dy = Math.abs(end.y - start.y);
        if (dx > 3 || dy > 3) {
          const sel = { x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };
          onSelectionChange?.(strokesInSelection(markupStrokes, sel));
        } else {
          onSelectionChange?.([]);
        }
        // Redraw to clear the drag rect; useEffect will add highlights after state updates
        const overlay = overlayCanvasRef.current;
        if (overlay) drawStrokes(overlay, markupStrokes, baseCanvasRef.current);
      } else if (activeTool !== 'select' && activeTool !== 'clone' && activeTool !== 'blur' && activeTool !== 'pixelate' && pts.length >= 2) {
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
    [activeTool, activeColor, activeLineWidth, cloneSource, cloneBrushRadius, cloneSettings, markupStrokes, getCanvasPoint, onStrokeAdd, onCropChange, onSelectionChange, onAreaSelect],
  );

  const handlePointerLeave = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const committed = committedOverlayRef.current;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (committed) ctx.drawImage(committed, 0, 0);
    if (selectedStrokeIds && selectedStrokeIds.length > 0) {
      drawSelectionHighlights(ctx, markupStrokes, selectedStrokeIds);
    }
  }, [markupStrokes, selectedStrokeIds]);

  const cursor =
    activeTool === 'select'
      ? 'default'
      : activeTool === 'crop'
      ? 'crosshair'
      : activeTool === 'text'
      ? 'text'
      : activeTool === 'clone'
      ? cloneSource
        ? 'copy'
        : 'crosshair'
      : 'crosshair';

  const showComparison = imgLoadCount > 0;

  return (
    <div
      ref={wrapperRef}
      className={styles.canvasWrapper}
      style={{ width: canvasSize.width, height: canvasSize.height, transform: `translate(${panOffset?.x ?? 0}px, ${panOffset?.y ?? 0}px) scale(${zoom / 100})` }}
    >
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
        onPointerLeave={handlePointerLeave}
        aria-label="Photo editing canvas"
        role="img"
      />

      {/* Text tool input — key forces remount on each new placement so autoFocus always fires */}
      {pendingText !== null && (
        <textarea
          key={`${pendingText.x}-${pendingText.y}`}
          ref={pendingTextRef}
          autoFocus
          value={pendingText.value}
          onChange={(e) => setPendingText({ ...pendingText, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setPendingText(null); e.preventDefault(); }
            else if (e.key === 'Enter' && !e.shiftKey) { commitPendingText(); e.preventDefault(); }
          }}
          style={{
            position: 'absolute',
            left: pendingText.x,
            top: pendingText.y,
            background: 'rgba(0,0,0,0.35)',
            border: '1.5px dashed rgba(255,255,255,0.5)',
            outline: 'none',
            color: textSettings.color,
            font: `${textSettings.size}px sans-serif`,
            resize: 'both',
            minWidth: 120,
            minHeight: Math.round(textSettings.size * 1.5),
            padding: '3px 6px',
            lineHeight: '1.4',
            zIndex: 20,
            borderRadius: 2,
          }}
        />
      )}

      {/* Clone tool hint */}
      {activeTool === 'clone' && (
        <div className={styles.cloneHint}>
          {cloneSource ? 'Drag to paint • Alt+click to set new source' : 'Alt+click to set clone source'}
        </div>
      )}

      {/* Before/after comparison slider */}
      {showComparison && (
        <>
          <span className={styles.comparisonLabel} style={{ left: 12, transform: `scale(${100 / zoom})`, transformOrigin: 'top left' }} aria-hidden="true">
            BEFORE
          </span>
          <span
            className={styles.comparisonLabel}
            style={{ left: `calc(${comparisonPos * 100}% + 12px)`, transform: `scale(${100 / zoom})`, transformOrigin: 'top left' }}
            aria-hidden="true"
          >
            AFTER
          </span>
          <div
            className={styles.comparisonHandle}
            style={{ left: `${comparisonPos * 100}%` }}
            aria-hidden="true"
          >
            <div
              className={styles.comparisonHandleBtn}
              style={{ transform: `translate(-50%, -50%) scale(${100 / zoom})` }}
              onPointerDown={handleComparisonDown}
              onPointerMove={handleComparisonMove}
              onPointerUp={handleComparisonUp}
              title="Drag to compare before / after"
            >
              <ChevronsLeftRight size={14} />
            </div>
          </div>
        </>
      )}
    </div>
  );
});
