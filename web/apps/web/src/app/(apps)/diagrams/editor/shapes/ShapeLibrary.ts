import type { ShapeLibraryItem, ShapeType } from '../../types';

// ---------------------------------------------------------------------------
// Phase 1 — Basic shapes
// ---------------------------------------------------------------------------

const basicShapes: ShapeLibraryItem[] = [
  { id: 'rectangle', type: 'rectangle', label: 'Rectangle', category: 'Basic', defaultWidth: 120, defaultHeight: 60 },
  { id: 'rounded-rectangle', type: 'rounded-rectangle', label: 'Rounded Rectangle', category: 'Basic', defaultWidth: 120, defaultHeight: 60 },
  { id: 'ellipse', type: 'ellipse', label: 'Ellipse', category: 'Basic', defaultWidth: 120, defaultHeight: 80 },
  { id: 'circle', type: 'circle', label: 'Circle', category: 'Basic', defaultWidth: 80, defaultHeight: 80 },
  { id: 'triangle', type: 'triangle', label: 'Triangle', category: 'Basic', defaultWidth: 80, defaultHeight: 80 },
  { id: 'diamond', type: 'diamond', label: 'Diamond', category: 'Basic', defaultWidth: 100, defaultHeight: 80 },
  { id: 'hexagon', type: 'hexagon', label: 'Hexagon', category: 'Basic', defaultWidth: 100, defaultHeight: 80 },
  { id: 'parallelogram', type: 'parallelogram', label: 'Parallelogram', category: 'Basic', defaultWidth: 120, defaultHeight: 60 },
  { id: 'pentagon', type: 'pentagon', label: 'Pentagon', category: 'Basic', defaultWidth: 100, defaultHeight: 80 },
  { id: 'trapezoid', type: 'trapezoid', label: 'Trapezoid', category: 'Basic', defaultWidth: 120, defaultHeight: 60 },
];

// ---------------------------------------------------------------------------
// Phase 2 — Flowchart shapes
// ---------------------------------------------------------------------------

const flowchartShapes: ShapeLibraryItem[] = [
  { id: 'flowchart-process', type: 'flowchart-process', label: 'Process', category: 'Flowchart', defaultWidth: 120, defaultHeight: 60 },
  { id: 'flowchart-decision', type: 'flowchart-decision', label: 'Decision', category: 'Flowchart', defaultWidth: 120, defaultHeight: 80 },
  { id: 'flowchart-terminator', type: 'flowchart-terminator', label: 'Terminator', category: 'Flowchart', defaultWidth: 120, defaultHeight: 50 },
  { id: 'flowchart-document', type: 'flowchart-document', label: 'Document', category: 'Flowchart', defaultWidth: 120, defaultHeight: 60 },
  { id: 'flowchart-data', type: 'flowchart-data', label: 'Data', category: 'Flowchart', defaultWidth: 120, defaultHeight: 60 },
];

// ---------------------------------------------------------------------------
// Phase 2 — UML shapes
// ---------------------------------------------------------------------------

const umlShapes: ShapeLibraryItem[] = [
  { id: 'uml-class', type: 'uml-class', label: 'Class', category: 'UML', defaultWidth: 160, defaultHeight: 120 },
  { id: 'uml-actor', type: 'uml-actor', label: 'Actor', category: 'UML', defaultWidth: 60, defaultHeight: 100 },
  { id: 'uml-component', type: 'uml-component', label: 'Component', category: 'UML', defaultWidth: 120, defaultHeight: 60 },
];

// ---------------------------------------------------------------------------
// Phase 2 — Network shapes
// ---------------------------------------------------------------------------

