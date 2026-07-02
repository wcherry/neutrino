'use client';

import React, { useState } from 'react';
import { Plus, X, Maximize2 } from 'lucide-react';
import { ZoomSlider } from '@neutrino/ui';
import type { DiagramPage } from '../types';
import styles from './PagePanel.module.css';

interface PagePanelProps {
  pages: DiagramPage[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: (pageId: string) => void;
  onRename: (pageId: string, name: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitToScreen: () => void;
}

export function PagePanel({
  pages,
  activeIndex,
  onSelect,
  onAdd,
  onRemove,
  onRename,
  zoom,
  onZoomChange,
  onFitToScreen,
}: PagePanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const startEdit = (page: DiagramPage) => {
    setEditingId(page.id);
    setEditingName(page.name);
  };

  const commitEdit = () => {
    if (editingId && editingName.trim()) {
      onRename(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.pageList}>
      {pages.map((page, i) => (
        <div
          key={page.id}
          className={`${styles.tab} ${i === activeIndex ? styles.active : ''}`}
          onClick={() => onSelect(i)}
          onDoubleClick={() => startEdit(page)}
        >
          {editingId === page.id ? (
            <input
              autoFocus
              value={editingName}
              className={styles.nameInput}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className={styles.name}>{page.name}</span>
          )}
          {pages.length > 1 && (
            <button
              className={styles.removeBtn}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(page.id);
              }}
              title="Remove page"
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      <button className={styles.addBtn} onClick={onAdd} title="Add page">
        <Plus size={14} />
      </button>
      </div>
      <div className={styles.zoomArea}>
        <div className={styles.zoomDivider} />
        <button
          className={styles.fitBtn}
          onClick={onFitToScreen}
          title="Fit to screen"
          aria-label="Fit to screen"
        >
          <Maximize2 size={13} />
        </button>
        <ZoomSlider
          value={Math.min(400, Math.max(25, Math.round(zoom)))}
          onChange={onZoomChange}
          min={25}
          max={400}
          step={25}
        />
      </div>
    </div>
  );
}
