'use client';

import React, { useRef, useEffect, useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { scaleIn } from '../../motion/variants';
import styles from './Popover.module.css';

export type PopoverPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  placement?: PopoverPlacement;
  className?: string;
}

export function Popover({
  open,
  onClose,
  trigger,
  children,
  placement = 'bottom-start',
  className = '',
}: PopoverProps) {
  const id = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const placementClass = placement.replace('-', '-');

  const contentClasses = [
    styles.content,
    styles[placement],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <div aria-expanded={open} aria-controls={open ? id : undefined}>
        {trigger}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            className={contentClasses}
            role="dialog"
            aria-modal="false"
            {...scaleIn}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
