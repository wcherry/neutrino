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
// Combined library
// ---------------------------------------------------------------------------

export const SHAPE_LIBRARY: ShapeLibraryItem[] = [
  ...basicShapes,
  ...flowchartShapes,
  ...umlShapes,
  ...networkShapes,
  ...containerShapes,
];

export const SHAPE_CATEGORIES = [
  'Basic',
  'Flowchart',
  'UML',
  'Network',
  'Containers',
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

    default:
      // Fallback to rectangle path
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  }
}
