'use client';

import React, { useRef, useEffect, useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { slideUp } from '../../motion/variants';
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

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
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            className={contentClasses}
            {...slideUp}
          >
            {children ?? (items && <Menu items={items} />)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
