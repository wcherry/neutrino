/**
 * A diagram page as geometry, independent of React.
 *
 * `EmbeddedDiagramView` draws a page as JSX and the Slides PDF export draws the
 * same page as an SVG string — pdfmake takes markup, not elements — so the
 * shape paths, connector routing and view box live here rather than being
 * written twice and drifting apart.
 */

import { diagramsApi } from '@neutrino/api-diagrams';
import type {
  DiagramDocument,
  DiagramPage,
  DiagramShape,
  DiagramConnector,
  FreehandStroke,
} from '../types';
import { fillDefFor, fillPaint } from './utils/shapeFill';

export function getShapePath(shape: DiagramShape): string {
  const { x, y, width: w, height: h } = shape;
  switch (shape.type) {
    case 'ellipse':
    case 'circle':
      return `M ${x + w / 2} ${y} A ${w / 2} ${h / 2} 0 1 1 ${x + w / 2 - 0.01} ${y}`;
    case 'diamond':
    case 'flowchart-decision':
      return `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`;
    case 'triangle':
      return `M ${x + w / 2} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    default:
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }
}

export function getConnectorPoints(conn: DiagramConnector, shapes: DiagramShape[]): string {
  const shapeMap = new Map(shapes.map((s) => [s.id, s]));
  let x1 = conn.startPoint?.x ?? 0;
  let y1 = conn.startPoint?.y ?? 0;
  let x2 = conn.endPoint?.x ?? 0;
  let y2 = conn.endPoint?.y ?? 0;

  if (conn.sourceId) {
    const s = shapeMap.get(conn.sourceId);
    if (s) { x1 = s.x + s.width / 2; y1 = s.y + s.height / 2; }
  }
  if (conn.targetId) {
    const s = shapeMap.get(conn.targetId);
    if (s) { x2 = s.x + s.width / 2; y2 = s.y + s.height / 2; }
  }

  const pts = [`${x1},${y1}`, ...conn.waypoints.map((p) => `${p.x},${p.y}`), `${x2},${y2}`];
  return pts.join(' ');
}

/**
 * The box that holds everything drawn on a page, padded.
 *
 * Everything, not just the shapes: a connector between two free points and a
 * freehand stroke are drawn by every renderer that uses this, so leaving them
 * out of the box clipped them out of the picture. That matters most for a page
 * saved as an SVG file, where the box is the whole document rather than a
 * viewport someone can scroll.
 */
export function computeViewBox(page: DiagramPage): string {
  const pad = 20;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const s of page.shapes) {
    expand(s.x, s.y);
    expand(s.x + s.width, s.y + s.height);
  }
  for (const c of page.connectors) {
    if (c.startPoint) expand(c.startPoint.x, c.startPoint.y);
    if (c.endPoint) expand(c.endPoint.x, c.endPoint.y);
    for (const wp of c.waypoints) expand(wp.x, wp.y);
  }
  for (const stroke of page.strokes ?? []) {
    for (let i = 0; i + 1 < stroke.points.length; i += 2) {
      expand(stroke.points[i], stroke.points[i + 1]);
    }
  }

  if (!isFinite(minX)) return '0 0 400 300';
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
}

/**
 * A freehand stroke as a path, smoothed through the midpoints between samples.
 *
 * Shared with the canvas's `StrokeRenderer` so a stroke drawn on screen and the
 * same stroke in an exported or saved SVG are the same curve.
 */
export function freehandStrokePath(stroke: FreehandStroke): string | null {
  const pts = stroke.points;
  if (pts.length < 4) return null;
  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    d += ` Q ${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  d += ` L ${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
  return d;
}

/** How each drawing tool paints its path, over the stroke's own colour and width. */
export function freehandStrokePaint(stroke: FreehandStroke): {
  strokeWidth: number;
  opacity: number;
  dash: string | null;
} {
  if (stroke.tool === 'highlighter') {
    return { strokeWidth: stroke.width * 2, opacity: 0.35, dash: null };
  }
  if (stroke.tool === 'pencil') {
    return { strokeWidth: stroke.width, opacity: stroke.opacity, dash: '1 1' };
  }
  return { strokeWidth: stroke.width, opacity: stroke.opacity, dash: null };
}

/** The midpoint label position `EmbeddedDiagramView` uses for a connector. */
export function connectorLabelAnchor(points: string): { x: number; y: number } {
  const pts = points.split(' ');
  const mid = pts[Math.floor(pts.length / 2)]?.split(',') ?? ['0', '0'];
  return { x: parseFloat(mid[0] ?? '0'), y: parseFloat(mid[1] ?? '0') - 6 };
}

/** XML-escapes a value so arbitrary labels and colours cannot break the markup. */
function xml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface DiagramSvgOptions {
  width: number;
  height: number;
  /** Painted behind the shapes; omit for a transparent diagram. */
  background?: string | null;
  /**
   * Image fills resolved to something loadable, keyed by the value stored on
   * the shape (`collectFillImages` lists what to resolve). The markup this
   * produces has to stand alone — a PDF has no way to fetch a Drive file — so
   * these must be data URLs, and a fill left out of the map falls back to the
   * shape's colour rather than rendering as a hole.
   */
  images?: ReadonlyMap<string, string>;
}

/** The `<defs>` entries for gradient and image fills, as markup. */
function fillDefsMarkup(shapes: DiagramShape[], images?: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  for (const shape of shapes) {
    const def = fillDefFor(shape, shape.style, images);
    if (!def) continue;

    if (def.kind === 'gradient') {
      const stops = def.gradient.stops
        .map((s) => `<stop offset="${s.position}%" stop-color="${xml(s.color)}"/>`)
        .join('');
      parts.push(def.gradient.kind === 'radial'
        ? `<radialGradient id="${xml(def.id)}" cx="50%" cy="50%" r="50%">${stops}</radialGradient>`
        : `<linearGradient id="${xml(def.id)}" x1="${def.gradient.x1}" y1="${def.gradient.y1}"` +
          ` x2="${def.gradient.x2}" y2="${def.gradient.y2}">${stops}</linearGradient>`);
      continue;
    }

    parts.push(
      `<pattern id="${xml(def.id)}" patternUnits="userSpaceOnUse" x="${def.x}" y="${def.y}"` +
      ` width="${def.width}" height="${def.height}">` +
      `<image href="${xml(def.href)}" x="0" y="0" width="${def.width}" height="${def.height}"` +
      ` preserveAspectRatio="${xml(def.aspect)}"/></pattern>`,
    );
  }
  return parts.join('');
}

/**
 * One diagram page as a standalone SVG document.
 *
 * The page is fitted into `width` × `height` with `xMidYMid meet`, matching the
 * embedded viewer, so a diagram placed on a slide keeps its aspect ratio rather
 * than stretching to whatever box it was dropped into.
 */
export function diagramPageToSvg(page: DiagramPage, opts: DiagramSvgOptions): string {
  const { width, height, background = null, images } = opts;
  const viewBox = computeViewBox(page);
  const [vbX, vbY, vbW, vbH] = viewBox.split(' ').map(Number);

  const parts: string[] = [];
  parts.push(
    '<defs><marker id="d-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
    '<polygon points="0 0, 8 3, 0 6" fill="#64748b"/></marker>' +
    fillDefsMarkup(page.shapes, images) +
    '</defs>',
  );
  if (background) {
    parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${xml(background)}"/>`);
  }

  // Below the shapes, as the canvas draws them.
  for (const stroke of page.strokes ?? []) {
    const d = freehandStrokePath(stroke);
    if (!d) continue;
    const paint = freehandStrokePaint(stroke);
    parts.push(
      `<path d="${xml(d)}" fill="none" stroke="${xml(stroke.color)}"` +
      ` stroke-width="${xml(paint.strokeWidth)}" opacity="${xml(paint.opacity)}"` +
      ' stroke-linecap="round" stroke-linejoin="round"' +
      (paint.dash ? ` stroke-dasharray="${xml(paint.dash)}"` : '') +
      '/>',
    );
  }

  for (const shape of page.shapes) {
    parts.push(
      `<path d="${xml(getShapePath(shape))}"` +
      ` fill="${xml(fillPaint(shape.id, shape.style, fillDefFor(shape, shape.style, images) !== null))}"` +
      ` stroke="${xml(shape.style.stroke)}" stroke-width="${xml(shape.style.strokeWidth)}"` +
      ` opacity="${xml(shape.style.opacity)}"/>`,
    );
    if (shape.label) {
      parts.push(
        `<text x="${shape.x + shape.width / 2}" y="${shape.y + shape.height / 2}"` +
        ` text-anchor="middle" dominant-baseline="middle" font-size="${xml(shape.style.fontSize)}"` +
        ` fill="${xml(shape.style.textColor)}">${xml(shape.label)}</text>`,
      );
    }
  }

  for (const conn of page.connectors) {
    const points = getConnectorPoints(conn, page.shapes);
    parts.push(
      `<polyline points="${xml(points)}" fill="none" stroke="${xml(conn.style.stroke)}"` +
      ` stroke-width="${xml(conn.style.strokeWidth)}" opacity="${xml(conn.style.opacity)}"` +
      ' marker-end="url(#d-arrow)"/>',
    );
    if (conn.label) {
      const at = connectorLabelAnchor(points);
      parts.push(
        `<text x="${at.x}" y="${at.y}" text-anchor="middle" font-size="11"` +
        ` fill="${xml(conn.style.textColor)}">${xml(conn.label)}</text>`,
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="${xml(viewBox)}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`
  );
}

/**
 * Loads one page of a stored diagram.
 *
 * The metadata and the content are two round trips — `getDiagram` returns a
 * `contentUrl` the document itself has to be fetched from — so every caller
 * that wants to draw a diagram it does not own goes through here.
 */
export async function fetchDiagramPage(
  diagramId: string,
  pageIndex: number,
): Promise<DiagramPage | null> {
  const meta = await diagramsApi.getDiagram(diagramId);
  if (!meta.contentUrl) return null;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') ?? '' : '';
  const res = await fetch(meta.contentUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const doc = await res.json() as DiagramDocument;
  return doc.pages[pageIndex] ?? doc.pages[0] ?? null;
}
