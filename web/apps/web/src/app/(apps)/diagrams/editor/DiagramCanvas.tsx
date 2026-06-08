'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type {
  DiagramPage,
  DiagramShape,
  DiagramConnector,
  EditorSelection,
  SelectionMode,
  Viewport,
  ShapeType,
  BoundingBox,
} from '../types';
import type { RemoteUser } from './hooks/useDiagramCollab';
import { getShapeAtPoint, getShapesInRect, buildConnectorPath, getConnectorEndpoints } from './utils/shapeUtils';
import { getShapePath } from './shapes/ShapeLibrary';
import styles from './DiagramCanvas.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiagramCanvasProps {
  page: DiagramPage;
  viewport: Viewport;
  selection: EditorSelection;
  mode: SelectionMode;
  remoteUsers: RemoteUser[];
  onSelect: (sel: EditorSelection) => void;
  onModeChange: (mode: SelectionMode) => void;
  onViewportChange: (v: Partial<Viewport>) => void;
  onShapeMove: (id: string, x: number, y: number) => void;
  onShapeResize: (id: string, x: number, y: number, w: number, h: number) => void;
  onShapeLabel: (id: string, label: string) => void;
  onAddShape: (type: ShapeType, x: number, y: number) => void;
  onConnectorUpdate: (id: string, changes: Partial<DiagramConnector>) => void;
  onCanvasMouseMove: (pos: { x: number; y: number } | null) => void;
}

// ---------------------------------------------------------------------------
// Arrow marker helpers
// ---------------------------------------------------------------------------

function ArrowMarkers() {
  return (
    <defs>
      <marker id="arrow-filled" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
      </marker>
      <marker id="arrow-open" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" fill="none">
        <polyline points="0 0, 10 3.5, 0 7" stroke="currentColor" strokeWidth="1.5" />
      </marker>
      <marker id="arrow-diamond" markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto">
        <polygon points="0 3.5, 5 0, 10 3.5, 5 7" fill="currentColor" />
      </marker>
      <marker id="arrow-circle" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <circle cx="3" cy="3" r="2.5" fill="currentColor" />
      </marker>
    </defs>
  );
}

function getMarkerUrl(arrow: string): string {
  switch (arrow) {
    case 'filled':  return 'url(#arrow-filled)';
    case 'open':    return 'url(#arrow-open)';
    case 'diamond': return 'url(#arrow-diamond)';
    case 'circle':  return 'url(#arrow-circle)';
    default:        return 'none';
  }
}

// ---------------------------------------------------------------------------
// Shape renderer (SVG-based for precise path rendering)
// ---------------------------------------------------------------------------

interface ShapeRendererProps {
  shape: DiagramShape;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (e: React.MouseEvent, id: string) => void;
}

