import type { DiagramShape, BoundingBox, DiagramConnector, ConnectorPoint } from '../../types';

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

export function getBoundingBox(shapes: DiagramShape[]): BoundingBox {
  if (shapes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of shapes) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.width);
    maxY = Math.max(maxY, s.y + s.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ---------------------------------------------------------------------------
// Grid snap
// ---------------------------------------------------------------------------

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function snapPointToGrid(
  x: number,
  y: number,
  gridSize: number,
): { x: number; y: number } {
  return { x: snapToGrid(x, gridSize), y: snapToGrid(y, gridSize) };
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

export function isPointInShape(shape: DiagramShape, px: number, py: number): boolean {
  return (
    px >= shape.x &&
    px <= shape.x + shape.width &&
    py >= shape.y &&
    py <= shape.y + shape.height
  );
}

/** Returns the topmost (last in array) shape at the given point, or null. */
export function getShapeAtPoint(
  shapes: DiagramShape[],
  px: number,
  py: number,
): DiagramShape | null {
  // Iterate in reverse order so top shapes (drawn last) are hit first
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (isPointInShape(shapes[i], px, py)) {
      return shapes[i];
    }
  }
  return null;
}

/** Returns true if the shape is fully inside the given rect (for lasso selection). */
export function isShapeInRect(shape: DiagramShape, rect: BoundingBox): boolean {
  return (
    shape.x >= rect.x &&
    shape.y >= rect.y &&
    shape.x + shape.width <= rect.x + rect.width &&
    shape.y + shape.height <= rect.y + rect.height
  );
}

/** Returns all shapes fully contained within a rectangle (lasso selection). */
export function getShapesInRect(shapes: DiagramShape[], rect: BoundingBox): DiagramShape[] {
  return shapes.filter((s) => isShapeInRect(s, rect));
}

// ---------------------------------------------------------------------------
// Connection port helpers
// ---------------------------------------------------------------------------

/** Returns the absolute position of a named port on a shape. */
export function getPortPosition(
  shape: DiagramShape,
  port: string,
): ConnectorPoint {
  const { x, y, width, height } = shape;
  const cx = x + width / 2;
  const cy = y + height / 2;

  switch (port) {
    case 'top':    return { x: cx,         y };
    case 'right':  return { x: x + width,  y: cy };
    case 'bottom': return { x: cx,         y: y + height };
    case 'left':   return { x,             y: cy };
    case 'top-left':     return { x, y };
    case 'top-right':    return { x: x + width, y };
    case 'bottom-left':  return { x, y: y + height };
    case 'bottom-right': return { x: x + width, y: y + height };
    default:       return { x: cx, y: cy };
  }
}

/** Pick the nearest port on a shape to a given external point. */
export function getNearestPort(shape: DiagramShape, px: number, py: number): string {
  const ports = ['top', 'right', 'bottom', 'left'];
  let nearest = 'top';
  let minDist = Infinity;

  for (const port of ports) {
    const pos = getPortPosition(shape, port);
    const dist = Math.hypot(pos.x - px, pos.y - py);
    if (dist < minDist) {
      minDist = dist;
      nearest = port;
    }
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Connector path computation
// ---------------------------------------------------------------------------

export function getConnectorEndpoints(
  connector: DiagramConnector,
  shapes: DiagramShape[],
): { start: ConnectorPoint; end: ConnectorPoint } {
  const shapeMap = new Map(shapes.map((s) => [s.id, s]));

  const getPoint = (
    shapeId: string | null,
    port: string | undefined,
    fallback: ConnectorPoint | undefined,
  ): ConnectorPoint => {
    if (shapeId) {
      const shape = shapeMap.get(shapeId);
      if (shape) return getPortPosition(shape, port ?? 'center');
    }
    return fallback ?? { x: 0, y: 0 };
  };

  return {
    start: getPoint(connector.sourceId, connector.sourcePort, connector.startPoint),
    end: getPoint(connector.targetId, connector.targetPort, connector.endPoint),
  };
}

/**
 * Returns the two cubic Bézier control points for a curved connector.
 * When the connector has stored control points in waypoints[0..1] those are used;
 * otherwise a default symmetric arc is computed.
 */
export function getCurvedControlPoints(
  connector: DiagramConnector,
  start: ConnectorPoint,
  end: ConnectorPoint,
): [ConnectorPoint, ConnectorPoint] {
  if (connector.waypoints.length >= 2) {
    return [connector.waypoints[0], connector.waypoints[1]];
  }
  const cpX = (start.x + end.x) / 2;
  const cpY = (start.y + end.y) / 2 - 50;
  return [{ x: cpX, y: cpY }, { x: cpX, y: cpY }];
}

/** Build an SVG path string for a connector. */
export function buildConnectorPath(
  connector: DiagramConnector,
  start: ConnectorPoint,
  end: ConnectorPoint,
): string {
  const { waypoints, type } = connector;

  if (type === 'straight') {
    if (waypoints.length === 0) {
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }
    const mid = waypoints.map((p) => `L ${p.x} ${p.y}`).join(' ');
    return `M ${start.x} ${start.y} ${mid} L ${end.x} ${end.y}`;
  }

  if (type === 'curved') {
    const [cp1, cp2] = getCurvedControlPoints(connector, start, end);
    return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${end.x} ${end.y}`;
  }

  if (type === 'orthogonal' || type === 'elbow') {
    if (waypoints.length > 0) {
      const pts = [start, ...waypoints, end];
      return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    }
    // Simple L-shaped orthogonal routing
    const mx = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} L ${mx} ${start.y} L ${mx} ${end.y} L ${end.x} ${end.y}`;
  }

  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/**
 * Returns the full ordered list of points for an elbow connector, including
 * start, all waypoints, and end. Falls back to the default L-shape midpoints
 * when no waypoints have been set.
 */
export function getElbowPoints(
  connector: DiagramConnector,
  start: ConnectorPoint,
  end: ConnectorPoint,
): ConnectorPoint[] {
  if (connector.waypoints.length > 0) {
    return [start, ...connector.waypoints, end];
  }
  const mx = (start.x + end.x) / 2;
  return [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
}

// ---------------------------------------------------------------------------
// Alignment helpers
// ---------------------------------------------------------------------------

export type AlignDirection =
  | 'left' | 'center-h' | 'right'
  | 'top'  | 'center-v' | 'bottom';

export function alignShapes(
  shapes: DiagramShape[],
  direction: AlignDirection,
): DiagramShape[] {
  if (shapes.length < 2) return shapes;
  const box = getBoundingBox(shapes);

  return shapes.map((s) => {
    let { x, y } = s;
    switch (direction) {
      case 'left':      x = box.x; break;
      case 'center-h':  x = box.x + (box.width - s.width) / 2; break;
      case 'right':     x = box.x + box.width - s.width; break;
      case 'top':       y = box.y; break;
      case 'center-v':  y = box.y + (box.height - s.height) / 2; break;
      case 'bottom':    y = box.y + box.height - s.height; break;
    }
    return { ...s, x, y };
  });
}

export function distributeShapes(
  shapes: DiagramShape[],
  axis: 'horizontal' | 'vertical',
): DiagramShape[] {
  if (shapes.length < 3) return shapes;
  const sorted = [...shapes].sort((a, b) =>
    axis === 'horizontal' ? a.x - b.x : a.y - b.y,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (axis === 'horizontal') {
    const totalWidth = sorted.reduce((sum, s) => sum + s.width, 0);
    const gap =
      (last.x - first.x + last.width - totalWidth) / (sorted.length - 1);
    let cursor = first.x + first.width + gap;
    return shapes.map((s) => {
      const idx = sorted.indexOf(s);
      if (idx === 0 || idx === sorted.length - 1) return s;
      const result = { ...s, x: cursor };
      cursor += s.width + gap;
      return result;
    });
  } else {
    const totalHeight = sorted.reduce((sum, s) => sum + s.height, 0);
    const gap =
      (last.y - first.y + last.height - totalHeight) / (sorted.length - 1);
    let cursor = first.y + first.height + gap;
    return shapes.map((s) => {
      const idx = sorted.indexOf(s);
      if (idx === 0 || idx === sorted.length - 1) return s;
      const result = { ...s, y: cursor };
      cursor += s.height + gap;
      return result;
    });
  }
}

// ---------------------------------------------------------------------------
// Default styles
// ---------------------------------------------------------------------------

export function defaultShapeStyle(): import('../../types').ShapeStyle {
  return {
    fill: '#ffffff',
    stroke: '#374151',
    strokeWidth: 1.5,
    fontSize: 14,
    fontFamily: 'Inter',
    textColor: '#111827',
    textAlign: 'center',
    opacity: 1,
  };
}

export function defaultConnectorStyle(): import('../../types').ConnectorStyle {
  return {
    stroke: '#374151',
    strokeWidth: 1.5,
    startArrow: 'open',
    endArrow: 'filled',
    fontSize: 12,
    fontFamily: 'Inter',
    textColor: '#374151',
    opacity: 1,
  };
}
