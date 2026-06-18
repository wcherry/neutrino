'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type {
  DiagramPage,
  DiagramShape,
  DiagramConnector,
  ConnectorPoint,
  FreehandStroke,
  DrawingTool,
  EditorSelection,
  SelectionMode,
  Viewport,
  ShapeType,
  ShapeStyle,
  BoundingBox,
} from '../types';
import type { RemoteUser } from './hooks/useDiagramCollab';
import { getShapeAtPoint, getShapesInRect, buildConnectorPath, getConnectorEndpoints, getPortPosition, getElbowPoints, getCurvedControlPoints } from './utils/shapeUtils';
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
  onAddShape: (type: ShapeType, x: number, y: number, extraData?: Record<string, unknown>) => void;
  onConnectorUpdate: (id: string, changes: Partial<DiagramConnector>) => void;
  onCanvasMouseMove: (pos: { x: number; y: number } | null) => void;
  onAddStroke: (stroke: FreehandStroke) => void;
  onRemoveStrokesUnder: (x: number, y: number, radius: number) => void;
  onAddConnector: (
    sourceId: string | null,
    targetId: string | null,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    sourcePort?: string,
    targetPort?: string,
  ) => void;
  /** Active drawing color for whiteboard tools */
  drawColor?: string;
}

// ---------------------------------------------------------------------------
// Inline arrowhead rendering (avoids SVG marker currentColor inheritance issues)
// ---------------------------------------------------------------------------

