'use client';

import React from 'react';
import {
  ArrowRight,
  Brush,
  Circle,
  Eraser,
  Image as ImageIcon,
  Lasso,
  Minus,
  MousePointer2,
  Move3d,
  Pen,
  Pencil,
  Spline,
  Square,
  SquareDashedMousePointer,
  CircleDashed,
  Highlighter,
  SprayCan,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { ToolType } from './types';

interface DrawingToolbarProps {
  tool: ToolType;
  onToolChange: (tool: ToolType) => void;
  /** Opens the image picker. Not a tool — see `ToolType`. */
  onAddImage: () => void;
}

interface ToolEntry {
  id: ToolType;
  icon: LucideIcon;
  label: string;
}

/**
 * The toolbar, in four groups separated by rules.
 *
 * The grouping is the tool taxonomy in `types.ts` made visible: what you select
 * with, what you draw as objects, what you paint as pixels, and what you select
 * *pixels* with. Those are genuinely different kinds of action — a brush stroke
 * and a rectangle end up in different sorts of layer — and a flat list of
 * seventeen buttons would hide that distinction behind an alphabet of icons.
 */
const GROUPS: ToolEntry[][] = [
  [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'node', icon: Spline, label: 'Edit path points' },
    { id: 'transform', icon: Move3d, label: 'Transform layer' },
  ],
  [
    { id: 'pen', icon: Pen, label: 'Pen' },
    { id: 'line', icon: Minus, label: 'Line' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse' },
    { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
    { id: 'text', icon: Type, label: 'Text' },
  ],
  [
    { id: 'brush', icon: Brush, label: 'Brush' },
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'marker', icon: Highlighter, label: 'Marker' },
    { id: 'airbrush', icon: SprayCan, label: 'Airbrush' },
    { id: 'paint-eraser', icon: Eraser, label: 'Erase pixels' },
  ],
  [
    { id: 'select-rect', icon: SquareDashedMousePointer, label: 'Rectangular selection' },
    { id: 'select-ellipse', icon: CircleDashed, label: 'Elliptical selection' },
    { id: 'lasso', icon: Lasso, label: 'Lasso selection' },
  ],
];

export function DrawingToolbar({ tool, onToolChange, onAddImage }: DrawingToolbarProps) {
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

  return (
    <div style={sidebarStyle}>
      {GROUPS.map((group, index) => (
        <React.Fragment key={index}>
          {index > 0 && <div style={dividerStyle} />}
          {group.map(({ id, icon: Icon, label }) => (
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
        </React.Fragment>
      ))}

      <div style={dividerStyle} />

      <button
        title="Insert image"
        style={btnStyle(false)}
        onClick={onAddImage}
        aria-label="Insert image"
      >
        <ImageIcon size={16} />
      </button>

      <button
        title="Delete objects"
        style={btnStyle(tool === 'eraser')}
        onClick={() => onToolChange('eraser')}
        aria-label="Delete objects"
        aria-pressed={tool === 'eraser'}
      >
        <Eraser size={16} strokeWidth={1.4} />
      </button>
    </div>
  );
}
