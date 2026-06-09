import type { DiagramPage, DiagramShape, DiagramConnector, ShapeType } from '../../types';
import { importMermaid } from '../io/importUtils';

export function diagramToMermaid(page: DiagramPage): string {
  const lines: string[] = ['flowchart TD'];
  const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');

  for (const shape of page.shapes) {
    const id = safeId(shape.id);
    const label = (shape.label || shape.id).replace(/"/g, "'");
    let node: string;
    switch (shape.type) {
      case 'diamond':
      case 'flowchart-decision':
        node = `  ${id}{${label}}`;
        break;
      case 'ellipse':
      case 'circle':
        node = `  ${id}((${label}))`;
        break;
      case 'flowchart-terminator':
        node = `  ${id}([${label}])`;
        break;
      default:
        node = `  ${id}[${label}]`;
    }
    lines.push(node);
  }

  for (const conn of page.connectors) {
    if (!conn.sourceId || !conn.targetId) continue;
    const src = safeId(conn.sourceId);
    const tgt = safeId(conn.targetId);
    if (conn.label) {
      lines.push(`  ${src} -- ${conn.label} --> ${tgt}`);
    } else {
      lines.push(`  ${src} --> ${tgt}`);
    }
  }

  return lines.join('\n');
}

export function mermaidToDiagram(text: string): { shapes: DiagramShape[]; connectors: DiagramConnector[] } {
  return importMermaid(text);
}

export type { ShapeType };
