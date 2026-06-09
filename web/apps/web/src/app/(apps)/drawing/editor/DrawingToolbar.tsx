'use client';

import React from 'react';
import {
  MousePointer2,
  Pen,
  Minus,
  Square,
  Circle,
  ArrowRight,
  Type,
  Eraser,
  ZoomIn,
  ZoomOut,
  Maximize2,
  type LucideIcon,
} from 'lucide-react';
import type { ToolType } from './types';

interface DrawingToolbarProps {
  tool: ToolType;
  onToolChange: (t: ToolType) => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

const TOOLS: { id: ToolType; icon: LucideIcon; label: string }[] = [
  { id: 'select',    icon: MousePointer2, label: 'Select' },
  { id: 'pen',       icon: Pen,           label: 'Pen' },
  { id: 'line',      icon: Minus,         label: 'Line' },
  { id: 'rectangle', icon: Square,        label: 'Rectangle' },
  { id: 'ellipse',   icon: Circle,        label: 'Ellipse' },
  { id: 'arrow',     icon: ArrowRight,    label: 'Arrow' },
  { id: 'text',      icon: Type,          label: 'Text' },
];

export function DrawingToolbar({
  tool,
  onToolChange,
  scale,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: DrawingToolbarProps) {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? 'var(--color-primary, #2563eb)' : 'transparent',
    color: active ? '#ffffff' : '#374151',
    transition: 'background 0.1s',
  });

  const dividerStyle: React.CSSProperties = {
    width: 24,
    height: 1,
    background: '#e5e7eb',
    margin: '4px auto',
  };

  const sidebarStyle: React.CSSProperties = {
    width: 48,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 0',
    gap: 2,
    background: '#ffffff',
    borderRight: '1px solid #e5e7eb',
    flexShrink: 0,
    overflowY: 'auto',
  };

  const zoomLabelStyle: React.CSSProperties = {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  };

  return (
    <div style={sidebarStyle}>
      {TOOLS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          title={label}
          style={btnStyle(tool === id)}
          onClick={() => onToolChange(id)}
          aria-label={label}
          aria-pressed={tool === id}
        >
          <Icon size={16} />
        </button>
      ))}

      <div style={dividerStyle} />

      <button
        title="Eraser"
        style={btnStyle(tool === 'eraser')}
        onClick={() => onToolChange('eraser')}
        aria-label="Eraser"
        aria-pressed={tool === 'eraser'}
      >
        <Eraser size={16} />
      </button>

      <div style={{ flex: 1 }} />

      <div style={dividerStyle} />

      <button title="Zoom in" style={btnStyle(false)} onClick={onZoomIn} aria-label="Zoom in">
        <ZoomIn size={14} />
      </button>
      <div style={zoomLabelStyle}>{Math.round(scale * 100)}%</div>
      <button title="Zoom out" style={btnStyle(false)} onClick={onZoomOut} aria-label="Zoom out">
        <ZoomOut size={14} />
      </button>
      <button title="Fit to screen" style={btnStyle(false)} onClick={onZoomReset} aria-label="Fit to screen">
        <Maximize2 size={14} />
      </button>
    </div>
  );
}
