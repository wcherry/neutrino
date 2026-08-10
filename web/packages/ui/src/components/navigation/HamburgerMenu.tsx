'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Menu, ChevronRight } from 'lucide-react';
import styles from './HamburgerMenu.module.css';

// ── Menu item types ───────────────────────────────────────────────────────

export type HamburgerMenuItem =
  | { kind: 'action';   label: string; shortcut?: string; disabled?: boolean; danger?: boolean; action: () => void }
  | { kind: 'separator' }
  | { kind: 'submenu';  label: string; items: HamburgerMenuItem[] };

// ── Recursive panel item ──────────────────────────────────────────────────

function PanelItem({ item, onClose }: { item: HamburgerMenuItem; onClose: () => void }) {
  const [subOpen, setSubOpen] = useState(false);

  if (item.kind === 'separator') {
    return <div className={styles.sep} />;
  }

  if (item.kind === 'submenu') {
    return (
      <div
        className={`${styles.item} ${styles.hasSubmenu}`}
        onMouseEnter={() => setSubOpen(true)}
        onMouseLeave={() => setSubOpen(false)}
      >
        <span>{item.label}</span>
        <ChevronRight size={13} className={styles.submenuArrow} />
        {subOpen && (
          <div className={styles.submenuPanel}>
            {item.items.map((child, i) => (
              <PanelItem key={i} item={child} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={`${styles.item}${item.danger ? ` ${styles.danger}` : ''}`}
      disabled={item.disabled}
      // Clicking a menu item normally steals focus from whatever the user had
      // focused before opening the menu (a text field's selection, an
      // editable region). Actions like Cut/Copy/Paste/Undo/Redo/Select-all
      // need that focus and selection to still be live when `item.action()`
      // runs `document.execCommand(...)` — so keep focus exactly where it
      // was; the click still fires normally without the default focus shift.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { item.action(); onClose(); }}
    >
      <span>{item.label}</span>
      {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
    </button>
  );
}

// ── HamburgerMenu ─────────────────────────────────────────────────────────

export interface HamburgerMenuProps {
  items: HamburgerMenuItem[];
}

export function HamburgerMenu({ items }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        className={`${styles.btn}${open ? ` ${styles.btnOpen}` : ''}`}
        // See the matching comment in PanelItem — preserves whatever was
        // focused before the menu was opened, all the way through to the
        // item click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(v => !v)}
        title="Menu"
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Menu size={18} />
      </button>

      {open && (
        <div className={styles.panel} role="menu">
          {items.map((item, i) => (
            <PanelItem key={i} item={item} onClose={close} />
          ))}
        </div>
      )}
    </div>
  );
}
