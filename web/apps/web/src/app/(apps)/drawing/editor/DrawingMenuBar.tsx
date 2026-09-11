'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { HamburgerMenu, type HamburgerMenuItem } from '@neutrino/ui';
import type { ToolType } from './types';

export interface DrawingMenuBarProps {
  tool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
  onSelectAll: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  hasClipboard: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToScreen: () => void;
  onToggleLock: () => void;
  onExport: () => void;
  onVersionHistory: () => void;
  onAddImage: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  canGroup: boolean;
  canUngroup: boolean;
  onBringForward: () => void;
  onSendBackward: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  /** Workspace state — redesign §5, stored with the document but not part of the image. */
  showRulers: boolean;
  onToggleRulers: () => void;
  showGuides: boolean;
  onToggleGuides: () => void;
  lockGuides: boolean;
  onToggleLockGuides: () => void;
  snapToGuides: boolean;
  onToggleSnapGuides: () => void;
  onClearGuides: () => void;
  guideCount: number;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  /** Opens a `.ora` written by Krita, GIMP or this app (redesign phase 3). */
  onImportOra: () => void;
  /** Opens an `.svg` as editable shapes, text and paths (redesign phase 5). */
  onImportSvg: () => void;
  onSelectAllPixels: () => void;
  onDeselectPixels: () => void;
  onInvertSelection: () => void;
  hasPixelSelection: boolean;
}

/** A tool's menu label, ticked when it is the armed one. */
function check(current: ToolType, tool: ToolType, label: string): string {
  return current === tool ? `${label} ✓` : label;
}

