'use client';

import React, { useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import type { Shape, Layer, ToolType, Transform, Point, ResizeHandle } from './types';

export interface DrawingCanvasHandle {
  setTransform: (t: Transform) => void;
  exportPNG: (options?: { scale?: number; bgColor?: string }) => Promise<Blob>;
  exportSVG: (options?: { bgColor?: string }) => string;
}

interface DrawingCanvasProps {
  shapes: Shape[];
  tool: ToolType;
  selectedIds: string[];
  onShapesChange: (shapes: Shape[]) => void;
  onSelectionChange: (ids: string[]) => void;
  onTransformChange?: (t: Transform) => void;
  showGrid?: boolean;
  layers?: Layer[];
  activeLayerId?: string;
}

const GRID_SIZE = 16;
const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 20;
const EXPORT_PAD = 24;

function shapeToSVGElement(shape: Shape): string {
  if (shape.hidden) return '';
  const stroke = shape.stroke || '#000000';
  const fill = shape.fill || 'transparent';
  const sw = shape.strokeWidth || 2;
  const opacity = shape.opacity ?? 1;
  const effectiveStyle = shape.strokeStyle ?? (shape.strokeDash ? 'dashed' : 'solid');
  const dash = effectiveStyle === 'dashed' ? `stroke-dasharray="${sw * 4} ${sw * 3}"`
    : effectiveStyle === 'dotted' ? `stroke-dasharray="${sw} ${sw * 2}"`
    : effectiveStyle === 'long-dash' ? `stroke-dasharray="${sw * 8} ${sw * 3}"`
    : '';
  const rot = shape.rotation ? `transform="rotate(${shape.rotation}, ${shape.x + shape.width / 2}, ${shape.y + shape.height / 2})"` : '';

  switch (shape.type) {
    case 'rectangle':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}" ${dash} ${rot}/>`;
    case 'ellipse': {
      const rx = Math.abs(shape.width) / 2;
      const ry = Math.abs(shape.height) / 2;
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}" ${dash} ${rot}/>`;
    }
    case 'line':
      return `<line x1="${shape.x}" y1="${shape.y}" x2="${shape.x + shape.width}" y2="${shape.y + shape.height}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}" ${dash} ${rot}/>`;
    case 'arrow': {
      const ex = shape.x + shape.width;
      const ey = shape.y + shape.height;
      const angle = Math.atan2(ey - shape.y, ex - shape.x);
      const headLen = 14;
      const x1 = ex - headLen * Math.cos(angle - Math.PI / 6);
      const y1 = ey - headLen * Math.sin(angle - Math.PI / 6);
      const x2 = ex - headLen * Math.cos(angle + Math.PI / 6);
      const y2 = ey - headLen * Math.sin(angle + Math.PI / 6);
      return `<g opacity="${opacity}" ${rot}><line x1="${shape.x}" y1="${shape.y}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="${sw}" ${dash}/><polygon points="${ex},${ey} ${x1},${y1} ${x2},${y2}" fill="${stroke}"/></g>`;
    }
    case 'pen': {
      if (shape.points.length < 2) return '';
      const d = shape.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" ${dash} ${rot}/>`;
    }
    case 'text': {
      const fontSize = Math.abs(shape.height) || 16;
      const fontFam = shape.fontFamily || 'sans-serif';
      const lines = (shape.text || '').split('\n');
      const lineHeight = fontSize * 1.2;
      const textEls = lines.map((line, i) =>
        `<tspan x="${shape.x}" dy="${i === 0 ? 0 : lineHeight}">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</tspan>`
      ).join('');
      return `<text x="${shape.x}" y="${shape.y + fontSize}" font-size="${fontSize}" font-family="${fontFam}" fill="${stroke}" opacity="${opacity}" ${rot}>${textEls}</text>`;
    }
    default:
      return '';
  }
}

function contentBounds(shapes: Shape[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    if (s.hidden) continue;
    const { x, y, w, h } = getBounds(s);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function screenToCanvas(sx: number, sy: number, t: Transform): Point {
  return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
}

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

// ── Bezier helpers ────────────────────────────────────────────────
function bezPt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
  };
}
function bezTan(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: 3*(mt*mt*(p1.x-p0.x) + 2*mt*t*(p2.x-p1.x) + t*t*(p3.x-p2.x)),
    y: 3*(mt*mt*(p1.y-p0.y) + 2*mt*t*(p2.y-p1.y) + t*t*(p3.y-p2.y)),
  };
}
function bezLen(p0: Point, p1: Point, p2: Point, p3: Point, steps = 80): number {
  let len = 0, prev = p0;
  for (let i = 1; i <= steps; i++) {
    const cur = bezPt(p0, p1, p2, p3, i / steps);
    len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    prev = cur;
  }
  return len;
}
function bezTAtLen(p0: Point, p1: Point, p2: Point, p3: Point, target: number, steps = 80): number {
  let len = 0, prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cur = bezPt(p0, p1, p2, p3, t);
    const seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (len + seg >= target) return t - (1 / steps) * (1 - (target - len) / Math.max(seg, 0.0001));
    len += seg;
    prev = cur;
  }
  return 1;
}

