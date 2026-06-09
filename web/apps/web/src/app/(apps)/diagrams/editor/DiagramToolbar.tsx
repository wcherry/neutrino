'use client';

import React, { useState } from 'react';
import {
  MousePointer2,
  Hand,
  Minus,
  Undo2,
  Redo2,
  Save,
  MessageSquare,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  ChevronUp,
  ChevronDown,
  ArrowUpToLine,
  ArrowDownToLine,
  // Phase 4 — Whiteboard
  Pen,
  Highlighter,
  Eraser,
  Presentation,
  // Phase 5 — Layout
  Network,
  // Phase 6 — Data
  Database,
  // Phase 7 — IO
  Upload,
  Download,
  // Phase 8 — Developer
  Code2,
  // Phase 10 — AI
  Sparkles,
} from 'lucide-react';
import type { EditorSelection, SelectionMode } from '../types';
import type { AlignDirection } from './utils/shapeUtils';
import type { LayoutAlgorithm } from './layout/layoutEngine';
import styles from './DiagramToolbar.module.css';

interface DiagramToolbarProps {
  title: string;
  titleEditing: boolean;
  onTitleClick: () => void;
  onTitleChange: (t: string) => void;
  onTitleBlur: () => void;
  mode: SelectionMode;
  onModeChange: (m: SelectionMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  isSaving: boolean;
  onToggleComments: () => void;
  showComments: boolean;
  onToggleData: () => void;
  showData: boolean;
  onToggleDeveloper: () => void;
  showDeveloper: boolean;
  onToggleAi: () => void;
  showAi: boolean;
  onExport: () => void;
  onImport: () => void;
  onRunLayout: (alg: LayoutAlgorithm) => void;
  onPresentation: () => void;
  selection: EditorSelection;
  onAlign: (dir: AlignDirection) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  presenceBar: React.ReactNode;
  /** Active pen/highlighter color */
  drawColor: string;
  onDrawColorChange: (color: string) => void;
}

export function DiagramToolbar({
  title, titleEditing, onTitleClick, onTitleChange, onTitleBlur,
  mode, onModeChange,
  canUndo, canRedo, onUndo, onRedo,
  onSave, isSaving,
  onToggleComments, showComments,
  onToggleData, showData,
  onToggleDeveloper, showDeveloper,
  onToggleAi, showAi,
  onExport, onImport,
  onRunLayout,
  onPresentation,
  selection,
  onAlign, onDistribute,
  onBringForward, onSendBackward, onBringToFront, onSendToBack,
  presenceBar,
  drawColor,
  onDrawColorChange,
}: DiagramToolbarProps) {
  const hasSelection = selection.shapeIds.size > 0 || selection.connectorIds.size > 0;
  const hasMultiSelection = selection.shapeIds.size >= 2;
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);

  const isDrawing = mode === 'pen' || mode === 'pencil' || mode === 'highlighter' || mode === 'eraser';

  return (
    <div className={styles.toolbar}>
      {/* Left: mode tools + history */}
      <div className={styles.left}>
        <button
          className={`${styles.toolBtn} ${mode === 'select' ? styles.active : ''}`}
          onClick={() => onModeChange('select')}
          title="Select (V)"
        >
          <MousePointer2 size={16} />
        </button>
        <button
          className={`${styles.toolBtn} ${mode === 'pan' ? styles.active : ''}`}
          onClick={() => onModeChange('pan')}
          title="Pan (H)"
        >
          <Hand size={16} />
        </button>
        <button
          className={`${styles.toolBtn} ${mode === 'connector' ? styles.active : ''}`}
          onClick={() => onModeChange('connector')}
          title="Connector"
        >
          <Minus size={16} style={{ transform: 'rotate(-45deg)' }} />
        </button>

        <div className={styles.divider} />

        {/* Phase 4 — Whiteboard tools */}
        <button
          className={`${styles.toolBtn} ${mode === 'pen' ? styles.active : ''}`}
          onClick={() => onModeChange('pen')}
          title="Pen"
        >
          <Pen size={15} />
        </button>
        <button
          className={`${styles.toolBtn} ${mode === 'highlighter' ? styles.active : ''}`}
          onClick={() => onModeChange('highlighter')}
          title="Highlighter"
        >
          <Highlighter size={15} />
        </button>
        <button
          className={`${styles.toolBtn} ${mode === 'eraser' ? styles.active : ''}`}
          onClick={() => onModeChange('eraser')}
          title="Eraser"
        >
          <Eraser size={15} />
        </button>

        {isDrawing && (
          <input
            type="color"
            value={drawColor}
            onChange={(e) => onDrawColorChange(e.target.value)}
            title="Drawing color"
            className={styles.colorPicker}
          />
        )}

        <div className={styles.divider} />

        <button
          className={styles.toolBtn}
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          className={styles.toolBtn}
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
        >
          <Redo2 size={16} />
        </button>
      </div>

      {/* Center: title */}
      <div className={styles.center}>
        {titleEditing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') onTitleBlur(); }}
            className={styles.titleInput}
          />
        ) : (
          <span className={styles.title} onClick={onTitleClick} title="Click to rename">
            {title}
          </span>
        )}
      </div>

