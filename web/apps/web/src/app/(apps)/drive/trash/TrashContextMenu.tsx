'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import styles from '../FileContextMenu.module.css';

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
}

/**
 * The two things you can do to a trashed item. Trash rows use the same
 * `FileGrid` as the rest of Drive, so the actions live behind the row's
 * three-dot button rather than as inline buttons.
 */
export function TrashContextMenu({ x, y, onClose, onRestore, onDeleteForever }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

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

  // After first render, measure actual dimensions and clamp within viewport.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - width - 4);
    const clampedY = Math.min(y, window.innerHeight - height - 4);
    setPos({ x: Math.max(4, clampedX), y: Math.max(4, clampedY) });
  }, [x, y]);

  const items = [
    { icon: <RotateCcw size={14} />, label: 'Restore', action: onRestore, danger: false },
    { icon: <Trash2 size={14} />, label: 'Delete forever', action: onDeleteForever, danger: true },
  ];

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      aria-label="Trash item options"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={[styles.item, item.danger ? styles.danger : ''].filter(Boolean).join(' ')}
          role="menuitem"
          onClick={() => {
            item.action();
            onClose();
          }}
        >
          <span className={styles.itemIcon}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
