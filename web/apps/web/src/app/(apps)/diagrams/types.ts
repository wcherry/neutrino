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
  | 'group'
  // Phase 4 — Whiteboard
  | 'sticky-note'
  // Phase 2 — BPMN
  | 'bpmn-start-event'
  | 'bpmn-end-event'
  | 'bpmn-intermediate-event'
  | 'bpmn-task'
  | 'bpmn-gateway-exclusive'
  | 'bpmn-gateway-parallel'
  | 'bpmn-gateway-inclusive'
  | 'bpmn-pool'
  // Phase 2 — ERD
  | 'erd-entity'
  | 'erd-weak-entity'
  | 'erd-attribute'
  | 'erd-key-attribute'
  | 'erd-relationship'
  | 'erd-identifying-relationship'
  // Phase 2 — AWS
  | 'aws-ec2'
  | 'aws-s3'
  | 'aws-rds'
  | 'aws-lambda'
  | 'aws-api-gateway'
  | 'aws-sns'
  | 'aws-sqs'
  | 'aws-vpc'
  | 'aws-cloudfront'
  | 'aws-elb'
  // Phase 2 — Azure
  | 'azure-vm'
  | 'azure-blob'
  | 'azure-sql'
  | 'azure-function'
  | 'azure-apim'
  // Phase 2 — GCP
  | 'gcp-compute'
  | 'gcp-storage'
  | 'gcp-sql'
  | 'gcp-function'
  | 'gcp-pubsub'
  // Arrows
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left-right'
  | 'arrow-up-down'
  | 'arrow-bent'
  | 'arrow-circular'
  | 'arrow-pentagon'
  | 'arrow-notched'
  | 'arrow-quad'
  // Third-party drawio image shapes
  | 'drawio-image';

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

// ---------------------------------------------------------------------------
// Phase 6 — Data binding
// ---------------------------------------------------------------------------

export interface DataBinding {
  /** Field name from the bound dataset whose value populates the shape label */
  labelField: string;
  /** Optional field used to drive conditional formatting */
  statusField?: string;
}

export interface ConditionalRule {
  id: string;
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
  value: string;
  style: Partial<ShapeStyle>;
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
  /** Phase 6: live data bound to this shape */
  boundData?: Record<string, string | number | boolean>;
  /** Phase 6: how to map data fields to label/style */
  dataBinding?: DataBinding;
  /** Phase 6: conditional formatting rules evaluated against boundData */
  conditionalRules?: ConditionalRule[];
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
  /** Offset from the geometric midpoint, set when the user drags the label */
  labelOffset?: ConnectorPoint;
  style: ConnectorStyle;
  /** Absolute start/end when not connected to a shape */
  startPoint?: ConnectorPoint;
  endPoint?: ConnectorPoint;
  /** Z-order layer: 0 (default) renders behind shapes, 1 renders in front of shapes */
  zIndex?: number;
}

// ---------------------------------------------------------------------------
// Phase 4 — Freehand strokes (whiteboard mode)
// ---------------------------------------------------------------------------

export type DrawingTool = 'pen' | 'pencil' | 'highlighter';

export interface FreehandStroke {
  id: string;
  tool: DrawingTool;
  /** Flat array of alternating x,y pairs for performance */
  points: number[];
  color: string;
  width: number;
  opacity: number;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface DiagramPage {
  id: string;
  name: string;
  shapes: DiagramShape[];
  connectors: DiagramConnector[];
  /** Phase 4: whiteboard freehand strokes */
  strokes?: FreehandStroke[];
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

export type SelectionMode =
  | 'select' | 'lasso' | 'pan' | 'shape' | 'connector' | 'text'
  // Phase 4 — Whiteboard
  | 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'presentation';

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
