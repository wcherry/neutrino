import type { DiagramShape, DiagramConnector, DiagramPage } from '../../types';
import { defaultShapeStyle, defaultConnectorStyle } from '../utils/shapeUtils';

export interface DiagramAnalysis {
  orphanedNodes: string[];
  missingConnections: string[];
  circularDependencies: string[][];
  isolatedClusters: number;
}

export function parseAiDiagramResponse(json: string): { shapes: DiagramShape[]; connectors: DiagramConnector[] } {
  const data = JSON.parse(json) as { shapes?: Partial<DiagramShape>[]; connectors?: Partial<DiagramConnector>[] };
  const uid = () => crypto.randomUUID();

  const shapes: DiagramShape[] = (data.shapes ?? []).map((s, i) => ({
    id: s.id ?? uid(),
    type: s.type ?? 'rectangle',
    x: s.x ?? 60 + (i % 4) * 160,
    y: s.y ?? 60 + Math.floor(i / 4) * 100,
    width: s.width ?? 120,
    height: s.height ?? 60,
    label: s.label ?? '',
    style: { ...defaultShapeStyle(), ...(s.style ?? {}) },
  }));

  const shapeIds = new Set(shapes.map((s) => s.id));

  const connectors: DiagramConnector[] = (data.connectors ?? []).map((c) => ({
    id: c.id ?? uid(),
    type: c.type ?? 'straight',
    sourceId: c.sourceId && shapeIds.has(c.sourceId) ? c.sourceId : null,
    targetId: c.targetId && shapeIds.has(c.targetId) ? c.targetId : null,
    waypoints: c.waypoints ?? [],
    label: c.label ?? '',
    style: { ...defaultConnectorStyle(), ...(c.style ?? {}) },
  }));

  return { shapes, connectors };
}

export function analyzeDiagram(page: DiagramPage): DiagramAnalysis {
  const { shapes, connectors } = page;
  const shapeIds = new Set(shapes.map((s) => s.id));

  const outbound = new Map<string, string[]>();
  const inbound = new Map<string, string[]>();
  shapes.forEach((s) => { outbound.set(s.id, []); inbound.set(s.id, []); });

  for (const conn of connectors) {
    if (conn.sourceId && conn.targetId && shapeIds.has(conn.sourceId) && shapeIds.has(conn.targetId)) {
      outbound.get(conn.sourceId)?.push(conn.targetId);
      inbound.get(conn.targetId)?.push(conn.sourceId);
    }
  }

  const orphanedNodes = shapes
    .filter((s) => (outbound.get(s.id)?.length ?? 0) === 0 && (inbound.get(s.id)?.length ?? 0) === 0)
    .map((s) => s.id);

  const missingConnections = shapes
    .filter((s) => (outbound.get(s.id)?.length ?? 0) === 0 && (inbound.get(s.id)?.length ?? 0) > 0)
    .map((s) => s.id);

  const circularDependencies = findCycles(shapes.map((s) => s.id), outbound);

  const isolatedClusters = countClusters(shapes.map((s) => s.id), outbound, inbound);

  return { orphanedNodes, missingConnections, circularDependencies, isolatedClusters };
}

function findCycles(ids: string[], outbound: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    if (stack.has(node)) {
      const idx = path.indexOf(node);
      if (idx !== -1) cycles.push([...path.slice(idx)]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const neighbor of outbound.get(node) ?? []) {
      dfs(neighbor);
    }
    path.pop();
    stack.delete(node);
  }

  for (const id of ids) {
    if (!visited.has(id)) dfs(id);
  }
  return cycles;
}

function countClusters(ids: string[], outbound: Map<string, string[]>, inbound: Map<string, string[]>): number {
  if (ids.length === 0) return 0;
  const visited = new Set<string>();
  let count = 0;

  function bfs(start: string) {
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const n of [...(outbound.get(node) ?? []), ...(inbound.get(node) ?? [])]) {
        if (!visited.has(n)) queue.push(n);
      }
    }
  }

  for (const id of ids) {
    if (!visited.has(id)) {
      bfs(id);
      count++;
    }
  }
  return count;
}
