import type { DiagramShape, DiagramConnector } from '../../types';

export type LayoutAlgorithm = 'hierarchical' | 'flow' | 'force' | 'grid';

// ---------------------------------------------------------------------------
// Hierarchical layout (top-down tree)
// Root nodes are sources with no incoming connectors.
// ---------------------------------------------------------------------------

export function applyHierarchicalLayout(
  shapes: DiagramShape[],
  connectors: DiagramConnector[],
  options = { levelGap: 100, nodeGap: 60 },
): DiagramShape[] {
  if (shapes.length === 0) return shapes;

  const ids = shapes.map((s) => s.id);
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const c of connectors) {
    if (c.sourceId && c.targetId && inDegree.has(c.targetId)) {
      inDegree.set(c.targetId, (inDegree.get(c.targetId) ?? 0) + 1);
      children.get(c.sourceId)?.push(c.targetId);
    }
  }

  // BFS from roots to assign levels
  const roots = ids.filter((id) => inDegree.get(id) === 0);
  const level = new Map<string, number>();
  const queue = [...roots];
  roots.forEach((id) => level.set(id, 0));

  while (queue.length > 0) {
    const id = queue.shift()!;
    const lvl = level.get(id) ?? 0;
    for (const childId of children.get(id) ?? []) {
      if (!level.has(childId)) {
        level.set(childId, lvl + 1);
        queue.push(childId);
      }
    }
  }
  // Unvisited shapes (isolated) get level 0
  ids.forEach((id) => { if (!level.has(id)) level.set(id, 0); });

  const maxLevel = Math.max(...Array.from(level.values()));
  // Group by level
  const byLevel: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  ids.forEach((id) => byLevel[level.get(id)!].push(id));

  const shapeMap = new Map(shapes.map((s) => [s.id, s]));
  const result = new Map<string, DiagramShape>();

  let startY = 60;
  for (const levelIds of byLevel) {
    const levelShapes = levelIds.map((id) => shapeMap.get(id)!).filter(Boolean);
    const totalWidth = levelShapes.reduce((sum, s) => sum + s.width, 0)
      + (levelShapes.length - 1) * options.nodeGap;
    let x = -totalWidth / 2 + 400;
    for (const s of levelShapes) {
      result.set(s.id, { ...s, x, y: startY });
      x += s.width + options.nodeGap;
    }
    const maxH = Math.max(...levelShapes.map((s) => s.height), 60);
    startY += maxH + options.levelGap;
  }

  return shapes.map((s) => result.get(s.id) ?? s);
}

// ---------------------------------------------------------------------------
// Flow layout (left-to-right, same algorithm but rotated)
// ---------------------------------------------------------------------------

export function applyFlowLayout(
  shapes: DiagramShape[],
  connectors: DiagramConnector[],
  options = { levelGap: 140, nodeGap: 50 },
): DiagramShape[] {
  if (shapes.length === 0) return shapes;

  const ids = shapes.map((s) => s.id);
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const c of connectors) {
    if (c.sourceId && c.targetId && inDegree.has(c.targetId)) {
      inDegree.set(c.targetId, (inDegree.get(c.targetId) ?? 0) + 1);
      children.get(c.sourceId)?.push(c.targetId);
    }
  }

  const roots = ids.filter((id) => inDegree.get(id) === 0);
  const level = new Map<string, number>();
  const queue = [...roots];
  roots.forEach((id) => level.set(id, 0));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const lvl = level.get(id) ?? 0;
    for (const childId of children.get(id) ?? []) {
      if (!level.has(childId)) {
        level.set(childId, lvl + 1);
        queue.push(childId);
      }
    }
  }
  ids.forEach((id) => { if (!level.has(id)) level.set(id, 0); });

  const maxLevel = Math.max(...Array.from(level.values()));
  const byLevel: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  ids.forEach((id) => byLevel[level.get(id)!].push(id));

  const shapeMap = new Map(shapes.map((s) => [s.id, s]));
  const result = new Map<string, DiagramShape>();

  let startX = 60;
  for (const levelIds of byLevel) {
    const levelShapes = levelIds.map((id) => shapeMap.get(id)!).filter(Boolean);
    const totalHeight = levelShapes.reduce((sum, s) => sum + s.height, 0)
      + (levelShapes.length - 1) * options.nodeGap;
    let y = -totalHeight / 2 + 300;
    for (const s of levelShapes) {
      result.set(s.id, { ...s, x: startX, y });
      y += s.height + options.nodeGap;
    }
    const maxW = Math.max(...levelShapes.map((s) => s.width), 80);
    startX += maxW + options.levelGap;
  }

  return shapes.map((s) => result.get(s.id) ?? s);
}

