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
  Stamp,
} from 'lucide-react';
import { ToolbarItems, type ToolDef as ToolbarToolDef } from '@/components/editorChrome/ToolbarItems';
import type { Tool } from './types';
import styles from './page.module.css';

interface PhotoToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
}

interface PhotoTool {
  tool: Tool;
  icon: React.ReactNode;
  title: string;
}

/** The tool groups, as the editor's toolbar catalog (`EDITOR_TOOLBARS.photos`) names them. */
const TOOL_GROUPS: { id: string; tools: PhotoTool[] }[] = [
  {
    id: 'select',
    tools: [
      { tool: 'select', icon: <MousePointer2 size={18} />, title: 'Select (Shift+drag to select an area)' },
      { tool: 'crop', icon: <Crop size={18} />, title: 'Crop' },
    ],
  },
  {
    id: 'annotate',
    tools: [
      { tool: 'pen', icon: <Pen size={18} />, title: 'Pen' },
      { tool: 'highlighter', icon: <Highlighter size={18} />, title: 'Highlighter' },
      { tool: 'arrow', icon: <ArrowUpRight size={18} />, title: 'Arrow' },
      { tool: 'rectangle', icon: <Square size={18} />, title: 'Rectangle' },
      { tool: 'circle', icon: <Circle size={18} />, title: 'Circle' },
      { tool: 'line', icon: <Minus size={18} />, title: 'Line' },
      { tool: 'text', icon: <Type size={18} />, title: 'Text' },
    ],
  },
  {
    id: 'redact',
    tools: [
      { tool: 'blur', icon: <Blend size={18} />, title: 'Blur' },
      { tool: 'pixelate', icon: <Grid3x3 size={18} />, title: 'Pixelate' },
      { tool: 'blackbox', icon: <RectangleHorizontal size={18} />, title: 'Black Box' },
    ],
  },
  {
    id: 'clone',
    tools: [{ tool: 'clone', icon: <Stamp size={18} />, title: 'Clone Stamp (Alt+click to set source)' }],
  },
];

/**
 * The editor's tool rail. Its groups go through `ToolbarItems`, as every editor's toolbar does, so
 * they can be reordered, tucked into "More tools" and captioned, and a right-click (Ctrl-click on a
 * Mac) anywhere on the rail opens "Customize toolbar…".
 */
export function PhotoToolbar({ activeTool, onToolChange }: PhotoToolbarProps) {
  const tools: ToolbarToolDef[] = TOOL_GROUPS.map(group => ({
    id: group.id,
    render: () => group.tools.map(item => {
      const isActive = activeTool === item.tool;
      return (
        <button
          key={item.tool}
          className={`${styles.toolBtn} ${isActive ? styles.toolBtnActive : ''}`}
          title={item.title}
          aria-label={item.title}
          aria-pressed={isActive}
          onClick={() => onToolChange(item.tool)}
        >
          {item.icon}
        </button>
      );
    }),
  }));

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Photo editing tools">
      <ToolbarItems
        editor="photos"
        vertical
        tools={tools}
        divider={<div className={styles.toolDivider} aria-hidden="true" />}
      />
    </div>
  );
}