const networkShapes: ShapeLibraryItem[] = [
  { id: 'network-server', type: 'network-server', label: 'Server', category: 'Network', defaultWidth: 80, defaultHeight: 80 },
  { id: 'network-database', type: 'network-database', label: 'Database', category: 'Network', defaultWidth: 80, defaultHeight: 80 },
  { id: 'network-cloud', type: 'network-cloud', label: 'Cloud', category: 'Network', defaultWidth: 120, defaultHeight: 80 },
  { id: 'network-firewall', type: 'network-firewall', label: 'Firewall', category: 'Network', defaultWidth: 80, defaultHeight: 60 },
  { id: 'network-router', type: 'network-router', label: 'Router', category: 'Network', defaultWidth: 80, defaultHeight: 80 },
];

// ---------------------------------------------------------------------------
// Phase 1 — Containers
// ---------------------------------------------------------------------------

const containerShapes: ShapeLibraryItem[] = [
  { id: 'swimlane', type: 'swimlane', label: 'Swimlane', category: 'Containers', defaultWidth: 300, defaultHeight: 200 },
  { id: 'group', type: 'group', label: 'Group', category: 'Containers', defaultWidth: 200, defaultHeight: 150 },
];

// ---------------------------------------------------------------------------
// Phase 2 — BPMN shapes
// ---------------------------------------------------------------------------

