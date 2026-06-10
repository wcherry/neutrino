'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { HamburgerMenu, type HamburgerMenuItem } from '@neutrino/ui';
import type { ToolType } from './types';

export interface DrawingMenuBarProps {
  tool: ToolType;
  onToolChange: (t: ToolType) => void;
  selectedCount: number;
  onSelectAll: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToScreen: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onToggleLock: () => void;
  onExport: () => void;
  onVersionHistory: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
}

export function DrawingMenuBar({
  tool,
  onToolChange,
  selectedCount,
  onSelectAll,
  onDelete,
  onDuplicate,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToScreen,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onToggleLock,
  onExport,
  onVersionHistory,
  showGrid,
  onToggleGrid,
  titleInputRef,
}: DrawingMenuBarProps) {
  const router = useRouter();

  const items: HamburgerMenuItem[] = [
    {
      kind: 'submenu',
      label: 'File',
      items: [
        { kind: 'action', label: 'New drawing',          shortcut: '⌘N', action: () => router.push('/drawing/new') },
        { kind: 'action', label: 'Open drawings list',                   action: () => router.push('/drive') },
        { kind: 'separator' },
        { kind: 'action', label: 'Rename',                               action: () => { titleInputRef.current?.focus(); titleInputRef.current?.select(); } },
        { kind: 'separator' },
        { kind: 'action', label: 'Export…',                              action: onExport },
        { kind: 'separator' },
        { kind: 'action', label: 'Version history',                      action: onVersionHistory },
      ],
    },
    {
      kind: 'submenu',
      label: 'Edit',
      items: [
        { kind: 'action', label: 'Select all',    shortcut: '⌘A',  action: onSelectAll },
        { kind: 'separator' },
        { kind: 'action', label: 'Delete',        shortcut: '⌫',   disabled: selectedCount === 0, action: onDelete },
        { kind: 'action', label: 'Duplicate',     shortcut: '⌘D',  disabled: selectedCount === 0, action: onDuplicate },
        { kind: 'separator' },
        { kind: 'action', label: 'Bring forward', shortcut: '⌘]',  disabled: selectedCount === 0, action: onBringForward },
        { kind: 'action', label: 'Send backward', shortcut: '⌘[',  disabled: selectedCount === 0, action: onSendBackward },
        { kind: 'action', label: 'Bring to front',               disabled: selectedCount === 0, action: onBringToFront },
        { kind: 'action', label: 'Send to back',                 disabled: selectedCount === 0, action: onSendToBack },
        { kind: 'separator' },
        { kind: 'action', label: 'Lock',                         disabled: selectedCount === 0, action: onToggleLock },
      ],
    },
    {
      kind: 'submenu',
      label: 'View',
      items: [
        { kind: 'action', label: showGrid ? 'Hide gridlines' : 'Show gridlines', shortcut: '⌘\'', action: onToggleGrid },
        { kind: 'separator' },
        { kind: 'action', label: 'Zoom in',       shortcut: '⌘+', action: onZoomIn },
        { kind: 'action', label: 'Zoom out',       shortcut: '⌘−', action: onZoomOut },
        { kind: 'action', label: 'Reset zoom',     shortcut: '⌘0', action: onResetZoom },
        { kind: 'separator' },
        { kind: 'action', label: 'Fit to screen',                 action: onFitToScreen },
      ],
    },
    {
      kind: 'submenu',
      label: 'Tools',
      items: [
        { kind: 'action', label: tool === 'select'    ? 'Select ✓'    : 'Select',    shortcut: 'S', action: () => onToolChange('select') },
        { kind: 'action', label: tool === 'pen'       ? 'Pen ✓'       : 'Pen',       shortcut: 'P', action: () => onToolChange('pen') },
        { kind: 'action', label: tool === 'line'      ? 'Line ✓'      : 'Line',      shortcut: 'L', action: () => onToolChange('line') },
        { kind: 'action', label: tool === 'rectangle' ? 'Rectangle ✓' : 'Rectangle', shortcut: 'R', action: () => onToolChange('rectangle') },
        { kind: 'action', label: tool === 'ellipse'   ? 'Ellipse ✓'   : 'Ellipse',   shortcut: 'E', action: () => onToolChange('ellipse') },
        { kind: 'action', label: tool === 'arrow'     ? 'Arrow ✓'     : 'Arrow',                    action: () => onToolChange('arrow') },
        { kind: 'action', label: tool === 'text'      ? 'Text ✓'      : 'Text',      shortcut: 'T', action: () => onToolChange('text') },
        { kind: 'separator' },
        { kind: 'action', label: tool === 'eraser'    ? 'Eraser ✓'    : 'Eraser',                   action: () => onToolChange('eraser') },
      ],
    },
  ];

  return <HamburgerMenu items={items} />;
}
