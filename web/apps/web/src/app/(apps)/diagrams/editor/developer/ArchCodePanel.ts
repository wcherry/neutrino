import type { DiagramShape, DiagramConnector, ShapeType } from '../../types';
import { defaultShapeStyle, defaultConnectorStyle } from '../utils/shapeUtils';

const uid = () => crypto.randomUUID();

interface ArchNode {
  id: string;
  label: string;
  type?: string;
}

interface ArchEdge {
  from: string;
  to: string;
  label?: string;
}

interface ArchCodeDoc {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

function simpleYamlToJson(text: string): string {
  // Minimal YAML→JSON for flat key: value docs and basic lists.
  // This covers simple arch-code documents only.
  const lines = text.split('\n');
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: Record<string, unknown>[] | null = null;
  let currentItem: Record<string, unknown> | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItemMatch = /^  - /.exec(line);
    const listPropMatch = /^    (\w+):\s*(.*)$/.exec(line);
    const topKeyMatch = /^(\w+):\s*(.*)$/.exec(line);

    if (listPropMatch && currentItem !== null) {
      const [, k, v] = listPropMatch;
      currentItem[k] = v.trim().replace(/^["']|["']$/g, '');
    } else if (listItemMatch && currentList !== null) {
      if (currentItem) currentList.push(currentItem);
      currentItem = {};
    } else if (topKeyMatch) {
      if (currentList !== null && currentItem !== null) {
        currentList.push(currentItem);
        currentItem = null;
        currentList = null;
      }
      const [, k, v] = topKeyMatch;
      if (!v.trim()) {
        currentKey = k;
        currentList = [];
        currentItem = null;
        result[k] = currentList;
      } else {
        result[k] = v.trim().replace(/^["']|["']$/g, '');
        currentKey = null;
      }
    }
  }
  if (currentList !== null && currentItem !== null) {
    currentList.push(currentItem);
  }
  void currentKey;

  return JSON.stringify(result);
}

export function parseArchCode(text: string): { shapes: DiagramShape[]; connectors: DiagramConnector[] } {
  let doc: ArchCodeDoc;
  const trimmed = text.trim();

  try {
    doc = JSON.parse(trimmed) as ArchCodeDoc;
  } catch {
    const jsonStr = simpleYamlToJson(trimmed);
    doc = JSON.parse(jsonStr) as ArchCodeDoc;
  }

  if (!doc.nodes || !Array.isArray(doc.nodes)) {
    throw new Error('Expected a "nodes" array');
  }

  const COLS = 4;
  const COL_GAP = 180;
  const ROW_GAP = 120;
  const idMap = new Map<string, string>();

  const shapes: DiagramShape[] = doc.nodes.map((node, i) => {
    const shapeId = uid();
    idMap.set(node.id, shapeId);
    return {
      id: shapeId,
      type: (node.type as ShapeType) || 'rectangle',
      x: 60 + (i % COLS) * COL_GAP,
      y: 60 + Math.floor(i / COLS) * ROW_GAP,
      width: 120,
      height: 60,
      label: node.label || node.id,
      style: defaultShapeStyle(),
    };
  });

  const connectors: DiagramConnector[] = (doc.edges ?? []).map((edge) => ({
    id: uid(),
    type: 'straight' as const,
    sourceId: idMap.get(edge.from) ?? null,
    targetId: idMap.get(edge.to) ?? null,
    waypoints: [],
    label: edge.label ?? '',
    style: defaultConnectorStyle(),
  }));

  return { shapes, connectors };
}
