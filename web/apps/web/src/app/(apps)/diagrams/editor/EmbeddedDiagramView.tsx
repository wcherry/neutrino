'use client';

import React from 'react';
import type { DiagramPage } from '../types';
import { computeViewBox, connectorLabelAnchor, getConnectorPoints, getShapePath } from './diagramSvg';
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
              const at = connectorLabelAnchor(getConnectorPoints(conn, page.shapes));
              return (
                <text
                  x={at.x}
                  y={at.y}
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
