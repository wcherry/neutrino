'use client';

import React, { useEffect, useRef } from 'react';
import { Pencil, Pin, PinOff, Star, StarOff, FolderInput, Trash2 } from 'lucide-react';
import { type Folder as FolderItem } from '@/lib/api';
import { useDismiss } from '@neutrino/commands';
import { usePreference } from '@neutrino/preferences';
import { MAX_PINS, pinFolder, readLayout, unpinFolder } from '@/lib/sidebarLayout';
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
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose]);

  useDismiss(() => onClose());

  // Pinned to the sidebar (U8): read live, so the label is right if another tab just pinned it.
  const [sidebarPref] = usePreference('shell.sidebar');
  const layout = readLayout(sidebarPref);
  const pinned = layout.pinned.some((p) => p.id === folder.id);
  const canPin = pinned || layout.pinned.length < MAX_PINS;

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
    ...(canPin
      ? [{
          icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
          label: pinned ? 'Unpin from sidebar' : 'Pin to sidebar',
          action: () => (pinned ? unpinFolder(folder.id) : void pinFolder({ id: folder.id, name: folder.name })),
        }]
      : []),
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