// Exact bounding box of a cubic bezier (finds t where dx/dt=0 and dy/dt=0)
function bezierBounds(p0: Point, p1: Point, p2: Point, p3: Point) {
  const ts = [0, 1];
  for (const axis of ['x', 'y'] as const) {
    const A = p1[axis] - p0[axis];
    const B = p2[axis] - p1[axis];
    const C = p3[axis] - p2[axis];
    const a = A - 2 * B + C;
    const b = -2 * A + 2 * B;
    const c = A;
    if (Math.abs(a) < 1e-10) {
      if (Math.abs(b) > 1e-10) { const t = -c / b; if (t > 0 && t < 1) ts.push(t); }
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b + sq) / (2 * a);
        const t2 = (-b - sq) / (2 * a);
        if (t1 > 0 && t1 < 1) ts.push(t1);
        if (t2 > 0 && t2 < 1) ts.push(t2);
      }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of ts) {
    const pt = bezPt(p0, p1, p2, p3, t);
    minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
  }
  return { minX, minY, maxX, maxY };
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

let _measureCtx: CanvasRenderingContext2D | null = null;
function measureTextWidth(text: string, fontSize: number, fontFamily: string): number {
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  _measureCtx.font = `${fontSize}px ${fontFamily}`;
  const lines = text.split('\n');
  return Math.max(...lines.map((l) => _measureCtx!.measureText(l).width), 1);
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
  if (shape.type === 'text') {
    const fontSize = Math.abs(shape.height) || 16;
    if (shape.textCurve) {
      const { bottom, top, mode } = shape.textCurve;
      const b = bezierBounds(bottom.p0, bottom.p1, bottom.p2, bottom.p3);
      let minX = b.minX, minY = b.minY, maxX = b.maxX, maxY = b.maxY;
      if (mode === 'double' && top) {
        const tb = bezierBounds(top.p0, top.p1, top.p2, top.p3);
        minX = Math.min(minX, tb.minX); minY = Math.min(minY, tb.minY);
        maxX = Math.max(maxX, tb.maxX); maxY = Math.max(maxY, tb.maxY);
      }
      // Expand for ascenders above baseline and descenders below
      return {
        x: minX,
        y: minY - fontSize * 0.75,
        w: maxX - minX,
        h: (maxY - minY) + fontSize * 0.75 + fontSize * 0.2,
      };
    }
    const fontFamily = shape.fontFamily || 'sans-serif';
    const lines = (shape.text || '').split('\n');
    const measuredW = measureTextWidth(shape.text || '', fontSize, fontFamily);
    const topInset = fontSize * 0.25;
    const h = fontSize * (lines.length * 1.2 - 0.25);
    return { x: shape.x, y: shape.y + topInset, w: measuredW, h };
  }
  if ((shape.type === 'line' || shape.type === 'arrow') && shape.lineCurve) {
    const c = shape.lineCurve;
    const b = bezierBounds(c.p0, c.p1, c.p2, c.p3);
    const pad = (shape.strokeWidth || 2) / 2 + 4;
    return { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
  }
  return { x: shape.x, y: shape.y, w: shape.width || 1, h: shape.height || 1 };
}

function unrotatePoint(px: number, py: number, scx: number, scy: number, angleDeg: number): Point {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: scx + (px - scx) * cos - (py - scy) * sin,
    y: scy + (px - scx) * sin + (py - scy) * cos,
  };
}