      {/* Right: arrange, save, comments, presence */}
      <div className={styles.right}>
        {/* Alignment tools (visible when shapes selected) */}
        {hasMultiSelection && (
          <>
            <button className={styles.toolBtn} onClick={() => onAlign('left')} title="Align left"><AlignLeft size={15} /></button>
            <button className={styles.toolBtn} onClick={() => onAlign('center-h')} title="Align center"><AlignCenter size={15} /></button>
            <button className={styles.toolBtn} onClick={() => onAlign('right')} title="Align right"><AlignRight size={15} /></button>
            <button className={styles.toolBtn} onClick={() => onAlign('top')} title="Align top"><AlignStartVertical size={15} /></button>
            <button className={styles.toolBtn} onClick={() => onAlign('center-v')} title="Align middle"><AlignCenterVertical size={15} /></button>
            <button className={styles.toolBtn} onClick={() => onAlign('bottom')} title="Align bottom"><AlignEndVertical size={15} /></button>
            <div className={styles.divider} />
          </>
        )}

        {/* Layer order (visible when shapes selected) */}
        {hasSelection && (
          <>
            <button className={styles.toolBtn} onClick={onBringToFront} title="Bring to front"><ArrowUpToLine size={15} /></button>
            <button className={styles.toolBtn} onClick={onBringForward} title="Bring forward"><ChevronUp size={15} /></button>
            <button className={styles.toolBtn} onClick={onSendBackward} title="Send backward"><ChevronDown size={15} /></button>
            <button className={styles.toolBtn} onClick={onSendToBack} title="Send to back"><ArrowDownToLine size={15} /></button>
            <div className={styles.divider} />
          </>
        )}

        {/* Phase 5 — Layout */}
        <div className={styles.layoutMenu}>
          <button
            className={`${styles.toolBtn} ${showLayoutMenu ? styles.active : ''}`}
            onClick={() => setShowLayoutMenu((v) => !v)}
            title="Auto layout"
          >
            <Network size={15} />
          </button>
          {showLayoutMenu && (
            <div className={styles.dropdown}>
              {([
                ['hierarchical', 'Hierarchical (top-down)'],
                ['flow',         'Flow (left-to-right)'],
                ['force',        'Force-directed'],
                ['grid',         'Grid'],
              ] as [LayoutAlgorithm, string][]).map(([alg, label]) => (
                <button
                  key={alg}
                  className={styles.dropdownItem}
                  onClick={() => { onRunLayout(alg); setShowLayoutMenu(false); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Presence */}
        {presenceBar}

        <div className={styles.divider} />

        {/* Phase 6 — Data panel */}
        <button
          className={`${styles.toolBtn} ${showData ? styles.active : ''}`}
          onClick={onToggleData}
          title="Data panel"
        >
          <Database size={15} />
        </button>

        {/* Phase 8 — Developer panel */}
        <button
          className={`${styles.toolBtn} ${showDeveloper ? styles.active : ''}`}
          onClick={onToggleDeveloper}
          title="Developer panel"
        >
          <Code2 size={15} />
        </button>

        {/* Phase 10 — AI panel */}
        <button
          className={`${styles.toolBtn} ${showAi ? styles.active : ''}`}
          onClick={onToggleAi}
          title="AI Diagrams"
        >
          <Sparkles size={15} />
        </button>

        <button
          className={`${styles.toolBtn} ${showComments ? styles.active : ''}`}
          onClick={onToggleComments}
          title="Comments"
        >
          <MessageSquare size={16} />
        </button>

        {/* Phase 4 — Presentation mode */}
        <button
          className={styles.toolBtn}
          onClick={onPresentation}
          title="Presentation mode"
        >
          <Presentation size={15} />
        </button>

        {/* Phase 7 — Import / Export */}
        <button className={styles.toolBtn} onClick={onImport} title="Import diagram">
          <Upload size={15} />
        </button>
        <button className={styles.toolBtn} onClick={onExport} title="Export diagram">
          <Download size={15} />
        </button>

        <button
          className={styles.saveBtn}
          onClick={onSave}
          disabled={isSaving}
          title="Save (⌘S)"
        >
          <Save size={14} />
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
