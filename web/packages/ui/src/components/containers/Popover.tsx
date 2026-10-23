'use client';

import React, { useRef, useEffect, useId } from 'react';
import { useDismiss } from '@neutrino/commands';
import { usePresence } from '../../motion/presence';
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

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose]);

  useDismiss(onClose, open);
  const { mounted, state } = usePresence(open);

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
      {mounted && (
        <div
          id={id}
          className={contentClasses}
          role="dialog"
          aria-modal="false"
          aria-hidden={open ? undefined : true}
          data-motion="scale"
          data-state={state}
        >
          {children}
        </div>
      )}
    </div>
  );
}
