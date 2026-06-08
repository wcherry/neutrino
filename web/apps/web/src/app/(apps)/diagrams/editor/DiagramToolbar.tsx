'use client';

import React from 'react';
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
} from 'lucide-react';
import type { EditorSelection, SelectionMode } from '../types';
import type { AlignDirection } from './utils/shapeUtils';
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
  selection: EditorSelection;
  onAlign: (dir: AlignDirection) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  presenceBar: React.ReactNode;
}

export function DiagramToolbar({
  title, titleEditing, onTitleClick, onTitleChange, onTitleBlur,
  mode, onModeChange,
  canUndo, canRedo, onUndo, onRedo,
  onSave, isSaving,
  onToggleComments, showComments,
  selection,
  onAlign, onDistribute,
  onBringForward, onSendBackward, onBringToFront, onSendToBack,
  presenceBar,
}: DiagramToolbarProps) {
  const hasSelection = selection.shapeIds.size > 0;
  const hasMultiSelection = selection.shapeIds.size >= 2;

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

        {/* Presence */}
        {presenceBar}

        <div className={styles.divider} />

        <button
          className={`${styles.toolBtn} ${showComments ? styles.active : ''}`}
          onClick={onToggleComments}
          title="Comments"
        >
          <MessageSquare size={16} />
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
