'use client';

import React, { useEffect, useRef } from 'react';
import { Pencil, Star, StarOff, FolderInput, Trash2 } from 'lucide-react';
import { type Folder as FolderItem } from '@/lib/api';
import styles from './FileContextMenu.module.css';

interface Props {
  folder: FolderItem;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onStarToggle: () => void;
  onMove: () => void;
  onDelete: () => void;
}

export function FolderContextMenu({ folder, x, y, onClose, onRename, onStarToggle, onMove, onDelete }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  const items = [
    { icon: <Pencil size={14} />, label: 'Rename', action: onRename },
    {
      icon: folder.isStarred ? <StarOff size={14} /> : <Star size={14} />,
      label: folder.isStarred ? 'Remove star' : 'Star',
      action: onStarToggle,
    },
    { icon: <FolderInput size={14} />, label: 'Move to', action: onMove },
    null,
    { icon: <Trash2 size={14} />, label: 'Delete', action: onDelete, danger: true },
  ] as const;

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: adjustedX, top: adjustedY }}
      role="menu"
      aria-label="Folder options"
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={i} className={styles.separator} role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            className={[styles.item, 'danger' in item && item.danger ? styles.danger : '']
              .filter(Boolean)
              .join(' ')}
            role="menuitem"
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            <span className={styles.itemIcon}>{item.icon}</span>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