function hitTest(shape: Shape, cx: number, cy: number): boolean {
  const { x, y, w, h } = getBounds(shape);
  let testX = cx;
  let testY = cy;
  if (shape.rotation) {
    const p = unrotatePoint(cx, cy, x + w / 2, y + h / 2, shape.rotation);
    testX = p.x;
    testY = p.y;
  }
  if (shape.type === 'pen') {
    return shape.points.some((p) => Math.hypot(p.x - testX, p.y - testY) < 8);
  }
  const pad = 4;
  return testX >= x - pad && testX <= x + w + pad && testY >= y - pad && testY <= y + h + pad;
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

function splitGradArgs(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseGradStops(parts: string[]): { color: string; position: number }[] {
  const raw = parts.map((s) => {
    const p = s.trim().split(/\s+/);
    if (!/^#[0-9a-fA-F]{3,8}$/.test(p[0])) return null;
    const pct = p[1]?.match(/^(\d+(?:\.\d+)?)%$/);
    return { color: p[0], position: pct ? parseFloat(pct[1]) : -1 };
  }).filter((x): x is { color: string; position: number } => x !== null);
  return raw.map((s, i) => ({ ...s, position: s.position >= 0 ? s.position : Math.round(i * 100 / Math.max(1, raw.length - 1)) }));
}

const DIR_ANGLE: Record<string, number> = {
  'to top': 0, 'to top right': 45, 'to right': 90, 'to bottom right': 135,
  'to bottom': 180, 'to bottom left': 225, 'to left': 270, 'to top left': 315,
};

function resolveCanvasFill(
  ctx: CanvasRenderingContext2D,
  fill: string,
  x: number, y: number, w: number, h: number,
): string | CanvasGradient {
  const lin = fill.match(/^linear-gradient\((.+)\)$/is);
  if (lin) {
    const args = splitGradArgs(lin[1]);
    let angle = 180, startIdx = 0;
    const first = args[0]?.trim() ?? '';
    const deg = first.match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (deg) { angle = parseFloat(deg[1]); startIdx = 1; }
    else if (/^to\s+/i.test(first)) { angle = DIR_ANGLE[first.toLowerCase().trim()] ?? 180; startIdx = 1; }
    const dx = Math.sin((angle * Math.PI) / 180);
    const dy = -Math.cos((angle * Math.PI) / 180);
    const cx = x + w / 2, cy = y + h / 2;
    const halfLen = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    const grad = ctx.createLinearGradient(cx - dx * halfLen, cy - dy * halfLen, cx + dx * halfLen, cy + dy * halfLen);
    parseGradStops(args.slice(startIdx)).forEach(({ color, position }) => grad.addColorStop(position / 100, color));
    return grad;
  }
  const rad = fill.match(/^radial-gradient\((.+)\)$/is);
  if (rad) {
    const args = splitGradArgs(rad[1]);
    const startIdx = /^#/.test(args[0]?.trim() ?? '') ? 0 : 1;
    const cx = x + w / 2, cy = y + h / 2;
    const r = Math.max(Math.abs(w), Math.abs(h)) / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    parseGradStops(args.slice(startIdx)).forEach(({ color, position }) => grad.addColorStop(position / 100, color));
    return grad;
  }
  return fill || 'transparent';
}

function renderShape(ctx: CanvasRenderingContext2D, shape: Shape, isSelected: boolean) {
  if (shape.hidden) return;
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;
  ctx.strokeStyle = shape.stroke || '#000000';
  ctx.lineWidth = shape.strokeWidth || 2;
  const { x, y, w, h } = getBounds(shape);
  ctx.fillStyle = resolveCanvasFill(ctx, shape.fill || 'transparent', x, y, w, h);
  const dashStyle = shape.strokeStyle ?? (shape.strokeDash ? 'dashed' : 'solid');
  const dsw = shape.strokeWidth || 2;
  switch (dashStyle) {
    case 'dashed':    ctx.setLineDash([dsw * 4, dsw * 3]); break;
    case 'dotted':    ctx.setLineDash([dsw, dsw * 2]);      break;
    case 'long-dash': ctx.setLineDash([dsw * 8, dsw * 3]); break;
    default:          ctx.setLineDash([]);
  }

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
      if (shape.lineCurve) {
        const c = shape.lineCurve;
        ctx.moveTo(c.p0.x, c.p0.y);
        ctx.bezierCurveTo(c.p1.x, c.p1.y, c.p2.x, c.p2.y, c.p3.x, c.p3.y);
      } else {
        ctx.moveTo(shape.x, shape.y);
        ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
      }
      ctx.stroke();
      break;
    }
    case 'arrow': {
      let ex: number, ey: number, angle: number;
      ctx.beginPath();
      if (shape.lineCurve) {
        const c = shape.lineCurve;
        ctx.moveTo(c.p0.x, c.p0.y);
        ctx.bezierCurveTo(c.p1.x, c.p1.y, c.p2.x, c.p2.y, c.p3.x, c.p3.y);
        ex = c.p3.x; ey = c.p3.y;
        const tan = bezTan(c.p0, c.p1, c.p2, c.p3, 1);
        angle = Math.atan2(tan.y, tan.x);
      } else {
        ex = shape.x + shape.width; ey = shape.y + shape.height;
        angle = Math.atan2(ey - shape.y, ex - shape.x);
        ctx.moveTo(shape.x, shape.y);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
      const headLen = 14;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
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
      const fontFam = shape.fontFamily || 'sans-serif';
      ctx.font = `${fontSize}px ${fontFam}`;
      ctx.fillStyle = shape.stroke || '#000000';
      if (shape.shadowEnabled) {
        ctx.shadowColor = shape.shadowColor || 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = shape.shadowBlur ?? 4;
        ctx.shadowOffsetX = shape.shadowOffsetX ?? 2;
        ctx.shadowOffsetY = shape.shadowOffsetY ?? 2;
      }
      if (shape.textCurve) {
        const tc = shape.textCurve;
        const { p0, p1, p2, p3 } = tc.bottom;
        const text = shape.text || '';
        const totalLen = bezLen(p0, p1, p2, p3);
        const totalW = ctx.measureText(text).width;
        let offset = Math.max(0, (totalLen - totalW) / 2);
        for (const char of text) {
          const cw = ctx.measureText(char).width;
          const t = bezTAtLen(p0, p1, p2, p3, offset + cw / 2);
          const pos = bezPt(p0, p1, p2, p3, t);
          const tan = bezTan(p0, p1, p2, p3, t);
          const ang = Math.atan2(tan.y, tan.x);
          if (tc.mode === 'double' && tc.top) {
            // Stretch character vertically between bottom and top curves
            const tp = { p0: tc.top.p0, p1: tc.top.p1, p2: tc.top.p2, p3: tc.top.p3 };
            const tPos = bezPt(tp.p0, tp.p1, tp.p2, tp.p3, t);
            const dist = Math.hypot(tPos.x - pos.x, tPos.y - pos.y);
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(ang);
            ctx.scale(1, dist / fontSize);
            ctx.fillText(char, -cw / 2, 0);
            ctx.restore();
          } else {
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(ang);
            ctx.fillText(char, -cw / 2, 0);
            ctx.restore();
          }
          offset += cw;
        }
      } else {
        const lines = (shape.text || '').split('\n');
        const lineHeight = fontSize * 1.2;
        lines.forEach((line, i) => {
          ctx.fillText(line, shape.x, shape.y + fontSize + i * lineHeight);
        });
      }
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
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  if (shape.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
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

  // Bezier curve control handles (drawn outside the rotation transform)
  if (shape.lineCurve) {
    renderCurveHandles(ctx, [shape.lineCurve]);
  }
  if (shape.textCurve) {
    const curves = [shape.textCurve.bottom];
    if (shape.textCurve.mode === 'double' && shape.textCurve.top) curves.push(shape.textCurve.top);
    renderCurveHandles(ctx, curves);
  }
}

const CURVE_HANDLE_R = 5;

function renderCurveHandles(ctx: CanvasRenderingContext2D, curves: { p0: Point; p1: Point; p2: Point; p3: Point }[]) {
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  for (const c of curves) {
    // Guide lines: p0→p1 and p3→p2
    ctx.beginPath(); ctx.moveTo(c.p0.x, c.p0.y); ctx.lineTo(c.p1.x, c.p1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.p3.x, c.p3.y); ctx.lineTo(c.p2.x, c.p2.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const c of curves) {
    for (const pt of [c.p1, c.p2]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, CURVE_HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
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

type DragMode = 'none' | 'drawing' | 'moving' | 'resizing' | 'rotating' | 'box-select' | 'panning' | 'curve-control';

// which bezier control point is being dragged
type CurvePointId =
  | { kind: 'line'; point: 'p1' | 'p2' }
  | { kind: 'text-bottom'; point: 'p1' | 'p2' }
  | { kind: 'text-top'; point: 'p1' | 'p2' };

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
  curvePoint?: CurvePointId;
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas({
  shapes,
  tool,
  selectedIds,
  onShapesChange,
  onSelectionChange,
  onTransformChange,
  showGrid = true,
  layers = [],
  activeLayerId = 'background',
}: DrawingCanvasProps, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const shapesRef = useRef(shapes);
  const toolRef = useRef(tool);
  const selectedIdsRef = useRef(selectedIds);
  const showGridRef = useRef(showGrid);
  const layersRef = useRef(layers);
  const activeLayerIdRef = useRef(activeLayerId);
  const dragRef = useRef<DragState>({ mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0 });
  const spaceDownRef = useRef(false);
  const currentShapeRef = useRef<Shape | null>(null);

  const [, forceRender] = useState(0);

  const [textEdit, setTextEdit] = useState<{
    shapeId: string | null;
    x: number;
    y: number;
    fontSize: number;
    value: string;
    capturedTransform: Transform;
  } | null>(null);
  // Metadata ref set synchronously when a text edit session starts/ends — never stale.
  // value is updated on every onChange keystroke so commitTextEdit never reads a stale/null DOM ref.
  const textEditMetaRef = useRef<{
    shapeId: string | null;
    x: number;
    y: number;
    fontSize: number;
    capturedTransform: Transform;
    value: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // True only after the first animation frame after textarea mounts.
  // Guards onBlur against spurious blur fired by React 18 StrictMode's DOM removal during effect cleanup.
  const textEditReadyRef = useRef(false);

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { activeLayerIdRef.current = activeLayerId; }, [activeLayerId]);
  showGridRef.current = showGrid;

  function layerOf(s: Shape) {
    return layersRef.current.find((l) => l.id === s.layerId)
      ?? layersRef.current.find((l) => l.isBackground);
  }
  function shapeEffectivelyHidden(s: Shape) { return s.hidden || (layerOf(s)?.hidden ?? false); }
  function shapeEffectivelyLocked(s: Shape) { return s.locked || (layerOf(s)?.locked ?? false); }

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    const t = transformRef.current;

    ctx.clearRect(0, 0, width, height);
    if (showGridRef.current) renderGrid(ctx, t, width, height);

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);

    for (const shape of shapesRef.current) {
      if (shape.id === textEditMetaRef.current?.shapeId) continue;
      if (shapeEffectivelyHidden(shape)) continue;
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

  useImperativeHandle(ref, () => ({
    setTransform: (t: Transform) => {
      transformRef.current = t;
      onTransformChange?.(t);
      render();
    },
    exportPNG: ({ scale = 2, bgColor = '' } = {}): Promise<Blob> => {
      const visibleShapes = shapesRef.current.filter((s) => !shapeEffectivelyHidden(s));
      const bounds = contentBounds(visibleShapes);
      const padX = bounds ? bounds.x - EXPORT_PAD : 0;
      const padY = bounds ? bounds.y - EXPORT_PAD : 0;
      const cw = Math.max(1, (bounds ? bounds.w + EXPORT_PAD * 2 : 100)) * scale;
      const ch = Math.max(1, (bounds ? bounds.h + EXPORT_PAD * 2 : 100)) * scale;

      const offscreen = document.createElement('canvas');
      offscreen.width = cw;
      offscreen.height = ch;
      const ctx = offscreen.getContext('2d')!;
      if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.scale(scale, scale);
      ctx.translate(-padX, -padY);
      for (const shape of visibleShapes) {
        renderShape(ctx, shape, false);
      }
      return new Promise<Blob>((resolve, reject) => {
        offscreen.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('toBlob failed'));
        }, 'image/png');
      });
    },
    exportSVG: ({ bgColor = '' } = {}): string => {
      const visibleShapes = shapesRef.current.filter((s) => !shapeEffectivelyHidden(s));
      const bounds = contentBounds(visibleShapes);
      const x = bounds ? bounds.x - EXPORT_PAD : 0;
      const y = bounds ? bounds.y - EXPORT_PAD : 0;
      const w = Math.max(1, bounds ? bounds.w + EXPORT_PAD * 2 : 100);
      const h = Math.max(1, bounds ? bounds.h + EXPORT_PAD * 2 : 100);
      const bgRect = bgColor ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bgColor}"/>` : '';
      const els = visibleShapes.map(shapeToSVGElement).filter(Boolean).join('\n');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">\n${bgRect}\n${els}\n</svg>`;
    },
  }), [onTransformChange, render]);

  useEffect(() => { render(); }, [shapes, selectedIds, showGrid, layers, render]);
  useEffect(() => { render(); }, [textEdit !== null, render]); // eslint-disable-line react-hooks/exhaustive-deps
  // Focus the textarea and guard onBlur against spurious blur from React 18 StrictMode.
  // StrictMode removes DOM nodes between effect cleanup/setup; the focused textarea fires blur
  // when removed. We set textEditReadyRef=true only after a requestAnimationFrame so any blur
  // that fires before the DOM has stabilised is ignored by onBlur.
  useEffect(() => {
    if (textEdit !== null) {
      textEditReadyRef.current = false;
      const rafId = requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textEditReadyRef.current = true;
      });
      return () => {
        cancelAnimationFrame(rafId);
        textEditReadyRef.current = false;
      };
    }
  }, [textEdit !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const getCanvasPos = useCallback((e: MouseEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, transformRef.current);
  }, []);

  const findHitCurvePoint = useCallback((cp: Point): { shapeId: string; curvePoint: CurvePointId } | null => {
    for (const id of selectedIdsRef.current) {
      const shape = shapesRef.current.find((s) => s.id === id);
      if (!shape) continue;
      const candidates: { pt: Point; cpId: CurvePointId }[] = [];
      if (shape.lineCurve) {
        candidates.push({ pt: shape.lineCurve.p1, cpId: { kind: 'line', point: 'p1' } });
        candidates.push({ pt: shape.lineCurve.p2, cpId: { kind: 'line', point: 'p2' } });
      }
      if (shape.textCurve) {
        candidates.push({ pt: shape.textCurve.bottom.p1, cpId: { kind: 'text-bottom', point: 'p1' } });
        candidates.push({ pt: shape.textCurve.bottom.p2, cpId: { kind: 'text-bottom', point: 'p2' } });
        if (shape.textCurve.top) {
          candidates.push({ pt: shape.textCurve.top.p1, cpId: { kind: 'text-top', point: 'p1' } });
          candidates.push({ pt: shape.textCurve.top.p2, cpId: { kind: 'text-top', point: 'p2' } });
        }
      }
      for (const { pt, cpId } of candidates) {
        if (Math.hypot(pt.x - cp.x, pt.y - cp.y) <= CURVE_HANDLE_R + 3) {
          return { shapeId: id, curvePoint: cpId };
        }
      }
    }
    return null;
  }, []);

  const findHitHandle = useCallback(
    (cp: Point): { shapeId: string; handle: ResizeHandle } | null => {
      for (const id of selectedIdsRef.current) {
        const shape = shapesRef.current.find((s) => s.id === id);
        if (!shape) continue;
        const { x, y, w, h } = getBounds(shape);
        const handles = getHandlePositions(x, y, w, h);
        // Unrotate the cursor into the shape's local space so handle positions match what's rendered
        const local = shape.rotation
          ? unrotatePoint(cp.x, cp.y, x + w / 2, y + h / 2, shape.rotation)
          : cp;
        for (const [key, hp] of Object.entries(handles) as [ResizeHandle, Point][]) {
          if (hitTestHandle(hp.x, hp.y, local.x, local.y, key === 'rotate')) {
            return { shapeId: id, handle: key };
          }
        }
      }
      return null;
    },
    [],
  );

  const commitTextEdit = useCallback(() => {
    const meta = textEditMetaRef.current;
    if (!meta) return;
    textEditMetaRef.current = null;
    const trimmed = (meta.value ?? '').trim();
    setTextEdit(null);
    if (meta.shapeId === null) {
      if (trimmed) {
        const tmpCtx = document.createElement('canvas').getContext('2d')!;
        tmpCtx.font = `${meta.fontSize}px sans-serif`;
        const lines = trimmed.split('\n');
        const measuredW = Math.max(...lines.map((l) => tmpCtx.measureText(l).width));
        const newShape: Shape = {
          id: generateId(),
          type: 'text',
          x: meta.x, y: meta.y,
          width: Math.max(measuredW, 40),
          height: meta.fontSize,
          points: [],
          text: trimmed,
          fill: 'transparent',
          stroke: '#000000',
          strokeWidth: 1,
          rotation: 0,
          opacity: 1,
          layerId: activeLayerIdRef.current,
        };
        onShapesChange([...shapesRef.current, newShape]);
        onSelectionChange([newShape.id]);
      }
    } else {
      if (trimmed) {
        const orig = shapesRef.current.find((s) => s.id === meta.shapeId);
        const tmpCtx = document.createElement('canvas').getContext('2d')!;
        tmpCtx.font = `${orig?.height || meta.fontSize}px sans-serif`;
        const lines = trimmed.split('\n');
        const measuredW = Math.max(...lines.map((l) => tmpCtx.measureText(l).width));
        onShapesChange(
          shapesRef.current.map((s) =>
            s.id === meta.shapeId ? { ...s, text: trimmed, width: Math.max(measuredW, 40) } : s
          )
        );
      } else {
        onShapesChange(shapesRef.current.filter((s) => s.id !== meta.shapeId));
        onSelectionChange(selectedIdsRef.current.filter((id) => id !== meta.shapeId));
      }
    }
  }, [onShapesChange, onSelectionChange]);

  const cancelTextEdit = useCallback(() => {
    textEditMetaRef.current = null;
    setTextEdit(null);
  }, []);

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
        // Check curve control points first (they sit on top of the shape)
        const hitCurve = findHitCurvePoint(cp);
        if (hitCurve) {
          dragRef.current = {
            mode: 'curve-control',
            startX: cp.x, startY: cp.y,
            lastX: cp.x, lastY: cp.y,
            curvePoint: hitCurve.curvePoint,
            initialShapes: shapesRef.current.map((s) => ({ ...s, points: [...s.points] })),
          };
          return;
        }

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

        const hit = [...shapesRef.current].reverse().find((s) => !shapeEffectivelyLocked(s) && !shapeEffectivelyHidden(s) && hitTest(s, cp.x, cp.y));
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
        const hit = [...shapesRef.current].reverse().find((s) => !shapeEffectivelyLocked(s) && !shapeEffectivelyHidden(s) && hitTest(s, cp.x, cp.y));
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
          layerId: activeLayerIdRef.current,
        };
        currentShapeRef.current = newShape;
        dragRef.current = {
          mode: 'drawing',
          startX: snappedX, startY: snappedY,
          lastX: snappedX, lastY: snappedY,
          penShapeId: newShape.id,
        };
      } else if (currentTool === 'text') {
        // Text tool is handled by the React synthetic onMouseDown on the canvas element.
        // The native listener just resets drag state and returns.
        dragRef.current = { mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0 };
        return;
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
          layerId: activeLayerIdRef.current,
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
    [getCanvasPos, findHitCurvePoint, findHitHandle, onSelectionChange, onShapesChange, render],
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
            const hit = [...shapesRef.current].reverse().find((s) => !shapeEffectivelyLocked(s) && !shapeEffectivelyHidden(s) && hitTest(s, cp.x, cp.y));
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
        const snapH = orig.type === 'text'
          ? (v: number) => Math.max(1, Math.round(v))
          : snapToGrid;

        switch (drag.handle) {
          case 'se': w = snapToGrid(orig.width + dx); h = snapH(orig.height + dy); break;
          case 'sw': x = snapToGrid(orig.x + dx); w = snapToGrid(orig.width - dx); h = snapH(orig.height + dy); break;
          case 'ne': w = snapToGrid(orig.width + dx); y = snapToGrid(orig.y + dy); h = snapH(orig.height - dy); break;
          case 'nw': x = snapToGrid(orig.x + dx); y = snapToGrid(orig.y + dy); w = snapToGrid(orig.width - dx); h = snapH(orig.height - dy); break;
          case 'e':  w = snapToGrid(orig.width + dx); break;
          case 'w':  x = snapToGrid(orig.x + dx); w = snapToGrid(orig.width - dx); break;
          case 's':  h = snapH(orig.height + dy); break;
          case 'n':  y = snapToGrid(orig.y + dy); h = snapH(orig.height - dy); break;
        }
        if (orig.type === 'text') {
          w = measureTextWidth(orig.text || '', h, orig.fontFamily || 'sans-serif');
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

      if (drag.mode === 'curve-control' && drag.curvePoint && drag.initialShapes) {
        const targetId = selectedIdsRef.current[0];
        if (!targetId) return;
        const orig = drag.initialShapes.find((s) => s.id === targetId);
        if (!orig) return;
        const dx = cp.x - drag.startX;
        const dy = cp.y - drag.startY;
        const { kind, point } = drag.curvePoint;
        onShapesChange(shapesRef.current.map((s) => {
          if (s.id !== targetId) return s;
          if (kind === 'line' && s.lineCurve && orig.lineCurve) {
            return { ...s, lineCurve: { ...s.lineCurve, [point]: { x: orig.lineCurve[point].x + dx, y: orig.lineCurve[point].y + dy } } };
          }
          if ((kind === 'text-bottom' || kind === 'text-top') && s.textCurve && orig.textCurve) {
            const tc = { ...s.textCurve };
            if (kind === 'text-bottom') {
              tc.bottom = { ...tc.bottom, [point]: { x: orig.textCurve.bottom[point].x + dx, y: orig.textCurve.bottom[point].y + dy } };
            } else if (kind === 'text-top' && tc.top && orig.textCurve.top) {
              tc.top = { ...tc.top, [point]: { x: orig.textCurve.top[point].x + dx, y: orig.textCurve.top[point].y + dy } };
            }
            return { ...s, textCurve: tc };
          }
          return s;
        }));
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

  const handleTextMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (toolRef.current !== 'text') return;
    if (e.button !== 0) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cp = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, transformRef.current);
    const snappedX = snapToGrid(cp.x);
    const snappedY = snapToGrid(cp.y);
    const hitText = [...shapesRef.current].reverse().find(
      (s) => s.type === 'text' && !shapeEffectivelyLocked(s) && !shapeEffectivelyHidden(s) && hitTest(s, cp.x, cp.y)
    );
    if (hitText) {
      const meta = { shapeId: hitText.id, x: hitText.x, y: hitText.y, fontSize: hitText.height || 16, capturedTransform: { ...transformRef.current }, value: hitText.text || '' };
      textEditMetaRef.current = meta;
      setTextEdit({ ...meta });
      onSelectionChange([hitText.id]);
    } else {
      const meta = { shapeId: null, x: snappedX, y: snappedY, fontSize: 16, capturedTransform: { ...transformRef.current }, value: '' };
      textEditMetaRef.current = meta;
      setTextEdit({ ...meta });
      onSelectionChange([]);
    }
  }, [onSelectionChange]);

  const onDblClick = useCallback((e: MouseEvent) => {
    if (toolRef.current !== 'select') return;
    const cp = getCanvasPos(e);
    const hit = [...shapesRef.current].reverse().find(
      (s) => s.type === 'text' && !shapeEffectivelyLocked(s) && !shapeEffectivelyHidden(s) && hitTest(s, cp.x, cp.y)
    );
    if (!hit) return;
    const meta = { shapeId: hit.id, x: hit.x, y: hit.y, fontSize: hit.height || 16, capturedTransform: { ...transformRef.current }, value: hit.text || '' };
    textEditMetaRef.current = meta;
    setTextEdit({ ...meta });
    onSelectionChange([hit.id]);
  }, [getCanvasPos, onSelectionChange]);

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;

      if (e.ctrlKey) {
        // Pinch-to-zoom: browser sets ctrlKey=true for trackpad pinch gestures
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1 / 0.9;
        const newScale = Math.max(0.1, Math.min(10, t.scale * factor));
        const newX = mx - (mx - t.x) * (newScale / t.scale);
        const newY = my - (my - t.y) * (newScale / t.scale);
        transformRef.current = { x: newX, y: newY, scale: newScale };
      } else {
        // Two-finger scroll: pan the canvas
        transformRef.current = {
          ...t,
          x: t.x - e.deltaX,
          y: t.y - e.deltaY,
        };
      }

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
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        spaceDownRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('dblclick', onDblClick);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onMouseDown, onDblClick, onMouseMove, onMouseUp, onWheel, render]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !textEdit) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
    ta.style.width = 'auto';
    ta.style.width = `${Math.max(ta.scrollWidth, 80)}px`;
  }, [textEdit?.value, textEdit]);

  const cursorStyle: React.CSSProperties['cursor'] = (() => {
    if (spaceDownRef.current) return 'grab';
    switch (tool) {
      case 'select': return 'default';
      case 'eraser': return 'crosshair';
      case 'text': return 'text';
      default: return 'crosshair';
    }
  })();

  const tePos = textEdit
    ? {
        x: textEdit.x * textEdit.capturedTransform.scale + textEdit.capturedTransform.x,
        y: (textEdit.y + textEdit.fontSize * 0.25) * textEdit.capturedTransform.scale + textEdit.capturedTransform.y,
        fontSize: textEdit.fontSize * textEdit.capturedTransform.scale,
      }
    : null;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: cursorStyle }}
        onMouseDown={handleTextMouseDown}
      />
      {textEdit && tePos && (
        <textarea
          ref={textareaRef}
          value={textEdit.value}
          onChange={(e) => {
            if (textEditMetaRef.current) textEditMetaRef.current.value = e.target.value;
            setTextEdit((prev) => prev ? { ...prev, value: e.target.value } : null);
          }}
          onBlur={() => { if (textEditReadyRef.current) commitTextEdit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); cancelTextEdit(); }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
          }}
          style={{
            position: 'absolute',
            left: tePos.x,
            top: tePos.y,
            fontSize: tePos.fontSize,
            fontFamily: 'sans-serif',
            border: '1.5px dashed #2563eb',
            borderRadius: 2,
            outline: 'none',
            background: 'transparent',
            color: '#000000',
            resize: 'none',
            overflow: 'hidden',
            minWidth: 80,
            padding: '0 2px',
            lineHeight: 1.2,
            whiteSpace: 'pre',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
});
