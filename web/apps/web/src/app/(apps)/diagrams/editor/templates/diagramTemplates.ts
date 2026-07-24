import type { DiagramDocument, DiagramShape, DiagramConnector } from '../../types';
import { defaultShapeStyle, defaultConnectorStyle } from '../utils/shapeUtils';

export interface DiagramTemplate {
  id: string;
  name: string;
  description: string;
  /** lucide-react icon name, rendered by the picker */
  icon: 'FileText' | 'Workflow' | 'Network' | 'Brain';
  build: () => DiagramDocument;
}

function shape(partial: Pick<DiagramShape, 'type' | 'x' | 'y' | 'width' | 'height' | 'label'> & Partial<DiagramShape>): DiagramShape {
  return {
    id: crypto.randomUUID(),
    style: defaultShapeStyle(),
    ...partial,
  };
}

function connector(sourceId: string, targetId: string, partial: Partial<DiagramConnector> = {}): DiagramConnector {
  return {
    id: crypto.randomUUID(),
    type: 'orthogonal',
    sourceId,
    targetId,
    waypoints: [],
    label: '',
    style: defaultConnectorStyle(),
    ...partial,
  };
}

function emptyDocument(): DiagramDocument {
  return {
    version: 1,
    pages: [
      {
        id: crypto.randomUUID(),
        name: 'Page 1',
        shapes: [],
        connectors: [],
        gridEnabled: true,
        gridSize: 20,
        snapEnabled: true,
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// ---------------------------------------------------------------------------
// Basic flowchart — start, a couple of process/decision steps, two exits
// ---------------------------------------------------------------------------

function buildFlowchart(): DiagramDocument {
  const doc = emptyDocument();
  const start = shape({ type: 'flowchart-terminator', x: 260, y: 40, width: 120, height: 50, label: 'Start' });
  const step = shape({ type: 'flowchart-process', x: 250, y: 150, width: 140, height: 60, label: 'Do the thing' });
  const decision = shape({ type: 'flowchart-decision', x: 245, y: 270, width: 150, height: 90, label: 'Looks right?' });
  const fix = shape({ type: 'flowchart-process', x: 40, y: 285, width: 140, height: 60, label: 'Fix it' });
  const end = shape({ type: 'flowchart-terminator', x: 460, y: 295, width: 120, height: 50, label: 'Done' });

  doc.pages[0].shapes = [start, step, decision, fix, end];
  doc.pages[0].connectors = [
    connector(start.id, step.id),
    connector(step.id, decision.id),
    connector(decision.id, end.id, { label: 'Yes' }),
    connector(decision.id, fix.id, { label: 'No' }),
    connector(fix.id, step.id),
  ];
  return doc;
}

// ---------------------------------------------------------------------------
// Org chart — a manager with two direct reports, one of whom has two reports
// ---------------------------------------------------------------------------

function buildOrgChart(): DiagramDocument {
  const doc = emptyDocument();
  const lead = shape({ type: 'rounded-rectangle', x: 300, y: 40, width: 160, height: 60, label: 'CEO' });
  const eng = shape({ type: 'rounded-rectangle', x: 140, y: 180, width: 160, height: 60, label: 'VP Engineering' });
  const sales = shape({ type: 'rounded-rectangle', x: 460, y: 180, width: 160, height: 60, label: 'VP Sales' });
  const eng1 = shape({ type: 'rectangle', x: 60, y: 320, width: 140, height: 50, label: 'Engineer' });
  const eng2 = shape({ type: 'rectangle', x: 220, y: 320, width: 140, height: 50, label: 'Engineer' });

  doc.pages[0].shapes = [lead, eng, sales, eng1, eng2];
  doc.pages[0].connectors = [
    connector(lead.id, eng.id),
    connector(lead.id, sales.id),
    connector(eng.id, eng1.id),
    connector(eng.id, eng2.id),
  ];
  return doc;
}

// ---------------------------------------------------------------------------
// Mind map — a central topic with four curved branches
// ---------------------------------------------------------------------------

function buildMindMap(): DiagramDocument {
  const doc = emptyDocument();
  const center = shape({ type: 'ellipse', x: 320, y: 240, width: 160, height: 90, label: 'Main idea' });
  const a = shape({ type: 'rounded-rectangle', x: 80, y: 80, width: 140, height: 55, label: 'Idea A' });
  const b = shape({ type: 'rounded-rectangle', x: 560, y: 80, width: 140, height: 55, label: 'Idea B' });
  const c = shape({ type: 'rounded-rectangle', x: 80, y: 420, width: 140, height: 55, label: 'Idea C' });
  const d = shape({ type: 'rounded-rectangle', x: 560, y: 420, width: 140, height: 55, label: 'Idea D' });

  doc.pages[0].shapes = [center, a, b, c, d];
  doc.pages[0].connectors = [
    connector(center.id, a.id, { type: 'curved' }),
    connector(center.id, b.id, { type: 'curved' }),
    connector(center.id, c.id, { type: 'curved' }),
    connector(center.id, d.id, { type: 'curved' }),
  ];
  return doc;
}

// ---------------------------------------------------------------------------

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start from an empty canvas',
    icon: 'FileText',
    build: emptyDocument,
  },
  {
    id: 'flowchart',
    name: 'Flowchart',
    description: 'A simple process with a decision branch',
    icon: 'Workflow',
    build: buildFlowchart,
  },
  {
    id: 'org-chart',
    name: 'Org chart',
    description: 'Reporting lines for a small team',
    icon: 'Network',
    build: buildOrgChart,
  },
  {
    id: 'mind-map',
    name: 'Mind map',
    description: 'A central idea with a few branches',
    icon: 'Brain',
    build: buildMindMap,
  },
];
