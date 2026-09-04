/**
 * A diagram page as geometry, independent of React.
 *
 * `EmbeddedDiagramView` draws a page as JSX and the Slides PDF export draws the
 * same page as an SVG string — pdfmake takes markup, not elements — so the
 * shape paths, connector routing and view box live here rather than being
 * written twice and drifting apart.
 */

import { diagramsApi } from '@neutrino/api-diagrams';
import type { DiagramDocument, DiagramPage, DiagramShape, DiagramConnector } from '../types';

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

export function computeViewBox(page: DiagramPage): string {
  const shapes = page.shapes;
  if (shapes.length === 0) return '0 0 400 300';
  const pad = 20;
  const minX = Math.min(...shapes.map((s) => s.x)) - pad;
  const minY = Math.min(...shapes.map((s) => s.y)) - pad;
  const maxX = Math.max(...shapes.map((s) => s.x + s.width)) + pad;
  const maxY = Math.max(...shapes.map((s) => s.y + s.height)) + pad;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
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
}

/**
 * One diagram page as a standalone SVG document.
 *
 * The page is fitted into `width` × `height` with `xMidYMid meet`, matching the
 * embedded viewer, so a diagram placed on a slide keeps its aspect ratio rather
 * than stretching to whatever box it was dropped into.
 */
export function diagramPageToSvg(page: DiagramPage, opts: DiagramSvgOptions): string {
  const { width, height, background = null } = opts;
  const viewBox = computeViewBox(page);
  const [vbX, vbY, vbW, vbH] = viewBox.split(' ').map(Number);

  const parts: string[] = [];
  parts.push(
    '<defs><marker id="d-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
    '<polygon points="0 0, 8 3, 0 6" fill="#64748b"/></marker></defs>',
  );
  if (background) {
    parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${xml(background)}"/>`);
  }

  for (const shape of page.shapes) {
    parts.push(
      `<path d="${xml(getShapePath(shape))}" fill="${xml(shape.style.fill)}"` +
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
