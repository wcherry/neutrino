// ---------------------------------------------------------------------------
// Core diagram types
// ---------------------------------------------------------------------------

export type ShapeType =
  // Phase 1 — Basic
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'circle'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'parallelogram'
  | 'pentagon'
  | 'trapezoid'
  // Phase 2 — Flowchart
  | 'flowchart-process'
  | 'flowchart-decision'
  | 'flowchart-terminator'
  | 'flowchart-document'
  | 'flowchart-data'
  // Phase 2 — UML
  | 'uml-class'
  | 'uml-actor'
  | 'uml-component'
  // Phase 2 — Network
  | 'network-server'
  | 'network-database'
  | 'network-cloud'
  | 'network-firewall'
  | 'network-router'
  // Containers
  | 'swimlane'
  | 'group';

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDash?: string;
  fontSize: number;
  fontFamily: string;
  fontBold?: boolean;
  fontItalic?: boolean;
  textColor: string;
  textAlign?: 'left' | 'center' | 'right';
  opacity: number;
  cornerRadius?: number;
  shadow?: boolean;
}

export interface DiagramShape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  style: ShapeStyle;
  rotation?: number;
  locked?: boolean;
  /** For containers: child shape IDs */
  children?: string[];
  parentId?: string;
  /** Shape-specific data (e.g., swimlane header label, UML fields) */
  data?: Record<string, unknown>;
}

export type ConnectorType = 'straight' | 'orthogonal' | 'curved' | 'elbow';

export type ArrowType = 'none' | 'open' | 'filled' | 'diamond' | 'circle';

export interface ConnectorStyle {
  stroke: string;
  strokeWidth: number;
  strokeDash?: string;
  startArrow: ArrowType;
  endArrow: ArrowType;
  fontSize: number;
  fontFamily: string;
  textColor: string;
  opacity: number;
}

export interface ConnectorPoint {
  x: number;
  y: number;
}

export interface DiagramConnector {
  id: string;
  type: ConnectorType;
  sourceId: string | null;
  targetId: string | null;
  /** Connection point on source shape (0-1 normalised, or named: 'top','right','bottom','left') */
  sourcePort?: string;
  /** Connection point on target shape */
  targetPort?: string;
  /** Intermediate waypoints (for orthogonal/elbow routing overrides) */
  waypoints: ConnectorPoint[];
  label: string;
  labelPosition?: number; // 0-1 along connector
  style: ConnectorStyle;
  /** Absolute start/end when not connected to a shape */
  startPoint?: ConnectorPoint;
  endPoint?: ConnectorPoint;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface DiagramPage {
  id: string;
  name: string;
  shapes: DiagramShape[];
  connectors: DiagramConnector[];
  background?: string;
  gridEnabled?: boolean;
  gridSize?: number;
  snapEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

// ---------------------------------------------------------------------------
// Full diagram document
// ---------------------------------------------------------------------------

export interface DiagramDocument {
  version: number;
  pages: DiagramPage[];
  viewport: Viewport;
}

// ---------------------------------------------------------------------------
// Editor selection state
// ---------------------------------------------------------------------------

export type SelectionMode = 'select' | 'lasso' | 'pan' | 'shape' | 'connector' | 'text';

export interface EditorSelection {
  shapeIds: Set<string>;
  connectorIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Bounding box utility type
// ---------------------------------------------------------------------------

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Shape library item
// ---------------------------------------------------------------------------

export interface ShapeLibraryItem {
  id: string;
  type: ShapeType;
  label: string;
  category: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultStyle?: Partial<ShapeStyle>;
}