const bpmnShapes: ShapeLibraryItem[] = [
  { id: 'bpmn-start-event',         type: 'bpmn-start-event',         label: 'Start Event',          category: 'BPMN', defaultWidth: 40, defaultHeight: 40, defaultStyle: { fill: '#dcfce7', stroke: '#16a34a', strokeWidth: 1.5 } },
  { id: 'bpmn-end-event',           type: 'bpmn-end-event',           label: 'End Event',            category: 'BPMN', defaultWidth: 40, defaultHeight: 40, defaultStyle: { fill: '#fee2e2', stroke: '#dc2626', strokeWidth: 3 } },
  { id: 'bpmn-intermediate-event',  type: 'bpmn-intermediate-event',  label: 'Intermediate Event',   category: 'BPMN', defaultWidth: 40, defaultHeight: 40, defaultStyle: { fill: '#fff7ed', stroke: '#ea580c', strokeWidth: 1.5 } },
  { id: 'bpmn-task',                type: 'bpmn-task',                label: 'Task',                 category: 'BPMN', defaultWidth: 120, defaultHeight: 60, defaultStyle: { fill: '#eff6ff', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'bpmn-gateway-exclusive',   type: 'bpmn-gateway-exclusive',   label: 'Exclusive Gateway',    category: 'BPMN', defaultWidth: 50, defaultHeight: 50, defaultStyle: { fill: '#fafaf9', stroke: '#374151', strokeWidth: 1.5 } },
  { id: 'bpmn-gateway-parallel',    type: 'bpmn-gateway-parallel',    label: 'Parallel Gateway',     category: 'BPMN', defaultWidth: 50, defaultHeight: 50, defaultStyle: { fill: '#fafaf9', stroke: '#374151', strokeWidth: 1.5 } },
  { id: 'bpmn-gateway-inclusive',   type: 'bpmn-gateway-inclusive',   label: 'Inclusive Gateway',    category: 'BPMN', defaultWidth: 50, defaultHeight: 50, defaultStyle: { fill: '#fafaf9', stroke: '#374151', strokeWidth: 1.5 } },
  { id: 'bpmn-pool',                type: 'bpmn-pool',                label: 'Pool',                 category: 'BPMN', defaultWidth: 400, defaultHeight: 200, defaultStyle: { fill: '#f8fafc', stroke: '#374151', strokeWidth: 1.5 } },
];

// ---------------------------------------------------------------------------
// Phase 2 — ERD shapes
// ---------------------------------------------------------------------------

const erdShapes: ShapeLibraryItem[] = [
  { id: 'erd-entity',                   type: 'erd-entity',                   label: 'Entity',                 category: 'ERD', defaultWidth: 140, defaultHeight: 60, defaultStyle: { fill: '#eff6ff', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'erd-weak-entity',              type: 'erd-weak-entity',              label: 'Weak Entity',            category: 'ERD', defaultWidth: 140, defaultHeight: 60, defaultStyle: { fill: '#eff6ff', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'erd-attribute',                type: 'erd-attribute',                label: 'Attribute',              category: 'ERD', defaultWidth: 110, defaultHeight: 50, defaultStyle: { fill: '#ffffff', stroke: '#374151', strokeWidth: 1.5 } },
  { id: 'erd-key-attribute',            type: 'erd-key-attribute',            label: 'Key Attribute',          category: 'ERD', defaultWidth: 110, defaultHeight: 50, defaultStyle: { fill: '#ffffff', stroke: '#374151', strokeWidth: 1.5 } },
  { id: 'erd-relationship',             type: 'erd-relationship',             label: 'Relationship',           category: 'ERD', defaultWidth: 120, defaultHeight: 70, defaultStyle: { fill: '#fefce8', stroke: '#ca8a04', strokeWidth: 1.5 } },
  { id: 'erd-identifying-relationship', type: 'erd-identifying-relationship', label: 'Identifying Relation',   category: 'ERD', defaultWidth: 120, defaultHeight: 70, defaultStyle: { fill: '#fefce8', stroke: '#ca8a04', strokeWidth: 1.5 } },
];

// ---------------------------------------------------------------------------
// Phase 2 — AWS shapes
// ---------------------------------------------------------------------------

const awsShapes: ShapeLibraryItem[] = [
  { id: 'aws-ec2',          type: 'aws-ec2',          label: 'EC2',          category: 'AWS', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#fff7ed', stroke: '#ea580c', strokeWidth: 1.5 } },
  { id: 'aws-s3',           type: 'aws-s3',           label: 'S3',           category: 'AWS', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#f0fdf4', stroke: '#16a34a', strokeWidth: 1.5 } },
  { id: 'aws-rds',          type: 'aws-rds',          label: 'RDS',          category: 'AWS', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#eff6ff', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'aws-lambda',       type: 'aws-lambda',       label: 'Lambda',       category: 'AWS', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#faf5ff', stroke: '#9333ea', strokeWidth: 1.5 } },
  { id: 'aws-api-gateway',  type: 'aws-api-gateway',  label: 'API Gateway',  category: 'AWS', defaultWidth: 100, defaultHeight: 60, defaultStyle: { fill: '#fdf4ff', stroke: '#a855f7', strokeWidth: 1.5 } },
  { id: 'aws-sns',          type: 'aws-sns',          label: 'SNS',          category: 'AWS', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#fff7ed', stroke: '#f97316', strokeWidth: 1.5 } },
  { id: 'aws-sqs',          type: 'aws-sqs',          label: 'SQS',          category: 'AWS', defaultWidth: 100, defaultHeight: 60, defaultStyle: { fill: '#fff7ed', stroke: '#f97316', strokeWidth: 1.5 } },
  { id: 'aws-vpc',          type: 'aws-vpc',          label: 'VPC',          category: 'AWS', defaultWidth: 240, defaultHeight: 180, defaultStyle: { fill: '#f0fdf4', stroke: '#16a34a', strokeWidth: 2, strokeDash: '6 3' } },
  { id: 'aws-cloudfront',   type: 'aws-cloudfront',   label: 'CloudFront',   category: 'AWS', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#fff7ed', stroke: '#ea580c', strokeWidth: 1.5 } },
  { id: 'aws-elb',          type: 'aws-elb',          label: 'Load Balancer',category: 'AWS', defaultWidth: 120, defaultHeight: 60, defaultStyle: { fill: '#fff7ed', stroke: '#f97316', strokeWidth: 1.5 } },
];

// ---------------------------------------------------------------------------
// Phase 2 — Azure shapes
// ---------------------------------------------------------------------------

const azureShapes: ShapeLibraryItem[] = [
  { id: 'azure-vm',       type: 'azure-vm',       label: 'Virtual Machine', category: 'Azure', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#eff6ff', stroke: '#0078d4', strokeWidth: 1.5 } },
  { id: 'azure-blob',     type: 'azure-blob',     label: 'Blob Storage',    category: 'Azure', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#eff6ff', stroke: '#0078d4', strokeWidth: 1.5 } },
  { id: 'azure-sql',      type: 'azure-sql',      label: 'SQL Database',    category: 'Azure', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#eff6ff', stroke: '#0078d4', strokeWidth: 1.5 } },
  { id: 'azure-function', type: 'azure-function', label: 'Function',        category: 'Azure', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#faf5ff', stroke: '#7c3aed', strokeWidth: 1.5 } },
  { id: 'azure-apim',     type: 'azure-apim',     label: 'API Management',  category: 'Azure', defaultWidth: 100, defaultHeight: 60, defaultStyle: { fill: '#eff6ff', stroke: '#0078d4', strokeWidth: 1.5 } },
];

// ---------------------------------------------------------------------------
// Phase 2 — GCP shapes
// ---------------------------------------------------------------------------

const gcpShapes: ShapeLibraryItem[] = [
  { id: 'gcp-compute',  type: 'gcp-compute',  label: 'Compute Engine', category: 'GCP', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#fef2f2', stroke: '#dc2626', strokeWidth: 1.5 } },
  { id: 'gcp-storage',  type: 'gcp-storage',  label: 'Cloud Storage',  category: 'GCP', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#f0fdf4', stroke: '#16a34a', strokeWidth: 1.5 } },
  { id: 'gcp-sql',      type: 'gcp-sql',      label: 'Cloud SQL',      category: 'GCP', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#eff6ff', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'gcp-function', type: 'gcp-function', label: 'Cloud Functions', category: 'GCP', defaultWidth: 80, defaultHeight: 80, defaultStyle: { fill: '#faf5ff', stroke: '#9333ea', strokeWidth: 1.5 } },
  { id: 'gcp-pubsub',   type: 'gcp-pubsub',   label: 'Pub/Sub',        category: 'GCP', defaultWidth: 100, defaultHeight: 60, defaultStyle: { fill: '#fff7ed', stroke: '#f97316', strokeWidth: 1.5 } },
];

// ---------------------------------------------------------------------------
// Arrows
// ---------------------------------------------------------------------------

const arrowShapes: ShapeLibraryItem[] = [
  { id: 'arrow-right',      type: 'arrow-right',      label: 'Right Arrow',      category: 'Arrows', defaultWidth: 120, defaultHeight: 60,  defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-left',       type: 'arrow-left',       label: 'Left Arrow',       category: 'Arrows', defaultWidth: 120, defaultHeight: 60,  defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-up',         type: 'arrow-up',         label: 'Up Arrow',         category: 'Arrows', defaultWidth: 60,  defaultHeight: 100, defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-down',       type: 'arrow-down',       label: 'Down Arrow',       category: 'Arrows', defaultWidth: 60,  defaultHeight: 100, defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-left-right', type: 'arrow-left-right', label: 'Left-Right Arrow', category: 'Arrows', defaultWidth: 140, defaultHeight: 60,  defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-up-down',    type: 'arrow-up-down',    label: 'Up-Down Arrow',    category: 'Arrows', defaultWidth: 60,  defaultHeight: 130, defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-bent',       type: 'arrow-bent',       label: 'Bent Arrow',       category: 'Arrows', defaultWidth: 100, defaultHeight: 100, defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-circular',   type: 'arrow-circular',   label: 'Circular Arrow',   category: 'Arrows', defaultWidth: 80,  defaultHeight: 80,  defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-pentagon',   type: 'arrow-pentagon',   label: 'Chevron',          category: 'Arrows', defaultWidth: 120, defaultHeight: 60,  defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-notched',    type: 'arrow-notched',    label: 'Notched Arrow',    category: 'Arrows', defaultWidth: 120, defaultHeight: 60,  defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
  { id: 'arrow-quad',       type: 'arrow-quad',       label: 'Quad Arrow',       category: 'Arrows', defaultWidth: 80,  defaultHeight: 80,  defaultStyle: { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 } },
];

// ---------------------------------------------------------------------------
// Phase 4 — Whiteboard shapes
// ---------------------------------------------------------------------------

const whiteboardShapes: ShapeLibraryItem[] = [
  {
    id: 'sticky-note',
    type: 'sticky-note',
    label: 'Sticky Note',
    category: 'Whiteboard',
    defaultWidth: 160,
    defaultHeight: 140,
    defaultStyle: { fill: '#fef9c3', stroke: '#ca8a04', strokeWidth: 1 },
  },
];

// ---------------------------------------------------------------------------
// Combined library
// ---------------------------------------------------------------------------

export const SHAPE_LIBRARY: ShapeLibraryItem[] = [
  ...basicShapes,
  ...flowchartShapes,
  ...umlShapes,
  ...networkShapes,
  ...containerShapes,
  ...arrowShapes,
  ...bpmnShapes,
  ...erdShapes,
  ...awsShapes,
  ...azureShapes,
  ...gcpShapes,
  ...whiteboardShapes,
];

export const SHAPE_CATEGORIES = [
  'Basic',
  'Flowchart',
  'UML',
  'Network',
  'Containers',
  'Arrows',
  'BPMN',
  'ERD',
  'AWS',
  'Azure',
  'GCP',
  'Whiteboard',
] as const;

export function getShapesByCategory(category: string): ShapeLibraryItem[] {
  return SHAPE_LIBRARY.filter((s) => s.category === category);
}

export function getShapeById(id: string): ShapeLibraryItem | undefined {
  return SHAPE_LIBRARY.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// SVG path generators (used for rendering custom shapes in Konva)
// ---------------------------------------------------------------------------

export function getShapePath(type: ShapeType, w: number, h: number): string {
  switch (type) {
    case 'triangle':
      return `M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`;

    case 'diamond':
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;

    case 'hexagon': {
      const rx = w / 2;
      const ry = h / 4;
      return [
        `M ${rx} 0`,
        `L ${w} ${ry}`,
        `L ${w} ${h - ry}`,
        `L ${rx} ${h}`,
        `L 0 ${h - ry}`,
        `L 0 ${ry}`,
        'Z',
      ].join(' ');
    }

    case 'parallelogram': {
      const skew = w * 0.15;
      return `M ${skew} 0 L ${w} 0 L ${w - skew} ${h} L 0 ${h} Z`;
    }

    case 'pentagon': {
      const cx = w / 2;
      const top = 0;
      const mid = h * 0.38;
      return [
        `M ${cx} ${top}`,
        `L ${w} ${mid}`,
        `L ${w * 0.8} ${h}`,
        `L ${w * 0.2} ${h}`,
        `L 0 ${mid}`,
        'Z',
      ].join(' ');
    }

    case 'trapezoid': {
      const inset = w * 0.15;
      return `M ${inset} 0 L ${w - inset} 0 L ${w} ${h} L 0 ${h} Z`;
    }

    case 'flowchart-decision':
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;

    case 'flowchart-terminator': {
      const r = h / 2;
      return `M ${r} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w - r} ${h} L ${r} ${h} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    }

    case 'flowchart-document': {
      const wave = h * 0.12;
      return `M 0 0 L ${w} 0 L ${w} ${h - wave} Q ${w * 0.75} ${h + wave} ${w / 2} ${h - wave} Q ${w * 0.25} ${h - wave * 3} 0 ${h - wave} Z`;
    }

    case 'flowchart-data': {
      const skew = w * 0.1;
      return `M ${skew} 0 L ${w} 0 L ${w - skew} ${h} L 0 ${h} Z`;
    }

    case 'network-database': {
      const rx = w / 2;
      const ry = h * 0.15;
      return `M 0 ${ry} A ${rx} ${ry} 0 0 1 ${w} ${ry} L ${w} ${h - ry} A ${rx} ${ry} 0 0 1 0 ${h - ry} Z`;
    }

    case 'network-cloud':
      // Simplified cloud shape
      return `M ${w * 0.35} ${h * 0.55} A ${w * 0.2} ${h * 0.3} 0 0 1 ${w * 0.25} ${h * 0.3} A ${w * 0.2} ${h * 0.35} 0 0 1 ${w * 0.6} ${h * 0.2} A ${w * 0.2} ${h * 0.3} 0 0 1 ${w * 0.85} ${h * 0.35} A ${w * 0.2} ${h * 0.3} 0 0 1 ${w * 0.75} ${h * 0.65} Z`;

    // BPMN — task is rounded rect
    case 'bpmn-task':
      return `M 8 0 L ${w - 8} 0 A 8 8 0 0 1 ${w} 8 L ${w} ${h - 8} A 8 8 0 0 1 ${w - 8} ${h} L 8 ${h} A 8 8 0 0 1 0 ${h - 8} L 0 8 A 8 8 0 0 1 8 0 Z`;

    // BPMN — pool (plain rectangle, label goes in header)
    case 'bpmn-pool':
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z M 30 0 L 30 ${h}`;

    // ERD shapes — entity and key-attribute fall through to rect/ellipse via the renderer
    case 'erd-relationship':
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;

    // Cloud shapes reuse existing paths
    case 'aws-vpc':
      return `M ${w * 0.35} ${h * 0.55} A ${w * 0.2} ${h * 0.3} 0 0 1 ${w * 0.25} ${h * 0.3} A ${w * 0.2} ${h * 0.35} 0 0 1 ${w * 0.6} ${h * 0.2} A ${w * 0.2} ${h * 0.3} 0 0 1 ${w * 0.85} ${h * 0.35} A ${w * 0.2} ${h * 0.3} 0 0 1 ${w * 0.75} ${h * 0.65} Z`;

    // AWS compute shapes (server-like)
    case 'aws-ec2':
    case 'gcp-compute':
    case 'azure-vm': {
      // Server rack shape
      const r = 4;
      return [
        `M ${r} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w} ${r}`,
        `L ${w} ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h}`,
        `L ${r} ${h} A ${r} ${r} 0 0 1 0 ${h - r}`,
        `L 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
        // Inner divider lines suggesting rack units
        `M 6 ${h * 0.35} L ${w - 6} ${h * 0.35}`,
        `M 6 ${h * 0.65} L ${w - 6} ${h * 0.65}`,
      ].join(' ');
    }

    // Storage bucket shapes
    case 'aws-s3':
    case 'gcp-storage':
    case 'azure-blob': {
      // Bucket: rectangle with curved bottom
      const bw = w, bh = h, ry = bh * 0.18;
      return `M 0 ${ry} A ${bw / 2} ${ry} 0 0 1 ${bw} ${ry} L ${bw} ${bh - ry} A ${bw / 2} ${ry} 0 0 1 0 ${bh - ry} Z M 0 ${ry} A ${bw / 2} ${ry} 0 0 0 ${bw} ${ry}`;
    }

    // Database cylinder (reuse existing)
    case 'aws-rds':
    case 'gcp-sql':
    case 'azure-sql': {
      const rx2 = w / 2;
      const ry2 = h * 0.15;
      return `M 0 ${ry2} A ${rx2} ${ry2} 0 0 1 ${w} ${ry2} L ${w} ${h - ry2} A ${rx2} ${ry2} 0 0 1 0 ${h - ry2} Z M 0 ${ry2} A ${rx2} ${ry2} 0 0 0 ${w} ${ry2}`;
    }

    // Lambda / function — stylized λ shape
    case 'aws-lambda':
    case 'gcp-function':
    case 'azure-function': {
      const r2 = 8;
      return `M ${r2} 0 L ${w - r2} 0 A ${r2} ${r2} 0 0 1 ${w} ${r2} L ${w} ${h - r2} A ${r2} ${r2} 0 0 1 ${w - r2} ${h} L ${r2} ${h} A ${r2} ${r2} 0 0 1 0 ${h - r2} L 0 ${r2} A ${r2} ${r2} 0 0 1 ${r2} 0 Z M ${w * 0.3} ${h * 0.25} L ${w * 0.5} ${h * 0.75} M ${w * 0.7} ${h * 0.25} L ${w * 0.5} ${h * 0.75}`;
    }

    // API Gateway / SNS / SQS / APIM / Pub-Sub — hexagonal service shape
    case 'aws-api-gateway':
    case 'aws-sns':
    case 'aws-sqs':
    case 'aws-cloudfront':
    case 'aws-elb':
    case 'azure-apim':
    case 'gcp-pubsub': {
      const hx = w * 0.2;
      return `M ${hx} 0 L ${w - hx} 0 L ${w} ${h / 2} L ${w - hx} ${h} L ${hx} ${h} L 0 ${h / 2} Z`;
    }

    // ---------------------------------------------------------------------------
    // Arrow shapes
    // ---------------------------------------------------------------------------

    case 'arrow-right': {
      const [t, b, x] = [h * 0.3, h * 0.7, w * 0.6];
      return `M 0 ${t} L ${x} ${t} L ${x} 0 L ${w} ${h / 2} L ${x} ${h} L ${x} ${b} L 0 ${b} Z`;
    }

    case 'arrow-left': {
      const [t, b, x] = [h * 0.3, h * 0.7, w * 0.4];
      return `M ${w} ${t} L ${x} ${t} L ${x} 0 L 0 ${h / 2} L ${x} ${h} L ${x} ${b} L ${w} ${b} Z`;
    }

    case 'arrow-up': {
      const [l, r, y] = [w * 0.3, w * 0.7, h * 0.4];
      return `M ${l} ${h} L ${l} ${y} L 0 ${y} L ${w / 2} 0 L ${w} ${y} L ${r} ${y} L ${r} ${h} Z`;
    }

    case 'arrow-down': {
      const [l, r, y] = [w * 0.3, w * 0.7, h * 0.6];
      return `M ${l} 0 L ${l} ${y} L 0 ${y} L ${w / 2} ${h} L ${w} ${y} L ${r} ${y} L ${r} 0 Z`;
    }

    case 'arrow-left-right': {
      const [t, b, lx, rx] = [h * 0.3, h * 0.7, w * 0.3, w * 0.7];
      return `M 0 ${h / 2} L ${lx} 0 L ${lx} ${t} L ${rx} ${t} L ${rx} 0 L ${w} ${h / 2} L ${rx} ${h} L ${rx} ${b} L ${lx} ${b} L ${lx} ${h} Z`;
    }

    case 'arrow-up-down': {
      const [l, r, ty, by] = [w * 0.3, w * 0.7, h * 0.3, h * 0.7];
      return `M ${w / 2} 0 L ${w} ${ty} L ${r} ${ty} L ${r} ${by} L ${w} ${by} L ${w / 2} ${h} L 0 ${by} L ${l} ${by} L ${l} ${ty} L 0 ${ty} Z`;
    }

    case 'arrow-bent': {
      // Horizontal shaft at top going right, then vertical shaft going down with arrowhead
      return [
        `M 0 ${h * 0.15}`,
        `L ${w * 0.7} ${h * 0.15}`,
        `L ${w * 0.7} ${h * 0.55}`,
        `L ${w * 0.9} ${h * 0.55}`,
        `L ${w * 0.6} ${h}`,
        `L ${w * 0.3} ${h * 0.55}`,
        `L ${w * 0.5} ${h * 0.55}`,
        `L ${w * 0.5} ${h * 0.45}`,
        `L 0 ${h * 0.45}`,
        'Z',
      ].join(' ');
    }

    case 'arrow-circular': {
      const cx = w / 2, cy = h / 2;
      const ro = Math.min(w, h) * 0.44;
      const thickness = ro * 0.28;
      const ri = ro - thickness;
      const sa = 50 * Math.PI / 180;
      const ea = 310 * Math.PI / 180;
      const osx = cx + ro * Math.cos(sa), osy = cy + ro * Math.sin(sa);
      const oex = cx + ro * Math.cos(ea), oey = cy + ro * Math.sin(ea);
      const isx = cx + ri * Math.cos(sa), isy = cy + ri * Math.sin(sa);
      const iex = cx + ri * Math.cos(ea), iey = cy + ri * Math.sin(ea);
      // Clockwise tangent at ea: (-sin(ea), cos(ea)); outward normal: (cos(ea), sin(ea))
      const tx = -Math.sin(ea), ty2 = Math.cos(ea);
      const nx = Math.cos(ea), ny = Math.sin(ea);
      const mex = cx + (ro - thickness / 2) * Math.cos(ea);
      const mey = cy + (ro - thickness / 2) * Math.sin(ea);
      const ahLen = thickness * 1.4, ahWid = thickness * 0.55;
      const tipX = mex + tx * ahLen, tipY = mey + ty2 * ahLen;
      const w1x = oex + nx * ahWid, w1y = oey + ny * ahWid;
      const w2x = iex - nx * ahWid, w2y = iey - ny * ahWid;
      return [
        `M ${osx} ${osy}`,
        `A ${ro} ${ro} 0 1 1 ${oex} ${oey}`,
        `L ${w1x} ${w1y}`,
        `L ${tipX} ${tipY}`,
        `L ${w2x} ${w2y}`,
        `L ${iex} ${iey}`,
        `A ${ri} ${ri} 0 1 0 ${isx} ${isy}`,
        'Z',
      ].join(' ');
    }

    case 'arrow-pentagon': {
      return `M 0 0 L ${w * 0.65} 0 L ${w} ${h / 2} L ${w * 0.65} ${h} L 0 ${h} L ${w * 0.35} ${h / 2} Z`;
    }

    case 'arrow-notched': {
      const [t, b, x] = [h * 0.3, h * 0.7, w * 0.6];
      return `M 0 ${t} L ${w * 0.18} ${h / 2} L 0 ${b} L ${x} ${b} L ${x} ${h} L ${w} ${h / 2} L ${x} 0 L ${x} ${t} Z`;
    }

    case 'arrow-quad': {
      const cx = w / 2, cy = h / 2;
      const s = Math.min(w, h) * 0.18;
      const ah = Math.min(w, h) * 0.32;
      const arm = Math.min(w, h) * 0.45;
      const aw = s * 1.6;
      return [
        `M ${cx + arm} ${cy}`,
        `L ${cx + arm - ah} ${cy - aw}`,
        `L ${cx + arm - ah} ${cy - s}`,
        `L ${cx + s} ${cy - s}`,
        `L ${cx + s} ${cy - arm + ah}`,
        `L ${cx + aw} ${cy - arm + ah}`,
        `L ${cx} ${cy - arm}`,
        `L ${cx - aw} ${cy - arm + ah}`,
        `L ${cx - s} ${cy - arm + ah}`,
        `L ${cx - s} ${cy - s}`,
        `L ${cx - arm + ah} ${cy - s}`,
        `L ${cx - arm + ah} ${cy - aw}`,
        `L ${cx - arm} ${cy}`,
        `L ${cx - arm + ah} ${cy + aw}`,
        `L ${cx - arm + ah} ${cy + s}`,
        `L ${cx - s} ${cy + s}`,
        `L ${cx - s} ${cy + arm - ah}`,
        `L ${cx - aw} ${cy + arm - ah}`,
        `L ${cx} ${cy + arm}`,
        `L ${cx + aw} ${cy + arm - ah}`,
        `L ${cx + s} ${cy + arm - ah}`,
        `L ${cx + s} ${cy + s}`,
        `L ${cx + arm - ah} ${cy + s}`,
        `L ${cx + arm - ah} ${cy + aw}`,
        'Z',
      ].join(' ');
    }

    default:
      // Fallback to rectangle path
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  }
}
