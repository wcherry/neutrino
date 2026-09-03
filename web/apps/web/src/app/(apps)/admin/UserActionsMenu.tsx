'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './UserActionsMenu.module.css';

export interface UserActionItem {
  /** Rendered label; also the accessible name of the item. */
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Hover text, used to say why an item is disabled or what it will do. */
  title?: string;
}

/** A rule between two groups of items. */
export const MENU_SEPARATOR = null;

export type UserActionEntry = UserActionItem | typeof MENU_SEPARATOR;

interface Props {
  x: number;
  y: number;
  entries: UserActionEntry[];
  onClose: () => void;
  'aria-label': string;
}

/**
 * The actions for one row of the Users table, behind the row's three-dot
 * button. A row has up to six of them and every one is a different rule about
 * a different account state, which as inline buttons wrapped the column into
 * something unreadable.
 */
export function UserActionsMenu({ x, y, entries, onClose, 'aria-label': ariaLabel }: Props) {
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

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      aria-label={ariaLabel}
    >
      {entries.map((entry, i) =>
        entry === MENU_SEPARATOR ? (
          <div key={`sep-${i}`} className={styles.separator} role="separator" />
        ) : (
          <button
            key={entry.label}
            type="button"
            className={[styles.item, entry.danger ? styles.danger : ''].filter(Boolean).join(' ')}
            role="menuitem"
            disabled={entry.disabled}
            title={entry.title}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
          >
            <span className={styles.itemIcon}>{entry.icon}</span>
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}
