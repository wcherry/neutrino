'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Globe, Trash2 } from 'lucide-react';
import styles from './ThemeContextMenu.module.css';

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  onDuplicate: () => void;
  /** Present only when the menu should offer "Make public" — i.e. the
   *  subject is a private custom theme (see ThemeGrid's per-kind wiring). */
  onMakePublic?: () => void;
  /** Present only when the menu should offer Delete — i.e. the subject is a
   *  private custom theme (always the caller's own, per the API's visibility
   *  rules). Absent for built-in presets and public custom themes. */
  onDelete?: () => void;
}

export function ThemeContextMenu({ x, y, onClose, onDuplicate, onMakePublic, onDelete }: Props) {
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

  // No standalone "Edit" item, intentionally: the only path into
  // ThemeEditorModal's edit mode is via Duplicate, which opens the editor on
  // the fresh copy. Revisit if a direct-edit entry point is ever wanted.
  const items = [
    { icon: <Copy size={14} />, label: 'Duplicate', action: onDuplicate },
    ...(onMakePublic ? [{ icon: <Globe size={14} />, label: 'Make public', action: onMakePublic }] : []),
    ...(onDelete
      ? [null, { icon: <Trash2 size={14} />, label: 'Delete', action: onDelete, danger: true }]
      : []),
  ] as const;

  return (
    <div ref={ref} className={styles.menu} style={{ left: pos.x, top: pos.y }} role="menu" aria-label="Theme options">
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
