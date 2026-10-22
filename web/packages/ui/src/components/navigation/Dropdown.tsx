'use client';

import React, { useRef, useEffect, useId } from 'react';
import { useDismiss } from '@neutrino/commands';
import { usePresence } from '../../motion/presence';
import { Menu } from './Menu';
import type { MenuItemDef } from './Menu';
import styles from './Dropdown.module.css';

export type DropdownPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'bottom';

export interface DropdownProps {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  items?: MenuItemDef[];
  placement?: DropdownPlacement;
  className?: string;
  children?: React.ReactNode;
}

export function Dropdown({
  open,
  onClose,
  trigger,
  items,
  placement = 'bottom-start',
  className = '',
  children,
}: DropdownProps) {
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose]);

  useDismiss(onClose, open);
  const { mounted, state } = usePresence(open);

  const contentClasses = [styles.content, styles[placement], className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <div
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        {trigger}
      </div>
      {mounted && (
        <div
          id={menuId}
          className={contentClasses}
          aria-hidden={open ? undefined : true}
          data-motion="rise"
          data-state={state}
        >
          {children ?? (items && <Menu items={items} />)}
        </div>
      )}
    </div>
  );
}
