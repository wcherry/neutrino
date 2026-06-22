'use client';

import React from 'react';
import {
  MousePointer2,
  Crop,
  Pen,
  Highlighter,
  ArrowUpRight,
  Square,
  Circle,
  Minus,
  Type,
  Blend,
  Grid3x3,
  RectangleHorizontal,
} from 'lucide-react';
import type { Tool } from './types';
import styles from './page.module.css';

interface PhotoToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
}

interface ToolDef {
  tool: Tool;
  icon: React.ReactNode;
  title: string;
}

const TOOL_GROUPS: (ToolDef | 'divider')[] = [
  { tool: 'select', icon: <MousePointer2 size={18} />, title: 'Select' },
  { tool: 'crop', icon: <Crop size={18} />, title: 'Crop' },
  'divider',
  { tool: 'pen', icon: <Pen size={18} />, title: 'Pen' },
  { tool: 'highlighter', icon: <Highlighter size={18} />, title: 'Highlighter' },
  { tool: 'arrow', icon: <ArrowUpRight size={18} />, title: 'Arrow' },
  { tool: 'rectangle', icon: <Square size={18} />, title: 'Rectangle' },
  { tool: 'circle', icon: <Circle size={18} />, title: 'Circle' },
  { tool: 'line', icon: <Minus size={18} />, title: 'Line' },
  { tool: 'text', icon: <Type size={18} />, title: 'Text' },
  'divider',
  { tool: 'blur', icon: <Blend size={18} />, title: 'Blur' },
  { tool: 'pixelate', icon: <Grid3x3 size={18} />, title: 'Pixelate' },
  { tool: 'blackbox', icon: <RectangleHorizontal size={18} />, title: 'Black Box' },
];

export function PhotoToolbar({ activeTool, onToolChange }: PhotoToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Photo editing tools">
      {TOOL_GROUPS.map((item, i) => {
        if (item === 'divider') {
          return <div key={`divider-${i}`} className={styles.toolDivider} aria-hidden="true" />;
        }
        const isActive = activeTool === item.tool;
        return (
          <button
            key={item.tool}
            className={`${styles.toolBtn} ${isActive ? styles.toolBtnActive : ''}`}
            title={item.title}
            aria-pressed={isActive}
            onClick={() => onToolChange(item.tool)}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}
