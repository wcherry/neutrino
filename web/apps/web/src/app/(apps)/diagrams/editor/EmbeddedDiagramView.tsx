'use client';

import React from 'react';
import type { DiagramPage, DiagramShape, DiagramConnector } from '../types';
import styles from './EmbeddedDiagramView.module.css';

export interface EmbeddedDiagramViewProps {
  page: DiagramPage;
  width?: number | string;
  height?: number | string;
  diagramId?: string;
  bgColor?: string;
  showGrid?: boolean;
  gridSize?: number;
}

function getShapePath(shape: DiagramShape): string {
  const { x, y, width: w, height: h } = shape;
  switch (shape.type) {
    case 'ellipse':
    case 'circle':
      return `M ${x + w / 2} ${y} A ${w / 2} ${h / 2} 0 1 1 ${x + w / 2 - 0.01} ${y}`;
    case 'diamond':
    case 'flowchart-decision':
      return `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`;
    case 'triangle':
      return `M ${x + w / 2} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    default:
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }
}

function getConnectorPoints(conn: DiagramConnector, shapes: DiagramShape[]): string {
  const shapeMap = new Map(shapes.map((s) => [s.id, s]));
  let x1 = conn.startPoint?.x ?? 0;
  let y1 = conn.startPoint?.y ?? 0;
  let x2 = conn.endPoint?.x ?? 0;
  let y2 = conn.endPoint?.y ?? 0;

  if (conn.sourceId) {
    const s = shapeMap.get(conn.sourceId);
    if (s) { x1 = s.x + s.width / 2; y1 = s.y + s.height / 2; }
  }
  if (conn.targetId) {
    const s = shapeMap.get(conn.targetId);
    if (s) { x2 = s.x + s.width / 2; y2 = s.y + s.height / 2; }
  }

  const pts = [`${x1},${y1}`, ...conn.waypoints.map((p) => `${p.x},${p.y}`), `${x2},${y2}`];
  return pts.join(' ');
}

function computeViewBox(page: DiagramPage): string {
  const shapes = page.shapes;
  if (shapes.length === 0) return '0 0 400 300';
  const pad = 20;
  const minX = Math.min(...shapes.map((s) => s.x)) - pad;
  const minY = Math.min(...shapes.map((s) => s.y)) - pad;
  const maxX = Math.max(...shapes.map((s) => s.x + s.width)) + pad;
  const maxY = Math.max(...shapes.map((s) => s.y + s.height)) + pad;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

export function EmbeddedDiagramView({
  page,
  width = 400,
  height = 300,
  diagramId,
  bgColor = '#ffffff',
  showGrid = false,
  gridSize = 20,
}: EmbeddedDiagramViewProps) {
  const viewBox = computeViewBox(page);
  const [vbX, vbY, vbW, vbH] = viewBox.split(' ').map(Number);

  // Use diagramId for unique SVG IDs; fall back to a stable index-based suffix.
  const uid = diagramId ?? 'default';
  const arrowMarkerId = `emb-arrow-${uid}`;
  const gridPatternId = `emb-grid-${uid}`;

  const bg = bgColor || '#ffffff';

  return (
    <div className={styles.wrapper} style={{ width, height }}>
      <svg
        className={styles.svg}
        width={width}
        height={height}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {showGrid && (
            <pattern
              id={gridPatternId}
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="0.5"
                opacity="0.4"
              />
            </pattern>
          )}
          <marker id={arrowMarkerId} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#64748b" />
          </marker>
        </defs>

        {/* Background */}
        <rect x={vbX} y={vbY} width={vbW} height={vbH} fill={bg} />

        {/* Grid */}
        {showGrid && (
          <rect x={vbX} y={vbY} width={vbW} height={vbH} fill={`url(#${gridPatternId})`} />
        )}

        {page.shapes.map((shape) => (
          <g key={shape.id}>
            <path
              d={getShapePath(shape)}
              fill={shape.style.fill}
              stroke={shape.style.stroke}
              strokeWidth={shape.style.strokeWidth}
              opacity={shape.style.opacity}
            />
            {shape.label && (
              <text
                x={shape.x + shape.width / 2}
                y={shape.y + shape.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={shape.style.fontSize}
                fontFamily={shape.style.fontFamily}
                fill={shape.style.textColor}
              >
                {shape.label}
              </text>
            )}
          </g>
        ))}

        {page.connectors.map((conn) => (
          <g key={conn.id}>
            <polyline
              points={getConnectorPoints(conn, page.shapes)}
              fill="none"
              stroke={conn.style.stroke}
              strokeWidth={conn.style.strokeWidth}
              markerEnd={`url(#${arrowMarkerId})`}
              opacity={conn.style.opacity}
            />
            {conn.label && (() => {
              const pts = getConnectorPoints(conn, page.shapes).split(' ');
              const mid = pts[Math.floor(pts.length / 2)]?.split(',') ?? ['0', '0'];
              return (
                <text
                  x={parseFloat(mid[0] ?? '0')}
                  y={parseFloat(mid[1] ?? '0') - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill={conn.style.textColor}
                >
                  {conn.label}
                </text>
              );
            })()}
          </g>
        ))}
      </svg>

      {diagramId && (
        <a
          href={`/diagrams/editor?id=${diagramId}`}
          className={styles.openLink}
          target="_blank"
          rel="noreferrer"
        >
          Open
        </a>
      )}
    </div>
  );
}