// ---------------------------------------------------------------------------
// Force-directed layout (spring/repulsion model, iterative)
// ---------------------------------------------------------------------------

export function applyForceDirectedLayout(
  shapes: DiagramShape[],
  connectors: DiagramConnector[],
  options = { iterations: 200, k: 150, repulsion: 8000 },
): DiagramShape[] {
  if (shapes.length === 0) return shapes;

  const { k, repulsion, iterations } = options;

  // Initialise with jittered positions to avoid symmetry lockup
  let positions = shapes.map((s, i) => ({
    id: s.id,
    x: s.x + (Math.random() - 0.5) * 10,
    y: s.y + (Math.random() - 0.5) * 10,
    w: s.width,
    h: s.height,
  }));

  const edgePairs = connectors
    .filter((c) => c.sourceId && c.targetId)
    .map((c) => [c.sourceId!, c.targetId!] as [string, string]);

  for (let iter = 0; iter < iterations; iter++) {
    const temp = Math.max(5, 80 * (1 - iter / iterations));
    const forces = new Map<string, { fx: number; fy: number }>(
      positions.map((p) => [p.id, { fx: 0, fy: 0 }]),
    );

    // Repulsion between all pairs
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const force = repulsion / (dist * dist);
        const fa = forces.get(a.id)!;
        const fb = forces.get(b.id)!;
        fa.fx -= (force * dx) / dist;
        fa.fy -= (force * dy) / dist;
        fb.fx += (force * dx) / dist;
        fb.fy += (force * dy) / dist;
      }
    }

    // Attraction along edges
    const posMap = new Map(positions.map((p) => [p.id, p]));
    for (const [srcId, tgtId] of edgePairs) {
      const a = posMap.get(srcId);
      const b = posMap.get(tgtId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const force = (dist * dist) / k;
      const fa = forces.get(srcId)!;
      const fb = forces.get(tgtId)!;
      fa.fx += (force * dx) / dist;
      fa.fy += (force * dy) / dist;
      fb.fx -= (force * dx) / dist;
      fb.fy -= (force * dy) / dist;
    }

    // Apply forces capped at temp
    positions = positions.map((p) => {
      const f = forces.get(p.id)!;
      const mag = Math.sqrt(f.fx * f.fx + f.fy * f.fy) || 1;
      const capped = Math.min(mag, temp);
      return {
        ...p,
        x: p.x + (f.fx / mag) * capped,
        y: p.y + (f.fy / mag) * capped,
      };
    });
  }

  // Centre the result at 400,300
  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
  const posMap = new Map(positions.map((p) => [p.id, p]));

  return shapes.map((s) => {
    const p = posMap.get(s.id);
    if (!p) return s;
    return { ...s, x: Math.round(p.x - cx + 400), y: Math.round(p.y - cy + 300) };
  });
}

// ---------------------------------------------------------------------------
// Grid layout (simple N-column grid, no topology awareness)
// ---------------------------------------------------------------------------

export function applyGridLayout(
  shapes: DiagramShape[],
  options = { cols: 4, colGap: 40, rowGap: 40, startX: 60, startY: 60 },
): DiagramShape[] {
  if (shapes.length === 0) return shapes;
  const { cols, colGap, rowGap, startX, startY } = options;

  const colW = Math.max(...shapes.map((s) => s.width)) + colGap;
  const rowH = Math.max(...shapes.map((s) => s.height)) + rowGap;

  return shapes.map((s, i) => ({
    ...s,
    x: startX + (i % cols) * colW,
    y: startY + Math.floor(i / cols) * rowH,
  }));
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function applyLayout(
  algorithm: LayoutAlgorithm,
  shapes: DiagramShape[],
  connectors: DiagramConnector[],
): DiagramShape[] {
  switch (algorithm) {
    case 'hierarchical': return applyHierarchicalLayout(shapes, connectors);
    case 'flow':         return applyFlowLayout(shapes, connectors);
    case 'force':        return applyForceDirectedLayout(shapes, connectors);
    case 'grid':         return applyGridLayout(shapes);
    default:             return shapes;
  }
}