export function DrawingMenuBar({
  tool,
  onToolChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  selectedCount,
  onSelectAll,
  onCut,
  onCopy,
  onPaste,
  hasClipboard,
  onDelete,
  onDuplicate,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToScreen,
  onToggleLock,
  onExport,
  onVersionHistory,
  onAddImage,
  onGroup,
  onUngroup,
  canGroup,
  canUngroup,
  onBringForward,
  onSendBackward,
  showGrid,
  onToggleGrid,
  showRulers,
  onToggleRulers,
  showGuides,
  onToggleGuides,
  lockGuides,
  onToggleLockGuides,
  snapToGuides,
  onToggleSnapGuides,
  onClearGuides,
  guideCount,
  titleInputRef,
  onImportOra,
  onImportSvg,
  onSelectAllPixels,
  onDeselectPixels,
  onInvertSelection,
  hasPixelSelection,
}: DrawingMenuBarProps) {
  const router = useRouter();

  const items: HamburgerMenuItem[] = [
    {
      kind: 'submenu',
      label: 'File',
      items: [
        { kind: 'action', label: 'New drawing', shortcut: '⌘N', action: () => router.push('/drawing/new') },
        { kind: 'action', label: 'Open drawings list', action: () => router.push('/drive') },
        { kind: 'separator' },
        { kind: 'action', label: 'Rename', action: () => { titleInputRef.current?.focus(); titleInputRef.current?.select(); } },
        { kind: 'separator' },
        { kind: 'action', label: 'Insert image…', action: onAddImage },
        { kind: 'separator' },
        { kind: 'action', label: 'Import OpenRaster…', action: onImportOra },
        { kind: 'action', label: 'Import SVG…', action: onImportSvg },
        { kind: 'separator' },
        { kind: 'action', label: 'Export…', action: onExport },
        { kind: 'separator' },
        { kind: 'action', label: 'Version history', action: onVersionHistory },
      ],
    },
    {
      kind: 'submenu',
      label: 'Edit',
      items: [
        { kind: 'action', label: 'Undo', shortcut: '⌘Z', disabled: !canUndo, action: onUndo },
        { kind: 'action', label: 'Redo', shortcut: '⌘⇧Z', disabled: !canRedo, action: onRedo },
        { kind: 'separator' },
        { kind: 'action', label: 'Select all', shortcut: '⌘A', action: onSelectAll },
        { kind: 'separator' },
        // A pixel selection and an object selection are different things —
        // one confines a brush, the other names what a drag moves — so they get
        // their own entries rather than one "select all" that means both.
        { kind: 'action', label: 'Select all pixels', action: onSelectAllPixels },
        // ⌘⇧D, because ⌘D is Duplicate below and has been for as long as the
        // editor has existed.
        { kind: 'action', label: 'Deselect pixels', shortcut: '⌘⇧D', disabled: !hasPixelSelection, action: onDeselectPixels },
        { kind: 'action', label: 'Invert selection', shortcut: '⌘⇧I', disabled: !hasPixelSelection, action: onInvertSelection },
        { kind: 'separator' },
        { kind: 'action', label: 'Cut', shortcut: '⌘X', disabled: selectedCount === 0, action: onCut },
        { kind: 'action', label: 'Copy', shortcut: '⌘C', disabled: selectedCount === 0, action: onCopy },
        { kind: 'action', label: 'Paste', shortcut: '⌘V', disabled: !hasClipboard, action: onPaste },
        { kind: 'separator' },
        { kind: 'action', label: 'Delete', shortcut: '⌫', disabled: selectedCount === 0, action: onDelete },
        { kind: 'action', label: 'Duplicate', shortcut: '⌘D', disabled: selectedCount === 0, action: onDuplicate },
        { kind: 'separator' },
        { kind: 'action', label: 'Lock', disabled: selectedCount === 0, action: onToggleLock },
      ],
    },
    {
      kind: 'submenu',
      label: 'Arrange',
      items: [
        { kind: 'action', label: 'Bring forward', shortcut: '⌘]', disabled: selectedCount === 0, action: onBringForward },
        { kind: 'action', label: 'Send backward', shortcut: '⌘[', disabled: selectedCount === 0, action: onSendBackward },
        { kind: 'separator' },
        { kind: 'action', label: 'Group', shortcut: '⌘G', disabled: !canGroup, action: onGroup },
        { kind: 'action', label: 'Ungroup', shortcut: '⌘⇧G', disabled: !canUngroup, action: onUngroup },
      ],
    },
    {
      kind: 'submenu',
      label: 'View',
      items: [
        { kind: 'action', label: showGrid ? 'Hide gridlines' : 'Show gridlines', shortcut: '⌘\'', action: onToggleGrid },
        { kind: 'action', label: showRulers ? 'Hide rulers' : 'Show rulers', shortcut: '⌘R', action: onToggleRulers },
        { kind: 'separator' },
        // Guides are their own group: three switches and a destructive action
        // that belong together, and that none of the zoom entries below relate
        // to. Drag one out of a ruler to make it; drag it off the page to
        // remove it.
        { kind: 'action', label: showGuides ? 'Hide guides' : 'Show guides', shortcut: '⌘;', action: onToggleGuides },
        { kind: 'action', label: lockGuides ? 'Unlock guides' : 'Lock guides', action: onToggleLockGuides },
        { kind: 'action', label: snapToGuides ? 'Snap to guides ✓' : 'Snap to guides', action: onToggleSnapGuides },
        { kind: 'action', label: 'Clear guides', disabled: guideCount === 0, action: onClearGuides },
        { kind: 'separator' },
        { kind: 'action', label: 'Zoom in', shortcut: '⌘+', action: onZoomIn },
        { kind: 'action', label: 'Zoom out', shortcut: '⌘−', action: onZoomOut },
        { kind: 'action', label: 'Reset zoom', shortcut: '⌘0', action: onResetZoom },
        { kind: 'separator' },
        { kind: 'action', label: 'Fit to screen', action: onFitToScreen },
      ],
    },
    {
      kind: 'submenu',
      label: 'Tools',
      items: [
        { kind: 'action', label: check(tool, 'select', 'Select'), shortcut: 'S', action: () => onToolChange('select') },
        { kind: 'action', label: check(tool, 'node', 'Edit path points'), shortcut: 'A', action: () => onToolChange('node') },
        { kind: 'action', label: check(tool, 'transform', 'Transform layer'), shortcut: 'V', action: () => onToolChange('transform') },
        { kind: 'separator' },
        { kind: 'action', label: check(tool, 'pen', 'Pen'), shortcut: 'P', action: () => onToolChange('pen') },
        { kind: 'action', label: check(tool, 'line', 'Line'), shortcut: 'L', action: () => onToolChange('line') },
        { kind: 'action', label: check(tool, 'rectangle', 'Rectangle'), shortcut: 'R', action: () => onToolChange('rectangle') },
        { kind: 'action', label: check(tool, 'ellipse', 'Ellipse'), shortcut: 'E', action: () => onToolChange('ellipse') },
        { kind: 'action', label: check(tool, 'arrow', 'Arrow'), action: () => onToolChange('arrow') },
        { kind: 'action', label: check(tool, 'text', 'Text'), shortcut: 'T', action: () => onToolChange('text') },
        { kind: 'separator' },
        { kind: 'action', label: check(tool, 'brush', 'Brush'), shortcut: 'B', action: () => onToolChange('brush') },
        { kind: 'action', label: check(tool, 'pencil', 'Pencil'), shortcut: 'N', action: () => onToolChange('pencil') },
        { kind: 'action', label: check(tool, 'marker', 'Marker'), action: () => onToolChange('marker') },
        { kind: 'action', label: check(tool, 'airbrush', 'Airbrush'), action: () => onToolChange('airbrush') },
        { kind: 'action', label: check(tool, 'paint-eraser', 'Erase pixels'), shortcut: 'X', action: () => onToolChange('paint-eraser') },
        { kind: 'separator' },
        { kind: 'action', label: check(tool, 'select-rect', 'Rectangular selection'), shortcut: 'M', action: () => onToolChange('select-rect') },
        { kind: 'action', label: check(tool, 'select-ellipse', 'Elliptical selection'), action: () => onToolChange('select-ellipse') },
        { kind: 'action', label: check(tool, 'lasso', 'Lasso selection'), shortcut: 'Q', action: () => onToolChange('lasso') },
        { kind: 'separator' },
        { kind: 'action', label: check(tool, 'eraser', 'Delete objects'), action: () => onToolChange('eraser') },
      ],
    },
  ];

  return <HamburgerMenu items={items} />;
}
