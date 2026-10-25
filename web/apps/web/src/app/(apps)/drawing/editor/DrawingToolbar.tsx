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
import { ToolbarItems, type ToolDef } from '@/components/editorChrome/ToolbarItems';
import styles from './DrawingToolbar.module.css';

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

const GROUP_IDS = ['select', 'shapes', 'paint', 'pixelSelect'] as const;

export function DrawingToolbar({ tool, onToolChange, onAddImage }: DrawingToolbarProps) {
  const button = (id: ToolType, Icon: LucideIcon, label: string) => (
    <button
      key={id}
      title={label}
      className={`${styles.btn} ${tool === id ? styles.active : ''}`}
      onClick={() => onToolChange(id)}
      aria-label={label}
      aria-pressed={tool === id}
    >
      <Icon size={16} />
    </button>
  );

  // The four groups and the insert pair, each one entry the user can reorder or hide (U10).
  const tools: ToolDef[] = [
    ...GROUPS.map((group, index) => ({
      id: GROUP_IDS[index],
      render: () => <>{group.map(({ id, icon, label }) => button(id, icon, label))}</>,
    })),
    {
      id: 'insert',
      render: () => (
        <>
          <button title="Insert image" className={styles.btn} onClick={onAddImage} aria-label="Insert image">
            <ImageIcon size={16} />
          </button>
          <button
            title="Delete objects"
            className={`${styles.btn} ${tool === 'eraser' ? styles.active : ''}`}
            onClick={() => onToolChange('eraser')}
            aria-label="Delete objects"
            aria-pressed={tool === 'eraser'}
          >
            <Eraser size={16} strokeWidth={1.4} />
          </button>
        </>
      ),
    },
  ];

  return (
    <div className={styles.rail} data-tour="drawing-tools">
      <ToolbarItems editor="drawing" vertical tools={tools} divider={<div className={styles.divider} />} />
    </div>
  );
}