/** Returns the outward-pointing unit direction vector at each connector endpoint. */
function getEndpointDirections(
  connector: DiagramConnector,
  start: ConnectorPoint,
  end: ConnectorPoint,
): { startDir: ConnectorPoint; endDir: ConnectorPoint } {
  const norm = (dx: number, dy: number): ConnectorPoint => {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };

  if (connector.type === 'curved') {
    const [cp1, cp2] = getCurvedControlPoints(connector, start, end);
    return {
      startDir: norm(start.x - cp1.x, start.y - cp1.y),
      endDir: norm(end.x - cp2.x, end.y - cp2.y),
    };
  }

  if (connector.type === 'orthogonal' || connector.type === 'elbow') {
    const pts = getElbowPoints(connector, start, end);
    const n = pts.length;
    return {
      startDir: norm(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      endDir: norm(pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y),
    };
  }

  // straight (with optional waypoints)
  if (connector.waypoints.length > 0) {
    const fw = connector.waypoints[0];
    const lw = connector.waypoints[connector.waypoints.length - 1];
    return {
      startDir: norm(start.x - fw.x, start.y - fw.y),
      endDir: norm(end.x - lw.x, end.y - lw.y),
    };
  }

  return {
    startDir: norm(start.x - end.x, start.y - end.y),
    endDir: norm(end.x - start.x, end.y - start.y),
  };
}

interface ArrowHeadProps {
  x: number;
  y: number;
  dx: number;
  dy: number;
  arrowType: string;
  color: string;
  strokeWidth: number;
}

function ConnectorArrowHead({ x, y, dx, dy, arrowType, color, strokeWidth }: ArrowHeadProps) {
  if (arrowType === 'none') return null;
  const L = 10;
  const W = 4;
  const px = -dy;
  const py = dx;

  if (arrowType === 'filled') {
    const pts = `${x},${y} ${x - L * dx + W * px},${y - L * dy + W * py} ${x - L * dx - W * px},${y - L * dy - W * py}`;
    return <polygon points={pts} fill={color} style={{ pointerEvents: 'none' }} />;
  }
  if (arrowType === 'open') {
    return (
      <polyline
        points={`${x - L * dx + W * px},${y - L * dy + W * py} ${x},${y} ${x - L * dx - W * px},${y - L * dy - W * py}`}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        style={{ pointerEvents: 'none' }}
      />
    );
  }
  if (arrowType === 'diamond') {
    const HL = L * 0.55;
    const HW = W * 0.75;
    const pts = `${x},${y} ${x - HL * dx + HW * px},${y - HL * dy + HW * py} ${x - L * dx},${y - L * dy} ${x - HL * dx - HW * px},${y - HL * dy - HW * py}`;
    return <polygon points={pts} fill={color} style={{ pointerEvents: 'none' }} />;
  }
  if (arrowType === 'circle') {
    const r = 4;
    return <circle cx={x - r * dx} cy={y - r * dy} r={r} fill={color} style={{ pointerEvents: 'none' }} />;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Conditional formatting evaluation
// ---------------------------------------------------------------------------

function resolveStyle(shape: DiagramShape): ShapeStyle {
  const { style, boundData, conditionalRules } = shape;
  if (!conditionalRules || !boundData) return style;

  for (const rule of conditionalRules) {
    const fieldVal = String(boundData[rule.field] ?? '');
    let match = false;
    const ruleVal = rule.value;
    switch (rule.operator) {
      case 'eq':       match = fieldVal === ruleVal; break;
      case 'neq':      match = fieldVal !== ruleVal; break;
      case 'gt':       match = Number(fieldVal) > Number(ruleVal); break;
      case 'lt':       match = Number(fieldVal) < Number(ruleVal); break;
      case 'contains': match = fieldVal.includes(ruleVal); break;
    }
    if (match) return { ...style, ...rule.style };
  }
  return style;
}

// ---------------------------------------------------------------------------
// Shape renderer (SVG-based for precise path rendering)
// ---------------------------------------------------------------------------

interface ShapeRendererProps {
  shape: DiagramShape;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (e: React.MouseEvent, id: string) => void;
  onResizeHandleMouseDown?: (e: React.MouseEvent, id: string, handle: string) => void;
}

function ShapeRenderer({ shape, selected, onMouseDown, onDoubleClick, onResizeHandleMouseDown }: ShapeRendererProps) {
  const { type, x, y, width: w, height: h, label, rotation } = shape;
  const style = resolveStyle(shape);
  const transform = rotation ? `rotate(${rotation}, ${x + w / 2}, ${y + h / 2})` : undefined;

  const cx = x + w / 2;
  const cy = y + h / 2;

  const shapeEl = (() => {
    // ── Sticky note ──────────────────────────────────────────────────────────
    if (type === 'sticky-note') {
      const foldSize = 16;
      const d = `M ${x} ${y} L ${x + w - foldSize} ${y} L ${x + w} ${y + foldSize} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
      const fold = `M ${x + w - foldSize} ${y} L ${x + w - foldSize} ${y + foldSize} L ${x + w} ${y + foldSize}`;
      return (
        <>
          <path d={d} fill={style.fill || '#fef9c3'} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
          <path d={fold} fill="none" stroke={style.stroke} strokeWidth={style.strokeWidth * 0.75} opacity={style.opacity * 0.6} />
        </>
      );
    }

    // ── BPMN events (circle-based) ────────────────────────────────────────────
    if (type === 'bpmn-start-event' || type === 'bpmn-end-event' || type === 'bpmn-intermediate-event') {
      const r = Math.min(w, h) / 2;
      return (
        <>
          <circle cx={cx} cy={cy} r={r} fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
          {type === 'bpmn-intermediate-event' && (
            <circle cx={cx} cy={cy} r={r * 0.78} fill="none" stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
          )}
        </>
      );
    }

    // ── BPMN gateways (diamond + marker) ─────────────────────────────────────
    if (type === 'bpmn-gateway-exclusive' || type === 'bpmn-gateway-parallel' || type === 'bpmn-gateway-inclusive') {
      const d = `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`;
      const markerSize = Math.min(w, h) * 0.28;
      return (
        <>
          <path d={d} fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
          {type === 'bpmn-gateway-exclusive' && (
            <>
              <line x1={cx - markerSize} y1={cy - markerSize} x2={cx + markerSize} y2={cy + markerSize} stroke={style.stroke} strokeWidth={style.strokeWidth + 0.5} />
              <line x1={cx + markerSize} y1={cy - markerSize} x2={cx - markerSize} y2={cy + markerSize} stroke={style.stroke} strokeWidth={style.strokeWidth + 0.5} />
            </>
          )}
          {type === 'bpmn-gateway-parallel' && (
            <>
              <line x1={cx} y1={cy - markerSize * 1.3} x2={cx} y2={cy + markerSize * 1.3} stroke={style.stroke} strokeWidth={style.strokeWidth + 0.5} />
              <line x1={cx - markerSize * 1.3} y1={cy} x2={cx + markerSize * 1.3} y2={cy} stroke={style.stroke} strokeWidth={style.strokeWidth + 0.5} />
            </>
          )}
          {type === 'bpmn-gateway-inclusive' && (
            <circle cx={cx} cy={cy} r={markerSize} fill="none" stroke={style.stroke} strokeWidth={style.strokeWidth + 0.5} />
          )}
        </>
      );
    }

    // ── ERD double-border shapes ──────────────────────────────────────────────
    if (type === 'erd-weak-entity') {
      const inset = 5;
      return (
        <>
          <rect x={x} y={y} width={w} height={h} fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
          <rect x={x + inset} y={y + inset} width={w - inset * 2} height={h - inset * 2} fill="none" stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
        </>
      );
    }

    if (type === 'erd-identifying-relationship') {
      const outerD = `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`;
      const inset = 7;
      const innerD = `M ${cx} ${y + inset} L ${x + w - inset} ${cy} L ${cx} ${y + h - inset} L ${x + inset} ${cy} Z`;
      return (
        <>
          <path d={outerD} fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
          <path d={innerD} fill="none" stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
        </>
      );
    }

    if (type === 'erd-key-attribute') {
      return (
        <>
          <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
          {/* Underline hint for key attribute — drawn below the center text */}
          <line x1={cx - w * 0.3} y1={cy + h * 0.22} x2={cx + w * 0.3} y2={cy + h * 0.22} stroke={style.stroke} strokeWidth={1.5} />
        </>
      );
    }

    if (type === 'erd-attribute') {
      return (
        <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
      );
    }

    if (type === 'erd-entity') {
      return (
        <rect x={x} y={y} width={w} height={h} fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} />
      );
    }

    // ── Drawio image shapes ───────────────────────────────────────────────────
    if (type === 'drawio-image') {
      const imgSrc = typeof shape.data?.imageUrl === 'string' ? shape.data.imageUrl : '';
      if (imgSrc) {
        return (
          <image
            x={x} y={y} width={w} height={h}
            href={imgSrc}
            preserveAspectRatio="xMidYMid meet"
            opacity={style.opacity}
          />
        );
      }
      return (
        <rect x={x} y={y} width={w} height={h}
          fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth}
          opacity={style.opacity} strokeDasharray="4 2" />
      );
    }

    // ── Standard switch ───────────────────────────────────────────────────────
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
            cx={cx} cy={cy} rx={w / 2} ry={h / 2}
            fill={style.fill} stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
          />
        );
      case 'circle': {
        const circleR = Math.min(w, h) / 2;
        return (
          <circle
            cx={cx} cy={cy} r={circleR}
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
          {([
            ['nw', x - 4,         y - 4,         'nwse-resize'],
            ['n',  x + w / 2 - 4, y - 4,         'ns-resize'],
            ['ne', x + w - 4,     y - 4,         'nesw-resize'],
            ['w',  x - 4,         y + h / 2 - 4, 'ew-resize'],
            ['e',  x + w - 4,     y + h / 2 - 4, 'ew-resize'],
            ['sw', x - 4,         y + h - 4,     'nesw-resize'],
            ['s',  x + w / 2 - 4, y + h - 4,     'ns-resize'],
            ['se', x + w - 4,     y + h - 4,     'nwse-resize'],
          ] as [string, number, number, string][]).map(([handle, hx, hy, cursor]) => (
            <rect
              key={handle}
              x={hx} y={hy} width={8} height={8}
              fill="white" stroke="#2563eb" strokeWidth={1.5}
              style={{ cursor, pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                onResizeHandleMouseDown?.(e, shape.id, handle);
              }}
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
  shiftHeld?: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onSegmentMouseDown?: (e: React.MouseEvent, connectorId: string, segmentIndex: number) => void;
  onSplitSegment?: (connectorId: string, segmentIndex: number, waypoints: ConnectorPoint[]) => void;
  onRemoveSegment?: (connectorId: string, segmentIndex: number, waypoints: ConnectorPoint[]) => void;
  onControlPointMouseDown?: (e: React.MouseEvent, connectorId: string, cpIndex: 0 | 1) => void;
  onLabelMouseDown?: (e: React.MouseEvent, connectorId: string) => void;
  onEndpointMouseDown?: (e: React.MouseEvent, connectorId: string, which: 'source' | 'target') => void;
  endpointOverride?: { which: 'source' | 'target'; x: number; y: number };
}

function ConnectorRenderer({ connector, shapes, selected, shiftHeld, onMouseDown, onSegmentMouseDown, onSplitSegment, onRemoveSegment, onControlPointMouseDown, onLabelMouseDown, onEndpointMouseDown, endpointOverride }: ConnectorRendererProps) {
  const [hoveredSplitIndex, setHoveredSplitIndex] = React.useState<number | null>(null);
  const { start: computedStart, end: computedEnd } = getConnectorEndpoints(connector, shapes);
  const start = endpointOverride?.which === 'source' ? { x: endpointOverride.x, y: endpointOverride.y } : computedStart;
  const end = endpointOverride?.which === 'target' ? { x: endpointOverride.x, y: endpointOverride.y } : computedEnd;
  const d = buildConnectorPath(connector, start, end);
  const { style } = connector;
  const color = selected ? '#2563eb' : style.stroke;
  const { startDir, endDir } = getEndpointDirections(connector, start, end);

  return (
    <g onMouseDown={(e) => onMouseDown(e, connector.id)}>
      {/* Invisible wider hit area */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
      {/* Visible connector line */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={selected ? style.strokeWidth + 0.5 : style.strokeWidth}
        strokeDasharray={style.strokeDash}
        opacity={style.opacity}
      />
      {/* Inline arrowheads — explicit color avoids SVG marker currentColor issues */}
      <ConnectorArrowHead x={start.x} y={start.y} dx={startDir.x} dy={startDir.y} arrowType={style.startArrow} color={color} strokeWidth={style.strokeWidth} />
      <ConnectorArrowHead x={end.x} y={end.y} dx={endDir.x} dy={endDir.y} arrowType={style.endArrow} color={color} strokeWidth={style.strokeWidth} />
      {connector.label && (() => {
        const mid = getConnectorMidPoint(connector, start, end);
        const lx = mid.x + (connector.labelOffset?.x ?? 0);
        const ly = mid.y + (connector.labelOffset?.y ?? 0);
        const padX = 5;
        const padY = 2;
        const approxW = connector.label.length * style.fontSize * 0.55 + padX * 2;
        const approxH = style.fontSize + padY * 2;
        return (
          <g>
            <rect
              x={lx - approxW / 2} y={ly - approxH / 2} width={approxW} height={approxH}
              fill="white" rx={2}
              style={{ cursor: 'grab', pointerEvents: 'all' }}
              onMouseDown={(e) => { e.stopPropagation(); onLabelMouseDown?.(e, connector.id); }}
            />
            <text
              x={lx} y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={style.fontSize}
              fontFamily={style.fontFamily}
              fill={style.textColor}
              style={{ userSelect: 'none', pointerEvents: 'none' }}
            >
              {connector.label}
            </text>
          </g>
        );
      })()}
      {selected && connector.type === 'curved' && (() => {
        const [cp1, cp2] = getCurvedControlPoints(connector, start, end);
        return (
          <>
            {/* Control lines from endpoints to their control points */}
            <line x1={start.x} y1={start.y} x2={cp1.x} y2={cp1.y} stroke="#2563eb" strokeWidth={1} strokeDasharray="4 2" style={{ pointerEvents: 'none' }} />
            <line x1={end.x} y1={end.y} x2={cp2.x} y2={cp2.y} stroke="#2563eb" strokeWidth={1} strokeDasharray="4 2" style={{ pointerEvents: 'none' }} />
            {/* cp1 handle */}
            <circle
              cx={cp1.x} cy={cp1.y} r={5}
              fill="white" stroke="#2563eb" strokeWidth={1.5}
              style={{ cursor: 'move', pointerEvents: 'all' }}
              onMouseDown={(e) => { e.stopPropagation(); onControlPointMouseDown?.(e, connector.id, 0); }}
            />
            {/* cp2 handle */}
            <circle
              cx={cp2.x} cy={cp2.y} r={5}
              fill="white" stroke="#2563eb" strokeWidth={1.5}
              style={{ cursor: 'move', pointerEvents: 'all' }}
              onMouseDown={(e) => { e.stopPropagation(); onControlPointMouseDown?.(e, connector.id, 1); }}
            />
          </>
        );
      })()}
      {selected && connector.type === 'elbow' && (() => {
        const pts = getElbowPoints(connector, start, end);
        const segments = computeElbowSegments(pts);
        return (
          <>
            {segments.map((seg) => {
              const pw = seg.isHorizontal ? 16 : 8;
              const ph = seg.isHorizontal ? 8 : 16;
              return (
                <g key={seg.index}>
                  {/* Move handle (filled dark pill) */}
                  <rect
                    x={seg.midX - pw / 2}
                    y={seg.midY - ph / 2}
                    width={pw}
                    height={ph}
                    rx={ph / 2}
                    ry={ph / 2}
                    fill="#1d4ed8"
                    stroke="white"
                    strokeWidth={1}
                    style={{ cursor: seg.isHorizontal ? 'ns-resize' : 'ew-resize', pointerEvents: 'all' }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onSegmentMouseDown?.(e, connector.id, seg.index);
                    }}
                  />
                  {/* Add/remove button — offset from move handle, only on long-enough segments */}
                  {seg.length > 40 && (() => {
                    const ox = seg.isHorizontal ? 20 : 0;
                    const oy = seg.isHorizontal ? 0 : 20;
                    const cx = seg.midX + ox;
                    const cy = seg.midY + oy;
                    const r = 7;
                    const arm = 3.5;
                    const isRemoveMode = shiftHeld && hoveredSplitIndex === seg.index;
                    const onClick = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      const baseWps = connector.waypoints.length > 0
                        ? connector.waypoints
                        : [{ x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }];
                      if (e.shiftKey) {
                        onRemoveSegment?.(connector.id, seg.index, removeElbowSegment(baseWps, seg.index));
                      } else {
                        onSplitSegment?.(connector.id, seg.index, splitElbowSegment(baseWps, getElbowPoints(connector, start, end), seg.index));
                      }
                    };
                    return (
                      <>
                        <circle
                          cx={cx} cy={cy} r={r}
                          fill={isRemoveMode ? '#ef4444' : '#22c55e'}
                          style={{ cursor: 'pointer', pointerEvents: 'all' }}
                          onMouseEnter={() => setHoveredSplitIndex(seg.index)}
                          onMouseLeave={() => setHoveredSplitIndex(null)}
                          onClick={onClick}
                        />
                        {/* horizontal bar (shared by + and −) */}
                        <line x1={cx - arm} y1={cy} x2={cx + arm} y2={cy} stroke="white" strokeWidth={1.5} strokeLinecap="round" style={{ pointerEvents: 'none' }} />
                        {/* vertical bar for + only */}
                        {!isRemoveMode && <line x1={cx} y1={cy - arm} x2={cx} y2={cy + arm} stroke="white" strokeWidth={1.5} strokeLinecap="round" style={{ pointerEvents: 'none' }} />}
                      </>
                    );
                  })()}
                </g>
              );
            })}
          </>
        );
      })()}
      {/* Endpoint drag handles (shown when selected) */}
      {selected && (
        <>
          <circle
            cx={start.x} cy={start.y} r={5}
            fill="white" stroke="#2563eb" strokeWidth={1.5}
            style={{ cursor: 'crosshair', pointerEvents: 'all' }}
            onMouseDown={(e) => { e.stopPropagation(); onEndpointMouseDown?.(e, connector.id, 'source'); }}
          />
          <circle
            cx={end.x} cy={end.y} r={5}
            fill="white" stroke="#2563eb" strokeWidth={1.5}
            style={{ cursor: 'crosshair', pointerEvents: 'all' }}
            onMouseDown={(e) => { e.stopPropagation(); onEndpointMouseDown?.(e, connector.id, 'target'); }}
          />
        </>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Freehand stroke renderer
// ---------------------------------------------------------------------------

function StrokeRenderer({ stroke }: { stroke: FreehandStroke }) {
  const pts = stroke.points;
  if (pts.length < 4) return null;

  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    d += ` Q ${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  d += ` L ${pts[pts.length - 2]} ${pts[pts.length - 1]}`;

  const strokeProps: React.SVGProps<SVGPathElement> = {
    d,
    fill: 'none',
    stroke: stroke.color,
    strokeWidth: stroke.width,
    opacity: stroke.opacity,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  if (stroke.tool === 'highlighter') {
    return <path {...strokeProps} strokeWidth={stroke.width * 2} opacity={0.35} />;
  }
  if (stroke.tool === 'pencil') {
    return <path {...strokeProps} strokeDasharray="1 1" />;
  }
  return <path {...strokeProps} />;
}

// ---------------------------------------------------------------------------
// Smart guides (snap alignment lines while dragging)
// ---------------------------------------------------------------------------

interface SmartGuide {
  axis: 'x' | 'y';
  value: number;
}

function SmartGuides({
  guides,
  canvasWidth,
  canvasHeight,
  viewport,
}: {
  guides: SmartGuide[];
  canvasWidth: number;
  canvasHeight: number;
  viewport: Viewport;
}) {
  if (guides.length === 0) return null;
  const tx = viewport.x * viewport.zoom;
  const ty = viewport.y * viewport.zoom;

  return (
    <>
      {guides.map((g, i) => {
        if (g.axis === 'x') {
          const screenX = g.value * viewport.zoom + tx;
          return (
            <line
              key={i}
              x1={screenX} y1={0} x2={screenX} y2={canvasHeight}
              stroke="#f97316" strokeWidth={1} strokeDasharray="4 4"
              style={{ pointerEvents: 'none' }}
            />
          );
        } else {
          const screenY = g.value * viewport.zoom + ty;
          return (
            <line
              key={i}
              x1={0} y1={screenY} x2={canvasWidth} y2={screenY}
              stroke="#f97316" strokeWidth={1} strokeDasharray="4 4"
              style={{ pointerEvents: 'none' }}
            />
          );
        }
      })}
    </>
  );
}

const SNAP_THRESHOLD = 6; // px in screen space

function computeSmartGuides(
  movingIds: Set<string>,
  shapes: DiagramShape[],
  viewport: Viewport,
): SmartGuide[] {
  const static_ = shapes.filter((s) => !movingIds.has(s.id));
  const moving = shapes.filter((s) => movingIds.has(s.id));
  if (moving.length === 0 || static_.length === 0) return [];

  const guides: SmartGuide[] = [];
  const snap = SNAP_THRESHOLD / viewport.zoom;

  const movingEdges = {
    left:   Math.min(...moving.map((s) => s.x)),
    right:  Math.max(...moving.map((s) => s.x + s.width)),
    cx:     moving.reduce((sum, s) => sum + s.x + s.width / 2, 0) / moving.length,
    top:    Math.min(...moving.map((s) => s.y)),
    bottom: Math.max(...moving.map((s) => s.y + s.height)),
    cy:     moving.reduce((sum, s) => sum + s.y + s.height / 2, 0) / moving.length,
  };

  for (const s of static_) {
    const candidates = [
      { axis: 'x' as const, val: s.x },
      { axis: 'x' as const, val: s.x + s.width },
      { axis: 'x' as const, val: s.x + s.width / 2 },
      { axis: 'y' as const, val: s.y },
      { axis: 'y' as const, val: s.y + s.height },
      { axis: 'y' as const, val: s.y + s.height / 2 },
    ];
    for (const c of candidates) {
      if (c.axis === 'x') {
        if (
          Math.abs(movingEdges.left - c.val) < snap ||
          Math.abs(movingEdges.right - c.val) < snap ||
          Math.abs(movingEdges.cx - c.val) < snap
        ) {
          if (!guides.find((g) => g.axis === 'x' && g.value === c.val)) {
            guides.push({ axis: 'x', value: c.val });
          }
        }
      } else {
        if (
          Math.abs(movingEdges.top - c.val) < snap ||
          Math.abs(movingEdges.bottom - c.val) < snap ||
          Math.abs(movingEdges.cy - c.val) < snap
        ) {
          if (!guides.find((g) => g.axis === 'y' && g.value === c.val)) {
            guides.push({ axis: 'y', value: c.val });
          }
        }
      }
    }
  }
  return guides;
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
    <g opacity={0.3} data-grid-overlay="true">
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
// Drawing mode helper (module-level — no state)
// ---------------------------------------------------------------------------

function isDrawingMode(m: SelectionMode): m is 'pen' | 'pencil' | 'highlighter' {
  return m === 'pen' || m === 'pencil' || m === 'highlighter';
}

// ---------------------------------------------------------------------------
// Connector midpoint (for label placement)
// ---------------------------------------------------------------------------

function getConnectorMidPoint(
  connector: DiagramConnector,
  start: ConnectorPoint,
  end: ConnectorPoint,
): ConnectorPoint {
  if (connector.type === 'curved') {
    const [cp1, cp2] = getCurvedControlPoints(connector, start, end);
    return {
      x: 0.125 * start.x + 0.375 * cp1.x + 0.375 * cp2.x + 0.125 * end.x,
      y: 0.125 * start.y + 0.375 * cp1.y + 0.375 * cp2.y + 0.125 * end.y,
    };
  }
  if (connector.type === 'elbow' || connector.type === 'orthogonal') {
    const pts = getElbowPoints(connector, start, end);
    const mid = Math.floor((pts.length - 1) / 2);
    return {
      x: (pts[mid].x + pts[mid + 1].x) / 2,
      y: (pts[mid].y + pts[mid + 1].y) / 2,
    };
  }
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

// ---------------------------------------------------------------------------
// Elbow segment helpers
// ---------------------------------------------------------------------------

interface ElbowSegment {
  index: number;
  midX: number;
  midY: number;
  isHorizontal: boolean;
  length: number;
}

function computeElbowSegments(pts: ConnectorPoint[]): ElbowSegment[] {
  return pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1];
    return {
      index: i,
      midX: (p.x + q.x) / 2,
      midY: (p.y + q.y) / 2,
      isHorizontal: Math.abs(p.y - q.y) < 2,
      length: Math.hypot(q.x - p.x, q.y - p.y),
    };
  });
}

/** Move segment `segIndex` to a new perpendicular position. Returns new waypoints array. */
function moveElbowSegment(
  waypoints: ConnectorPoint[],
  start: ConnectorPoint,
  end: ConnectorPoint,
  segIndex: number,
  newValue: number,
): ConnectorPoint[] {
  const n = waypoints.length;
  const totalSegs = n + 1;
  const allPts = [start, ...waypoints, end];
  const seg = allPts[segIndex];
  const segEnd = allPts[segIndex + 1];
  const isHorizontal = Math.abs(seg.y - segEnd.y) < 2;

  const wps = waypoints.map(p => ({ ...p }));

  if (isHorizontal) {
    const aIsStart = segIndex === 0;
    const bIsEnd = segIndex === totalSegs - 1;

    if (aIsStart && bIsEnd) {
      const mx = (start.x + end.x) / 2;
      const base = [{ x: mx, y: start.y }, { x: mx, y: end.y }];
      return moveElbowSegment(base, start, end, 0, newValue);
    }
    if (aIsStart) {
      wps.splice(0, 0, { x: start.x, y: newValue });
      wps[1] = { ...wps[1], y: newValue };
    } else if (bIsEnd) {
      wps[segIndex - 1] = { ...wps[segIndex - 1], y: newValue };
      wps.push({ x: end.x, y: newValue });
    } else {
      wps[segIndex - 1] = { ...wps[segIndex - 1], y: newValue };
      wps[segIndex] = { ...wps[segIndex], y: newValue };
    }
  } else {
    const aIsStart = segIndex === 0;
    const bIsEnd = segIndex === totalSegs - 1;

    if (aIsStart && bIsEnd) {
      const my = (start.y + end.y) / 2;
      const base = [{ x: start.x, y: my }, { x: end.x, y: my }];
      return moveElbowSegment(base, start, end, 0, newValue);
    }
    if (aIsStart) {
      wps.splice(0, 0, { x: newValue, y: start.y });
      wps[1] = { ...wps[1], x: newValue };
    } else if (bIsEnd) {
      wps[segIndex - 1] = { ...wps[segIndex - 1], x: newValue };
      wps.push({ x: newValue, y: end.y });
    } else {
      wps[segIndex - 1] = { ...wps[segIndex - 1], x: newValue };
      wps[segIndex] = { ...wps[segIndex], x: newValue };
    }
  }

  return wps;
}

/** Remove the waypoints bounding segment `segIndex`, collapsing it into its neighbours. */
function removeElbowSegment(waypoints: ConnectorPoint[], segIndex: number): ConnectorPoint[] {
  const toRemove = new Set<number>();
  if (segIndex > 0 && segIndex - 1 < waypoints.length) toRemove.add(segIndex - 1);
  if (segIndex < waypoints.length) toRemove.add(segIndex);
  return waypoints.filter((_, i) => !toRemove.has(i));
}

/** Insert a U-shaped bump to split segment `segIndex` into three segments. */
function splitElbowSegment(
  waypoints: ConnectorPoint[],
  allPts: ConnectorPoint[],
  segIndex: number,
): ConnectorPoint[] {
  const p1 = allPts[segIndex];
  const p2 = allPts[segIndex + 1];
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const BUMP = 24;
  const newWps = [...waypoints];

  if (Math.abs(p1.y - p2.y) < 2) {
    // Horizontal → insert vertical bump downward
    newWps.splice(segIndex, 0,
      { x: midX - BUMP, y: p1.y },
      { x: midX - BUMP, y: p1.y + BUMP },
      { x: midX + BUMP, y: p1.y + BUMP },
      { x: midX + BUMP, y: p1.y },
    );
  } else {
    // Vertical → insert horizontal bump rightward
    newWps.splice(segIndex, 0,
      { x: p1.x, y: midY - BUMP },
      { x: p1.x + BUMP, y: midY - BUMP },
      { x: p1.x + BUMP, y: midY + BUMP },
      { x: p1.x, y: midY + BUMP },
    );
  }

  return newWps;
}

// ---------------------------------------------------------------------------
// Connector port handles overlay
// ---------------------------------------------------------------------------

const CONNECTOR_PORTS = ['top', 'right', 'bottom', 'left'] as const;

function ConnectorHandles({
  shape,
  hoveredPort,
}: {
  shape: DiagramShape;
  hoveredPort: string | null;
}) {
  return (
    <>
      {CONNECTOR_PORTS.map((port) => {
        const pos = getPortPosition(shape, port);
        const active = hoveredPort === port;
        return (
          <circle
            key={port}
            cx={pos.x}
            cy={pos.y}
            r={active ? 6 : 5}
            fill={active ? '#2563eb' : 'white'}
            stroke="#2563eb"
            strokeWidth={1.5}
            style={{ pointerEvents: 'none' }}
          />
        );
      })}
    </>
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
  onAddStroke,
  onRemoveStrokesUnder,
  onAddConnector,
  drawColor = '#1e293b',
}: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  const [smartGuides, setSmartGuides] = useState<SmartGuide[]>([]);
  const [shiftHeld, setShiftHeld] = useState(false);

  // In-progress freehand stroke (not yet committed to store)
  const liveStroke = useRef<{ id: string; tool: DrawingTool; points: number[] } | null>(null);
  const [liveStrokePath, setLiveStrokePath] = useState<string>('');

  // Drag state
  const drag = useRef<
    | {
        type: 'shape' | 'canvas' | 'lasso' | 'connector-draw';
        startX: number;
        startY: number;
        shapeId?: string;
        shapeStartX?: number;
        shapeStartY?: number;
        multiStart?: Map<string, { x: number; y: number }>;
        lassoRect?: BoundingBox;
        connectorId?: string;
        connectorPort?: string;
      }
    | {
        type: 'connector-segment';
        connectorId: string;
        segmentIndex: number;
        isHorizontal: boolean;
        startDocX: number;
        startDocY: number;
        startValue: number;
        initWaypoints: ConnectorPoint[];
        initStart: ConnectorPoint;
        initEnd: ConnectorPoint;
      }
    | {
        type: 'bezier-cp';
        connectorId: string;
        cpIndex: 0 | 1;
        startDocX: number;
        startDocY: number;
        initCp1: ConnectorPoint;
        initCp2: ConnectorPoint;
      }
    | {
        type: 'label-drag';
        connectorId: string;
        startDocX: number;
        startDocY: number;
        initOffset: ConnectorPoint;
      }
    | {
        type: 'endpoint-drag';
        connectorId: string;
        which: 'source' | 'target';
      }
    | {
        type: 'shape-resize';
        shapeId: string;
        handle: string;
        startDocX: number;
        startDocY: number;
        initX: number;
        initY: number;
        initW: number;
        initH: number;
      }
    | null
  >(null);

  const [lassoRect, setLassoRect] = useState<BoundingBox | null>(null);
  const [editingShapeId, setEditingShapeId] = useState<string | null>(null);
  const [connectorPreview, setConnectorPreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [hoveredShapeId, setHoveredShapeId] = useState<string | null>(null);
  const [hoveredPort, setHoveredPort] = useState<string | null>(null);
  const [endpointDragOverride, setEndpointDragOverride] = useState<{ connectorId: string; which: 'source' | 'target'; x: number; y: number } | null>(null);

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

  // Track Shift key for split-handle remove mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // Clear connector handles when leaving connector/select mode
  useEffect(() => {
    if (mode !== 'connector' && mode !== 'select') {
      setHoveredShapeId(null);
      setHoveredPort(null);
    }
  }, [mode]);

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

      // Drawing modes — start a new stroke
      if (isDrawingMode(mode)) {
        liveStroke.current = {
          id: crypto.randomUUID(),
          tool: mode as DrawingTool,
          points: [docPt.x, docPt.y],
        };
        setLiveStrokePath(`M ${docPt.x} ${docPt.y}`);
        return;
      }

      // Eraser — remove strokes near the cursor
      if (mode === 'eraser') {
        onRemoveStrokesUnder(docPt.x, docPt.y, 16 / viewport.zoom);
        drag.current = { type: 'canvas', startX: pt.x, startY: pt.y };
        return;
      }

      // Select mode: clicking on a proximity port starts a connector
      if (mode === 'select' && hoveredPort && hoveredShapeId) {
        const PORT_SNAP = 16 / viewport.zoom;
        const hShape = page.shapes.find((s) => s.id === hoveredShapeId);
        if (hShape) {
          const portPos = getPortPosition(hShape, hoveredPort as typeof CONNECTOR_PORTS[number]);
          if (Math.hypot(portPos.x - docPt.x, portPos.y - docPt.y) < PORT_SNAP) {
            drag.current = {
              type: 'connector-draw',
              startX: portPos.x,
              startY: portPos.y,
              shapeId: hShape.id,
              connectorPort: hoveredPort,
            };
            setConnectorPreview({ x1: portPos.x, y1: portPos.y, x2: portPos.x, y2: portPos.y });
            return;
          }
        }
      }

      // Connector drawing mode — click near a shape/port to start
      if (mode === 'connector') {
        const HOVER_PAD = 24 / viewport.zoom;
        const PORT_SNAP = 12 / viewport.zoom;
        const nearShape = page.shapes.find((s) =>
          docPt.x >= s.x - HOVER_PAD && docPt.x <= s.x + s.width + HOVER_PAD &&
          docPt.y >= s.y - HOVER_PAD && docPt.y <= s.y + s.height + HOVER_PAD,
        );
        let startX = docPt.x;
        let startY = docPt.y;
        let sourcePort: string | undefined;
        if (nearShape) {
          for (const port of CONNECTOR_PORTS) {
            const pos = getPortPosition(nearShape, port);
            if (Math.hypot(pos.x - docPt.x, pos.y - docPt.y) < PORT_SNAP) {
              sourcePort = port;
              startX = pos.x;
              startY = pos.y;
              break;
            }
          }
        }
        drag.current = {
          type: 'connector-draw',
          startX,
          startY,
          shapeId: nearShape?.id,
          connectorPort: sourcePort,
        };
        setConnectorPreview({ x1: startX, y1: startY, x2: startX, y2: startY });
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
    [mode, page.shapes, selection, getSvgPoint, svgToDoc, onSelect, viewport.zoom, onRemoveStrokesUnder, onAddConnector, onModeChange, hoveredShapeId, hoveredPort],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pt = getSvgPoint(e);
      const docPt = svgToDoc(pt.x, pt.y);
      onCanvasMouseMove(docPt);

      // Extend live stroke
      if (isDrawingMode(mode) && liveStroke.current && e.buttons === 1) {
        liveStroke.current.points.push(docPt.x, docPt.y);
        const pts = liveStroke.current.points;
        let d = `M ${pts[0]} ${pts[1]}`;
        for (let i = 2; i < pts.length - 2; i += 2) {
          const mx = (pts[i] + pts[i + 2]) / 2;
          const my = (pts[i + 1] + pts[i + 3]) / 2;
          d += ` Q ${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
        }
        setLiveStrokePath(d);
        return;
      }

      // Eraser drag
      if (mode === 'eraser' && e.buttons === 1) {
        onRemoveStrokesUnder(docPt.x, docPt.y, 16 / viewport.zoom);
        return;
      }

      // Connector mode: update port handles
      if (mode === 'connector') {
        const HOVER_PAD = 24 / viewport.zoom;
        const PORT_SNAP = 12 / viewport.zoom;
        const nearShape = page.shapes.find((s) =>
          docPt.x >= s.x - HOVER_PAD && docPt.x <= s.x + s.width + HOVER_PAD &&
          docPt.y >= s.y - HOVER_PAD && docPt.y <= s.y + s.height + HOVER_PAD,
        );
        let nearestPort: string | null = null;
        if (nearShape) {
          for (const port of CONNECTOR_PORTS) {
            const pos = getPortPosition(nearShape, port);
            if (Math.hypot(pos.x - docPt.x, pos.y - docPt.y) < PORT_SNAP) {
              nearestPort = port;
              break;
            }
          }
        }
        setHoveredShapeId(nearShape?.id ?? null);
        setHoveredPort(nearestPort);
        if (!drag.current) return;
      }

      // Select mode (idle): show proximity port handles near shapes
      if (mode === 'select' && !drag.current) {
        const PROXIMITY = 40 / viewport.zoom;
        const PORT_SNAP = 12 / viewport.zoom;
        const nearShape = page.shapes.find((s) =>
          docPt.x >= s.x - PROXIMITY && docPt.x <= s.x + s.width + PROXIMITY &&
          docPt.y >= s.y - PROXIMITY && docPt.y <= s.y + s.height + PROXIMITY,
        );
        let nearestPort: string | null = null;
        if (nearShape) {
          for (const port of CONNECTOR_PORTS) {
            const pos = getPortPosition(nearShape, port);
            if (Math.hypot(pos.x - docPt.x, pos.y - docPt.y) < PORT_SNAP) {
              nearestPort = port;
              break;
            }
          }
        }
        setHoveredShapeId(nearShape?.id ?? null);
        setHoveredPort(nearestPort);
        return;
      }

      // Handle connector-draw drag (initiated from port-click in select mode or connector mode)
      if (drag.current?.type === 'connector-draw') {
        const d = drag.current;
        const HOVER_PAD = 24 / viewport.zoom;
        const PORT_SNAP = 12 / viewport.zoom;
        const nearShape = page.shapes.find((s) =>
          docPt.x >= s.x - HOVER_PAD && docPt.x <= s.x + s.width + HOVER_PAD &&
          docPt.y >= s.y - HOVER_PAD && docPt.y <= s.y + s.height + HOVER_PAD,
        );
        let endX = docPt.x;
        let endY = docPt.y;
        let nearestPort: string | null = null;
        if (nearShape) {
          for (const port of CONNECTOR_PORTS) {
            const pos = getPortPosition(nearShape, port);
            if (Math.hypot(pos.x - docPt.x, pos.y - docPt.y) < PORT_SNAP) {
              nearestPort = port;
              endX = pos.x;
              endY = pos.y;
              break;
            }
          }
        }
        setHoveredShapeId(nearShape?.id ?? null);
        setHoveredPort(nearestPort);
        setConnectorPreview({ x1: d.startX, y1: d.startY, x2: endX, y2: endY });
        return;
      }

      if (!drag.current) return;
      const d = drag.current;

      if (d.type === 'connector-segment') {
        const delta = d.isHorizontal ? docPt.y - d.startDocY : docPt.x - d.startDocX;
        const newValue = d.startValue + delta;
        const newWps = moveElbowSegment(d.initWaypoints, d.initStart, d.initEnd, d.segmentIndex, newValue);
        onConnectorUpdate(d.connectorId, { waypoints: newWps });
        return;
      }

      if (d.type === 'bezier-cp') {
        const dx = docPt.x - d.startDocX;
        const dy = docPt.y - d.startDocY;
        const newCp1 = d.cpIndex === 0 ? { x: d.initCp1.x + dx, y: d.initCp1.y + dy } : d.initCp1;
        const newCp2 = d.cpIndex === 1 ? { x: d.initCp2.x + dx, y: d.initCp2.y + dy } : d.initCp2;
        onConnectorUpdate(d.connectorId, { waypoints: [newCp1, newCp2] });
        return;
      }

      if (d.type === 'label-drag') {
        const dx = docPt.x - d.startDocX;
        const dy = docPt.y - d.startDocY;
        onConnectorUpdate(d.connectorId, { labelOffset: { x: d.initOffset.x + dx, y: d.initOffset.y + dy } });
        return;
      }

      if (d.type === 'endpoint-drag') {
        const HOVER_PAD = 24 / viewport.zoom;
        const PORT_SNAP = 12 / viewport.zoom;
        const nearShape = page.shapes.find((s) =>
          docPt.x >= s.x - HOVER_PAD && docPt.x <= s.x + s.width + HOVER_PAD &&
          docPt.y >= s.y - HOVER_PAD && docPt.y <= s.y + s.height + HOVER_PAD,
        );
        let snapPort: string | null = null;
        let snapX = docPt.x;
        let snapY = docPt.y;
        if (nearShape) {
          for (const port of CONNECTOR_PORTS) {
            const pos = getPortPosition(nearShape, port);
            if (Math.hypot(pos.x - docPt.x, pos.y - docPt.y) < PORT_SNAP) {
              snapPort = port;
              snapX = pos.x;
              snapY = pos.y;
              break;
            }
          }
        }
        setHoveredShapeId(nearShape?.id ?? null);
        setHoveredPort(snapPort);
        setEndpointDragOverride({ connectorId: d.connectorId, which: d.which, x: snapX, y: snapY });
        return;
      }

      if (d.type === 'shape-resize') {
        const dx = docPt.x - d.startDocX;
        const dy = docPt.y - d.startDocY;
        const MIN = 10;
        let nx = d.initX, ny = d.initY, nw = d.initW, nh = d.initH;
        const h = d.handle;
        if (h === 'nw' || h === 'w' || h === 'sw') { nx = d.initX + dx; nw = d.initW - dx; }
        if (h === 'ne' || h === 'e' || h === 'se') { nw = d.initW + dx; }
        if (h === 'nw' || h === 'n' || h === 'ne') { ny = d.initY + dy; nh = d.initH - dy; }
        if (h === 'sw' || h === 's' || h === 'se') { nh = d.initH + dy; }
        if (nw < MIN) {
          nw = MIN;
          if (h === 'nw' || h === 'w' || h === 'sw') nx = d.initX + d.initW - MIN;
        }
        if (nh < MIN) {
          nh = MIN;
          if (h === 'nw' || h === 'n' || h === 'ne') ny = d.initY + d.initH - MIN;
        }
        onShapeResize(d.shapeId, nx, ny, nw, nh);
        return;
      }

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
        const movingIds = new Set(d.multiStart.keys());
        // Compute smart guides
        const guides = computeSmartGuides(movingIds, page.shapes.map((s) => {
          if (movingIds.has(s.id)) {
            const start = d.multiStart!.get(s.id)!;
            return { ...s, x: start.x + dx, y: start.y + dy };
          }
          return s;
        }), viewport);
        setSmartGuides(guides);
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
    [getSvgPoint, svgToDoc, viewport, onViewportChange, onShapeMove, onShapeResize, onCanvasMouseMove, mode, page.shapes, onRemoveStrokesUnder, onConnectorUpdate],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Commit freehand stroke
      if (isDrawingMode(mode) && liveStroke.current) {
        const { id, tool, points } = liveStroke.current;
        if (points.length >= 4) {
          const toolWidths: Record<DrawingTool, number> = { pen: 2, pencil: 1.5, highlighter: 8 };
          onAddStroke({
            id,
            tool,
            points,
            color: drawColor,
            width: toolWidths[tool],
            opacity: tool === 'highlighter' ? 0.4 : 1,
          });
        }
        liveStroke.current = null;
        setLiveStrokePath('');
        return;
      }

      setSmartGuides([]);

      if (!drag.current) return;
      const d = drag.current;

      if (d.type === 'connector-segment' || d.type === 'bezier-cp' || d.type === 'label-drag') {
        drag.current = null;
        return;
      }

      if (d.type === 'endpoint-drag') {
        const relPt = getSvgPoint(e);
        const docEndPt = svgToDoc(relPt.x, relPt.y);
        const HOVER_PAD = 24 / viewport.zoom;
        const PORT_SNAP = 12 / viewport.zoom;
        const override = endpointDragOverride;
        const finalX = override?.x ?? docEndPt.x;
        const finalY = override?.y ?? docEndPt.y;
        const nearShape = page.shapes.find((s) =>
          finalX >= s.x - HOVER_PAD && finalX <= s.x + s.width + HOVER_PAD &&
          finalY >= s.y - HOVER_PAD && finalY <= s.y + s.height + HOVER_PAD,
        );
        let snapShapeId: string | null = null;
        let snapPort: string | undefined;
        let snapX = finalX;
        let snapY = finalY;
        if (nearShape) {
          for (const port of CONNECTOR_PORTS) {
            const pos = getPortPosition(nearShape, port);
            if (Math.hypot(pos.x - finalX, pos.y - finalY) < PORT_SNAP) {
              snapShapeId = nearShape.id;
              snapPort = port;
              snapX = pos.x;
              snapY = pos.y;
              break;
            }
          }
        }
        if (d.which === 'source') {
          onConnectorUpdate(d.connectorId, {
            sourceId: snapShapeId,
            sourcePort: snapPort,
            startPoint: snapShapeId ? undefined : { x: snapX, y: snapY },
            waypoints: [],
          });
        } else {
          onConnectorUpdate(d.connectorId, {
            targetId: snapShapeId,
            targetPort: snapPort,
            endPoint: snapShapeId ? undefined : { x: snapX, y: snapY },
            waypoints: [],
          });
        }
        drag.current = null;
        setEndpointDragOverride(null);
        setHoveredShapeId(null);
        setHoveredPort(null);
        return;
      }

      if (d.type === 'connector-draw') {
        const relPt = getSvgPoint(e);
        const docEndPt = svgToDoc(relPt.x, relPt.y);
        const HOVER_PAD = 24 / viewport.zoom;
        const PORT_SNAP = 12 / viewport.zoom;
        const nearShape = page.shapes.find((s) =>
          docEndPt.x >= s.x - HOVER_PAD && docEndPt.x <= s.x + s.width + HOVER_PAD &&
          docEndPt.y >= s.y - HOVER_PAD && docEndPt.y <= s.y + s.height + HOVER_PAD,
        );
        let targetId: string | null = nearShape?.id ?? null;
        let targetPort: string | undefined;
        let endX = docEndPt.x;
        let endY = docEndPt.y;
        if (nearShape) {
          for (const port of CONNECTOR_PORTS) {
            const pos = getPortPosition(nearShape, port);
            if (Math.hypot(pos.x - docEndPt.x, pos.y - docEndPt.y) < PORT_SNAP) {
              targetPort = port;
              endX = pos.x;
              endY = pos.y;
              break;
            }
          }
        }
        if (!(d.shapeId && d.shapeId === targetId)) {
          onAddConnector(d.shapeId ?? null, targetId, d.startX, d.startY, endX, endY, d.connectorPort, targetPort);
        }
        drag.current = null;
        setConnectorPreview(null);
        setHoveredShapeId(null);
        setHoveredPort(null);
        onModeChange('select');
        return;
      }

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
    [page.shapes, selection, onSelect, mode, onAddStroke, drawColor, getSvgPoint, svgToDoc, onAddConnector, onModeChange, viewport.zoom, endpointDragOverride, onConnectorUpdate],
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

  const handleResizeHandleMouseDown = useCallback(
    (e: React.MouseEvent, id: string, handle: string) => {
      e.stopPropagation();
      const shape = page.shapes.find((s) => s.id === id);
      if (!shape) return;
      const pt = getSvgPoint(e);
      const docPt = svgToDoc(pt.x, pt.y);
      onSelect({ shapeIds: new Set([id]), connectorIds: new Set() });
      drag.current = {
        type: 'shape-resize',
        shapeId: id,
        handle,
        startDocX: docPt.x,
        startDocY: docPt.y,
        initX: shape.x,
        initY: shape.y,
        initW: shape.width,
        initH: shape.height,
      };
    },
    [page.shapes, getSvgPoint, svgToDoc, onSelect],
  );

  const handleConnectorMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onSelect({ shapeIds: new Set(), connectorIds: new Set([id]) });
    },
    [onSelect],
  );

  const handleSegmentMouseDown = useCallback(
    (e: React.MouseEvent, connectorId: string, segmentIndex: number) => {
      e.stopPropagation();
      const connector = page.connectors.find(c => c.id === connectorId);
      if (!connector) return;

      const { start, end } = getConnectorEndpoints(connector, page.shapes);
      const initWaypoints = connector.waypoints.length > 0
        ? connector.waypoints
        : [{ x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }];

      const allPts = [start, ...initWaypoints, end];
      const seg = allPts[segmentIndex];
      const segEnd = allPts[segmentIndex + 1];
      const isHorizontal = Math.abs(seg.y - segEnd.y) < 2;

      const pt = getSvgPoint(e);
      const docPt = svgToDoc(pt.x, pt.y);

      onSelect({ shapeIds: new Set(), connectorIds: new Set([connectorId]) });

      drag.current = {
        type: 'connector-segment',
        connectorId,
        segmentIndex,
        isHorizontal,
        startDocX: docPt.x,
        startDocY: docPt.y,
        startValue: isHorizontal ? seg.y : seg.x,
        initWaypoints,
        initStart: start,
        initEnd: end,
      };
    },
    [page.connectors, page.shapes, getSvgPoint, svgToDoc, onSelect],
  );

  const handleControlPointMouseDown = useCallback(
    (e: React.MouseEvent, connectorId: string, cpIndex: 0 | 1) => {
      e.stopPropagation();
      const connector = page.connectors.find((c) => c.id === connectorId);
      if (!connector) return;
      const { start, end } = getConnectorEndpoints(connector, page.shapes);
      const [initCp1, initCp2] = getCurvedControlPoints(connector, start, end);
      const pt = getSvgPoint(e);
      const docPt = svgToDoc(pt.x, pt.y);
      onSelect({ shapeIds: new Set(), connectorIds: new Set([connectorId]) });
      drag.current = { type: 'bezier-cp', connectorId, cpIndex, startDocX: docPt.x, startDocY: docPt.y, initCp1, initCp2 };
    },
    [page.connectors, page.shapes, getSvgPoint, svgToDoc, onSelect],
  );

  const handleLabelMouseDown = useCallback(
    (e: React.MouseEvent, connectorId: string) => {
      e.stopPropagation();
      const connector = page.connectors.find((c) => c.id === connectorId);
      if (!connector) return;
      const pt = getSvgPoint(e);
      const docPt = svgToDoc(pt.x, pt.y);
      const initOffset = connector.labelOffset ?? { x: 0, y: 0 };
      onSelect({ shapeIds: new Set(), connectorIds: new Set([connectorId]) });
      drag.current = { type: 'label-drag', connectorId, startDocX: docPt.x, startDocY: docPt.y, initOffset };
    },
    [page.connectors, getSvgPoint, svgToDoc, onSelect],
  );

  const handleEndpointMouseDown = useCallback(
    (e: React.MouseEvent, connectorId: string, which: 'source' | 'target') => {
      e.stopPropagation();
      const connector = page.connectors.find((c) => c.id === connectorId);
      if (!connector) return;
      const { start, end } = getConnectorEndpoints(connector, page.shapes);
      const pos = which === 'source' ? start : end;
      onSelect({ shapeIds: new Set(), connectorIds: new Set([connectorId]) });
      drag.current = { type: 'endpoint-drag', connectorId, which };
      setEndpointDragOverride({ connectorId, which, x: pos.x, y: pos.y });
    },
    [page.connectors, page.shapes, onSelect],
  );

  // Drag-and-drop from ShapePanel
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('shape-type')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('shape-type') as ShapeType;
      if (!type) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const svgX = e.clientX - rect.left;
      const svgY = e.clientY - rect.top;
      const docPt = svgToDoc(svgX, svgY);
      const dataUrl = e.dataTransfer.getData('shape-data-url');
      const extraData = dataUrl ? { imageUrl: dataUrl } : undefined;
      onAddShape(type, docPt.x, docPt.y, extraData);
    },
    [svgToDoc, onAddShape],
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

  const cursorClass = (() => {
    if (mode === 'pan') return styles.cursorGrab;
    if (isDrawingMode(mode) || mode === 'eraser' || mode === 'connector') return styles.cursorCrosshair;
    if (mode === 'select' && hoveredPort) return styles.cursorCrosshair;
    return '';
  })();

  return (
    <div className={styles.root} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className={`${styles.canvas} ${cursorClass}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          drag.current = null;
          setLassoRect(null);
          setSmartGuides([]);
          setConnectorPreview(null);
          setHoveredShapeId(null);
          setHoveredPort(null);
          setEndpointDragOverride(null);
          if (liveStroke.current) {
            liveStroke.current = null;
            setLiveStrokePath('');
          }
          onCanvasMouseMove(null);
        }}
        onWheel={handleWheel}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{ display: 'block' }}
      >
        {/* Grid */}
        {(page.gridEnabled !== false) && (
          <GridOverlay viewport={viewport} width={canvasSize.width} height={canvasSize.height} />
        )}

        {/* Document layer */}
        <g transform={`translate(${tx}, ${ty}) scale(${viewport.zoom})`}>
          {/* Freehand strokes (below shapes) */}
          {(page.strokes ?? []).map((stroke) => (
            <StrokeRenderer key={stroke.id} stroke={stroke} />
          ))}

          {/* Connectors behind shapes (default, zIndex unset or 0) */}
          {page.connectors.filter((c) => !c.zIndex || c.zIndex < 1).map((c) => (
            <ConnectorRenderer
              key={c.id}
              connector={c}
              shapes={page.shapes}
              selected={selection.connectorIds.has(c.id)}
              onMouseDown={handleConnectorMouseDown}
              onSegmentMouseDown={handleSegmentMouseDown}
              shiftHeld={shiftHeld}
              onSplitSegment={(connectorId, _segIndex, newWps) => onConnectorUpdate(connectorId, { waypoints: newWps })}
              onRemoveSegment={(connectorId, _segIndex, newWps) => onConnectorUpdate(connectorId, { waypoints: newWps })}
              onControlPointMouseDown={handleControlPointMouseDown}
              onLabelMouseDown={handleLabelMouseDown}
              onEndpointMouseDown={handleEndpointMouseDown}
              endpointOverride={endpointDragOverride?.connectorId === c.id ? endpointDragOverride : undefined}
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
              onResizeHandleMouseDown={handleResizeHandleMouseDown}
            />
          ))}

          {/* Connectors in front of shapes (zIndex >= 1) */}
          {page.connectors.filter((c) => c.zIndex && c.zIndex >= 1).map((c) => (
            <ConnectorRenderer
              key={c.id}
              connector={c}
              shapes={page.shapes}
              selected={selection.connectorIds.has(c.id)}
              onMouseDown={handleConnectorMouseDown}
              onSegmentMouseDown={handleSegmentMouseDown}
              shiftHeld={shiftHeld}
              onSplitSegment={(connectorId, _segIndex, newWps) => onConnectorUpdate(connectorId, { waypoints: newWps })}
              onRemoveSegment={(connectorId, _segIndex, newWps) => onConnectorUpdate(connectorId, { waypoints: newWps })}
              onControlPointMouseDown={handleControlPointMouseDown}
              onLabelMouseDown={handleLabelMouseDown}
              onEndpointMouseDown={handleEndpointMouseDown}
              endpointOverride={endpointDragOverride?.connectorId === c.id ? endpointDragOverride : undefined}
            />
          ))}

          {/* Connector port handles (connector mode + proximity in select mode) */}
          {(mode === 'connector' || mode === 'select') && hoveredShapeId && (() => {
            const hShape = page.shapes.find((s) => s.id === hoveredShapeId);
            return hShape ? <ConnectorHandles shape={hShape} hoveredPort={hoveredPort} /> : null;
          })()}

          {/* In-progress connector preview */}
          {connectorPreview && (() => {
            const dx = connectorPreview.x2 - connectorPreview.x1;
            const dy = connectorPreview.y2 - connectorPreview.y1;
            const len = Math.hypot(dx, dy) || 1;
            return (
              <g style={{ pointerEvents: 'none' }}>
                <line
                  x1={connectorPreview.x1} y1={connectorPreview.y1}
                  x2={connectorPreview.x2} y2={connectorPreview.y2}
                  stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 3"
                />
                <ConnectorArrowHead x={connectorPreview.x2} y={connectorPreview.y2} dx={dx / len} dy={dy / len} arrowType="filled" color="#2563eb" strokeWidth={1.5} />
              </g>
            );
          })()}

          {/* Live stroke being drawn */}
          {liveStrokePath && (
            <path
              d={liveStrokePath}
              fill="none"
              stroke={drawColor}
              strokeWidth={mode === 'highlighter' ? 16 : mode === 'pencil' ? 1.5 : 2}
              opacity={mode === 'highlighter' ? 0.35 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}
            />
          )}

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

        {/* Smart alignment guides (screen coords) */}
        <SmartGuides guides={smartGuides} canvasWidth={canvasSize.width} canvasHeight={canvasSize.height} viewport={viewport} />

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

    </div>
  );
}