function ShapeRenderer({ shape, selected, onMouseDown, onDoubleClick }: ShapeRendererProps) {
  const { type, x, y, width: w, height: h, label, style, rotation } = shape;
  const transform = rotation ? `rotate(${rotation}, ${x + w / 2}, ${y + h / 2})` : undefined;

  const shapeEl = (() => {
    switch (type) {
      case 'rectangle':
        return (
          <rect
            x={x} y={y} width={w} height={h}
            fill={style.fill} stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
            strokeDasharray={style.strokeDash}
          />
        );
      case 'rounded-rectangle':
        return (
          <rect
            x={x} y={y} width={w} height={h}
            rx={style.cornerRadius ?? 8} ry={style.cornerRadius ?? 8}
            fill={style.fill} stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
          />
        );
      case 'ellipse':
        return (
          <ellipse
            cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2}
            fill={style.fill} stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
          />
        );
      case 'circle': {
        const r = Math.min(w, h) / 2;
        return (
          <circle
            cx={x + w / 2} cy={y + h / 2} r={r}
            fill={style.fill} stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
          />
        );
      }
      default: {
        // Use path-based rendering for all other shapes
        const d = getShapePath(type, w, h);
        return (
          <path
            d={d}
            transform={`translate(${x}, ${y})`}
            fill={style.fill} stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
            strokeDasharray={style.strokeDash}
          />
        );
      }
    }
  })();

  return (
    <g
      transform={transform}
      style={{ cursor: 'move' }}
      onMouseDown={(e) => onMouseDown(e, shape.id)}
      onDoubleClick={(e) => onDoubleClick(e, shape.id)}
    >
      {shapeEl}
      {label && (
        <text
          x={x + w / 2}
          y={y + h / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={style.fontSize}
          fontFamily={style.fontFamily}
          fontWeight={style.fontBold ? 'bold' : 'normal'}
          fontStyle={style.fontItalic ? 'italic' : 'normal'}
          fill={style.textColor}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
      {selected && (
        <>
          <rect
            x={x - 2} y={y - 2} width={w + 4} height={h + 4}
            fill="none" stroke="#2563eb" strokeWidth={1.5}
            strokeDasharray="4 2"
            style={{ pointerEvents: 'none' }}
          />
          {/* Resize handles */}
          {[
            [x - 4, y - 4], [x + w / 2 - 4, y - 4], [x + w - 4, y - 4],
            [x - 4, y + h / 2 - 4], [x + w - 4, y + h / 2 - 4],
            [x - 4, y + h - 4], [x + w / 2 - 4, y + h - 4], [x + w - 4, y + h - 4],
          ].map(([hx, hy], i) => (
            <rect
              key={i}
              x={hx} y={hy} width={8} height={8}
              fill="white" stroke="#2563eb" strokeWidth={1.5}
              style={{ cursor: 'nwse-resize' }}
            />
          ))}
        </>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Connector renderer
// ---------------------------------------------------------------------------

interface ConnectorRendererProps {
  connector: DiagramConnector;
  shapes: DiagramShape[];
  selected: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
}

function ConnectorRenderer({ connector, shapes, selected, onMouseDown }: ConnectorRendererProps) {
  const { start, end } = getConnectorEndpoints(connector, shapes);
  const d = buildConnectorPath(connector, start, end);
  const { style } = connector;

  return (
    <g onMouseDown={(e) => onMouseDown(e, connector.id)}>
      {/* Invisible wider hit area */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
      {/* Visible connector */}
      <path
        d={d}
        fill="none"
        stroke={selected ? '#2563eb' : style.stroke}
        strokeWidth={selected ? style.strokeWidth + 0.5 : style.strokeWidth}
        strokeDasharray={style.strokeDash}
        opacity={style.opacity}
        markerStart={getMarkerUrl(style.startArrow)}
        markerEnd={getMarkerUrl(style.endArrow)}
        style={{ color: selected ? '#2563eb' : style.stroke }}
      />
      {connector.label && (
        <text
          x={(start.x + end.x) / 2}
          y={(start.y + end.y) / 2 - 8}
          textAnchor="middle"
          fontSize={style.fontSize}
          fontFamily={style.fontFamily}
          fill={style.textColor}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {connector.label}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Grid renderer
// ---------------------------------------------------------------------------

function GridOverlay({ viewport, width, height }: { viewport: Viewport; width: number; height: number }) {
  const gridSize = 20 * viewport.zoom;
  const offsetX = (viewport.x * viewport.zoom) % gridSize;
  const offsetY = (viewport.y * viewport.zoom) % gridSize;
  const cols = Math.ceil(width / gridSize) + 2;
  const rows = Math.ceil(height / gridSize) + 2;

  return (
    <g opacity={0.3}>
      {Array.from({ length: cols }, (_, i) => (
        <line
          key={`v${i}`}
          x1={offsetX + i * gridSize - gridSize}
          y1={0}
          x2={offsetX + i * gridSize - gridSize}
          y2={height}
          stroke="#94a3b8"
          strokeWidth={0.5}
        />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <line
          key={`h${i}`}
          x1={0}
          y1={offsetY + i * gridSize - gridSize}
          x2={width}
          y2={offsetY + i * gridSize - gridSize}
          stroke="#94a3b8"
          strokeWidth={0.5}
        />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Mini-map
// ---------------------------------------------------------------------------

function MiniMap({
  page,
  viewport,
  canvasWidth,
  canvasHeight,
}: {
  page: DiagramPage;
  viewport: Viewport;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const MINI_W = 160;
  const MINI_H = 100;
  const scale = MINI_W / (canvasWidth / viewport.zoom);

  return (
    <div className={styles.miniMap}>
      <svg width={MINI_W} height={MINI_H} style={{ display: 'block' }}>
        <rect width={MINI_W} height={MINI_H} fill="#f8f9fa" />
        {page.shapes.map((s) => (
          <rect
            key={s.id}
            x={s.x * scale}
            y={s.y * scale}
            width={s.width * scale}
            height={s.height * scale}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={0.5}
          />
        ))}
        {/* Viewport indicator */}
        <rect
          x={-viewport.x * scale}
          y={-viewport.y * scale}
          width={(canvasWidth / viewport.zoom) * scale}
          height={(canvasHeight / viewport.zoom) * scale}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1}
          opacity={0.7}
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main canvas
// ---------------------------------------------------------------------------

export function DiagramCanvas({
  page,
  viewport,
  selection,
  mode,
  remoteUsers,
  onSelect,
  onModeChange,
  onViewportChange,
  onShapeMove,
  onShapeResize,
  onShapeLabel,
  onAddShape,
  onConnectorUpdate,
  onCanvasMouseMove,
}: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });

  // Drag state
  const drag = useRef<{
    type: 'shape' | 'canvas' | 'lasso' | 'connector-draw';
    startX: number;
    startY: number;
    shapeId?: string;
    shapeStartX?: number;
    shapeStartY?: number;
    multiStart?: Map<string, { x: number; y: number }>;
    lassoRect?: BoundingBox;
    connectorId?: string;
  } | null>(null);

  const [lassoRect, setLassoRect] = useState<BoundingBox | null>(null);
  const [editingShapeId, setEditingShapeId] = useState<string | null>(null);

  // Track canvas size
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // Coordinate transforms
  // ---------------------------------------------------------------------------

  const svgToDoc = useCallback(
    (svgX: number, svgY: number): { x: number; y: number } => {
      const { x: ox, y: oy, zoom } = viewport;
      return {
        x: (svgX - ox * zoom) / zoom,
        y: (svgY - oy * zoom) / zoom,
      };
    },
    [viewport],
  );

  const getSvgPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const pt = getSvgPoint(e);
      const docPt = svgToDoc(pt.x, pt.y);

      if (mode === 'pan') {
        drag.current = { type: 'canvas', startX: pt.x, startY: pt.y };
        return;
      }

      // Check if clicking on a shape
      const hit = getShapeAtPoint(page.shapes, docPt.x, docPt.y);
      if (hit) {
        const isSelected = selection.shapeIds.has(hit.id);
        if (!isSelected) {
          if (!e.shiftKey) {
            onSelect({ shapeIds: new Set([hit.id]), connectorIds: new Set() });
          } else {
            const newIds = new Set(selection.shapeIds);
            newIds.add(hit.id);
            onSelect({ ...selection, shapeIds: newIds });
          }
        }
        // Start dragging — remember start positions for all selected shapes
        const multiStart = new Map<string, { x: number; y: number }>();
        const toMove = isSelected ? Array.from(selection.shapeIds) : [hit.id];
        toMove.forEach((id) => {
          const s = page.shapes.find((sh) => sh.id === id);
          if (s) multiStart.set(id, { x: s.x, y: s.y });
        });
        drag.current = {
          type: 'shape',
          startX: docPt.x,
          startY: docPt.y,
          shapeId: hit.id,
          shapeStartX: hit.x,
          shapeStartY: hit.y,
          multiStart,
        };
        return;
      }

      // Lasso selection (empty area)
      if (mode === 'select') {
        if (!e.shiftKey) onSelect({ shapeIds: new Set(), connectorIds: new Set() });
        drag.current = {
          type: 'lasso',
          startX: docPt.x,
          startY: docPt.y,
          lassoRect: { x: docPt.x, y: docPt.y, width: 0, height: 0 },
        };
      }
    },
    [mode, page.shapes, selection, getSvgPoint, svgToDoc, onSelect],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pt = getSvgPoint(e);
      const docPt = svgToDoc(pt.x, pt.y);
      onCanvasMouseMove(docPt);

      if (!drag.current) return;
      const d = drag.current;

      if (d.type === 'canvas') {
        const dx = (pt.x - d.startX) / viewport.zoom;
        const dy = (pt.y - d.startY) / viewport.zoom;
        onViewportChange({
          x: viewport.x + dx,
          y: viewport.y + dy,
        });
        d.startX = pt.x;
        d.startY = pt.y;
      } else if (d.type === 'shape' && d.multiStart) {
        const dx = docPt.x - d.startX;
        const dy = docPt.y - d.startY;
        d.multiStart.forEach((start, id) => {
          onShapeMove(id, start.x + dx, start.y + dy);
        });
      } else if (d.type === 'lasso') {
        const x = Math.min(d.startX, docPt.x);
        const y = Math.min(d.startY, docPt.y);
        const width = Math.abs(docPt.x - d.startX);
        const height = Math.abs(docPt.y - d.startY);
        d.lassoRect = { x, y, width, height };
        setLassoRect({ x, y, width, height });
      }
    },
    [getSvgPoint, svgToDoc, viewport, onViewportChange, onShapeMove, onCanvasMouseMove],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drag.current) return;
      const d = drag.current;

      if (d.type === 'lasso' && d.lassoRect && d.lassoRect.width > 4) {
        const hit = getShapesInRect(page.shapes, d.lassoRect);
        if (hit.length > 0) {
          const existing = e.shiftKey ? Array.from(selection.shapeIds) : [];
          onSelect({
            shapeIds: new Set([...existing, ...hit.map((s) => s.id)]),
            connectorIds: new Set(),
          });
        }
      }

      drag.current = null;
      setLassoRect(null);
    },
    [page.shapes, selection, onSelect],
  );

  const handleShapeDoubleClick = useCallback(
    (_e: React.MouseEvent, id: string) => {
      setEditingShapeId(id);
    },
    [],
  );

  const handleShapeMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      handleMouseDown(e);
    },
    [handleMouseDown],
  );

  const handleConnectorMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onSelect({ shapeIds: new Set(), connectorIds: new Set([id]) });
    },
    [onSelect],
  );

  // Wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const { zoom, x, y } = viewport;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.05, Math.min(8, zoom * delta));
      const pt = getSvgPoint(e as unknown as React.MouseEvent);
      // Zoom around cursor
      const newX = pt.x / newZoom - pt.x / zoom + x;
      const newY = pt.y / newZoom - pt.y / zoom + y;
      onViewportChange({ zoom: newZoom, x: newX, y: newY });
    },
    [viewport, getSvgPoint, onViewportChange],
  );

  // Viewport transform for the document layer
  const tx = viewport.x * viewport.zoom;
  const ty = viewport.y * viewport.zoom;

  return (
    <div className={styles.root} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className={`${styles.canvas} ${mode === 'pan' ? styles.cursorGrab : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { drag.current = null; setLassoRect(null); onCanvasMouseMove(null); }}
        onWheel={handleWheel}
        style={{ display: 'block' }}
      >
        <ArrowMarkers />

        {/* Grid */}
        {(page.gridEnabled !== false) && (
          <GridOverlay viewport={viewport} width={canvasSize.width} height={canvasSize.height} />
        )}

        {/* Document layer */}
        <g transform={`translate(${tx}, ${ty}) scale(${viewport.zoom})`}>
          {/* Connectors (below shapes) */}
          {page.connectors.map((c) => (
            <ConnectorRenderer
              key={c.id}
              connector={c}
              shapes={page.shapes}
              selected={selection.connectorIds.has(c.id)}
              onMouseDown={handleConnectorMouseDown}
            />
          ))}

          {/* Shapes */}
          {page.shapes.map((s) => (
            <ShapeRenderer
              key={s.id}
              shape={s}
              selected={selection.shapeIds.has(s.id)}
              onMouseDown={handleShapeMouseDown}
              onDoubleClick={handleShapeDoubleClick}
            />
          ))}

          {/* Remote cursors */}
          {remoteUsers.map((u) =>
            u.cursor ? (
              <g key={u.clientId} transform={`translate(${u.cursor.x}, ${u.cursor.y})`} style={{ pointerEvents: 'none' }}>
                <polygon points="0,0 0,14 4,11 6,16 8,15 6,10 10,10" fill={u.color} />
                <rect x={12} y={0} width={u.name.length * 7 + 8} height={16} rx={3} fill={u.color} />
                <text x={16} y={12} fontSize={10} fill="white" style={{ userSelect: 'none' }}>{u.name}</text>
              </g>
            ) : null,
          )}
        </g>

        {/* Lasso selection rect (in screen coords) */}
        {lassoRect && (
          <rect
            x={lassoRect.x * viewport.zoom + tx}
            y={lassoRect.y * viewport.zoom + ty}
            width={lassoRect.width * viewport.zoom}
            height={lassoRect.height * viewport.zoom}
            fill="rgba(37, 99, 235, 0.08)"
            stroke="#2563eb"
            strokeWidth={1}
            strokeDasharray="4 2"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>

      {/* Inline text editor for shape labels */}
      {editingShapeId && (() => {
        const shape = page.shapes.find((s) => s.id === editingShapeId);
        if (!shape) return null;
        const scX = shape.x * viewport.zoom + tx;
        const scY = shape.y * viewport.zoom + ty;
        const scW = shape.width * viewport.zoom;
        const scH = shape.height * viewport.zoom;
        return (
          <div
            style={{
              position: 'absolute',
              left: scX,
              top: scY,
              width: scW,
              height: scH,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'all',
            }}
          >
            <input
              autoFocus
              defaultValue={shape.label}
              className={styles.labelInput}
              onBlur={(e) => {
                onShapeLabel(editingShapeId, e.target.value);
                setEditingShapeId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  if (e.key === 'Enter') onShapeLabel(editingShapeId, e.currentTarget.value);
                  setEditingShapeId(null);
                }
              }}
              style={{
                width: '90%',
                textAlign: 'center',
                border: 'none',
                outline: '2px solid #2563eb',
                borderRadius: 4,
                padding: '2px 4px',
                fontSize: shape.style.fontSize,
                fontFamily: shape.style.fontFamily,
                background: 'rgba(255,255,255,0.95)',
              }}
            />
          </div>
        );
      })()}

      {/* Mini-map */}
      <MiniMap
        page={page}
        viewport={viewport}
        canvasWidth={canvasSize.width}
        canvasHeight={canvasSize.height}
      />

      {/* Zoom controls */}
      <div className={styles.zoomControls}>
        <button onClick={() => onViewportChange({ zoom: Math.min(8, viewport.zoom * 1.2) })}>+</button>
        <span>{Math.round(viewport.zoom * 100)}%</span>
        <button onClick={() => onViewportChange({ zoom: Math.max(0.05, viewport.zoom * 0.8) })}>−</button>
        <button onClick={() => onViewportChange({ zoom: 1, x: 0, y: 0 })}>Reset</button>
      </div>
    </div>
  );
}
