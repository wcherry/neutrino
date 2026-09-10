import type { DiagramDocument, DiagramPage, DiagramShape, DiagramConnector, ShapeType } from '../../types';
import { defaultShapeStyle, defaultConnectorStyle } from '../utils/shapeUtils';
import { looksLikeSvg, svgToDiagramDocument } from './svgFormat';

const uid = () => crypto.randomUUID();

export function importJSON(text: string): DiagramDocument {
  const parsed = JSON.parse(text) as DiagramDocument;
  if (!parsed.pages || !Array.isArray(parsed.pages)) {
    throw new Error('Invalid Neutrino diagram JSON');
  }
  return parsed;
}

/**
 * An `.svg` file as a diagram.
 *
 * One this editor wrote carries its own source and comes back whole; any other
 * SVG comes in as its picture on a page. See `io/svgFormat.ts`.
 */
export function importSVG(text: string): DiagramDocument {
  if (!looksLikeSvg(text)) throw new Error('Not an SVG file');
  return svgToDiagramDocument(text);
}

export function importDrawioXML(xmlText: string): DiagramDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const cells = Array.from(doc.querySelectorAll('mxCell'));

  const shapes: DiagramShape[] = [];
  const connectors: DiagramConnector[] = [];
  const idMap = new Map<string, string>();

  for (const cell of cells) {
    const vertex = cell.getAttribute('vertex');
    const edge = cell.getAttribute('edge');
    const value = cell.getAttribute('value') ?? '';
    const cellId = cell.getAttribute('id') ?? uid();

    if (vertex === '1') {
      const geo = cell.querySelector('mxGeometry');
      const x = parseFloat(geo?.getAttribute('x') ?? '0');
      const y = parseFloat(geo?.getAttribute('y') ?? '0');
      const w = parseFloat(geo?.getAttribute('width') ?? '120');
      const h = parseFloat(geo?.getAttribute('height') ?? '60');
      const newId = uid();
      idMap.set(cellId, newId);
      shapes.push({
        id: newId,
        type: 'rectangle',
        x, y,
        width: w,
        height: h,
        label: value,
        style: defaultShapeStyle(),
      });
    } else if (edge === '1') {
      const sourceCell = cell.getAttribute('source') ?? null;
      const targetCell = cell.getAttribute('target') ?? null;
      connectors.push({
        id: uid(),
        type: 'straight',
        sourceId: sourceCell ? (idMap.get(sourceCell) ?? sourceCell) : null,
        targetId: targetCell ? (idMap.get(targetCell) ?? targetCell) : null,
        waypoints: [],
        label: value,
        style: defaultConnectorStyle(),
      });
    }
  }

  const page: DiagramPage = {
    id: uid(),
    name: 'Imported',
    shapes,
    connectors,
    gridEnabled: true,
    gridSize: 20,
    snapEnabled: true,
  };

  return {
    version: 1,
    pages: [page],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/**
 * What an import produced: a whole document, which replaces what is open, or
 * loose elements, which are added to the current page.
 */
export type ImportResult =
  | { kind: 'document'; document: DiagramDocument }
  | { kind: 'elements'; shapes: DiagramShape[]; connectors: DiagramConnector[] };

/**
 * Read pasted text or a dropped file as whichever format it is.
 *
 * The extension is a hint, not the answer — a file dragged out of another tool
 * may have none, and the paste box has none by definition — so the content
 * decides and the extension only breaks ties. SVG is tested before drawio
 * because both open with `<`, and an SVG fed to the drawio parser finds no
 * `mxCell` and yields a silently empty diagram.
 */
export function parseImport(text: string, extension?: string): ImportResult {
  const body = text.trim();
  const ext = extension?.toLowerCase();

  if (ext === 'mmd' || ext === 'md') {
    return { kind: 'elements', ...importMermaid(body) };
  }
  if (ext === 'json' || (!ext && body.startsWith('{'))) {
    return { kind: 'document', document: importJSON(body) };
  }
  if (ext === 'svg' || looksLikeSvg(body)) {
    return { kind: 'document', document: importSVG(body) };
  }
  if (ext === 'xml' || ext === 'drawio' || (!ext && body.startsWith('<'))) {
    return { kind: 'document', document: importDrawioXML(body) };
  }
  if (body.startsWith('{')) {
    return { kind: 'document', document: importJSON(body) };
  }
  if (body.startsWith('<')) {
    return { kind: 'document', document: importDrawioXML(body) };
  }
  return { kind: 'elements', ...importMermaid(body) };
}

export function importMermaid(text: string): { shapes: DiagramShape[]; connectors: DiagramConnector[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const shapeMap = new Map<string, string>();
  const shapes: DiagramShape[] = [];
  const connectors: DiagramConnector[] = [];

  const nodeDefRe = /^([A-Za-z0-9_]+)(\[.*?\]|\(.*?\)|\{.*?\}|\(\[.*?\]\)|\(\(.*?\)\))/;
  const edgeRe = /^([A-Za-z0-9_]+)\s*(?:--\s*(.*?)\s*-->|-->)\s*([A-Za-z0-9_]+)/;

  let col = 0;
  let row = 0;
  const COLS = 5;
  const COL_GAP = 180;
  const ROW_GAP = 120;

  const ensureShape = (nodeId: string, label?: string, type?: ShapeType): string => {
    if (shapeMap.has(nodeId)) return shapeMap.get(nodeId)!;
    const id = uid();
    shapeMap.set(nodeId, id);
    shapes.push({
      id,
      type: type ?? 'rectangle',
      x: 60 + (col % COLS) * COL_GAP,
      y: 60 + row * ROW_GAP,
      width: 120,
      height: 60,
      label: label ?? nodeId,
      style: defaultShapeStyle(),
    });
    col++;
    if (col % COLS === 0) { row++; }
    return id;
  };

  for (const line of lines) {
    if (/^(flowchart|graph)\s+(TD|LR|TB|RL|BT)/i.test(line)) continue;

    const edgeMatch = edgeRe.exec(line);
    if (edgeMatch) {
      const [, srcId, edgeLabel, tgtId] = edgeMatch;
      const srcShapeId = ensureShape(srcId);
      const tgtShapeId = ensureShape(tgtId);
      connectors.push({
        id: uid(),
        type: 'straight',
        sourceId: srcShapeId,
        targetId: tgtShapeId,
        waypoints: [],
        label: edgeLabel ?? '',
        style: defaultConnectorStyle(),
      });
      continue;
    }

    const nodeMatch = nodeDefRe.exec(line);
    if (nodeMatch) {
      const [, nodeId, shapePart] = nodeMatch;
      const inner = shapePart.replace(/^[\[({]+/, '').replace(/[\])}]+$/, '');
      let shapeType: ShapeType = 'rectangle';
      if (shapePart.startsWith('{')) shapeType = 'diamond';
      else if (shapePart.startsWith('((')) shapeType = 'ellipse';
      else if (shapePart.startsWith('([')) shapeType = 'flowchart-terminator';
      ensureShape(nodeId, inner, shapeType);
    }
  }

  return { shapes, connectors };
}
