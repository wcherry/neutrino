'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { fadeIn, drawerLeft, drawerRight, drawerBottom, slideDown } from '../../motion/variants';
import styles from './Drawer.module.css';

export type DrawerPlacement = 'left' | 'right' | 'bottom' | 'top';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  placement?: DrawerPlacement;
  title?: string;
  width?: number | string;
  height?: number | string;
  closeOnBackdrop?: boolean;
  className?: string;
  children?: React.ReactNode;
}

type DrawerCSSVars = {
  '--drawer-width'?: string;
  '--drawer-height'?: string;
};

const VARIANTS = {
  left: drawerLeft,
  right: drawerRight,
  bottom: drawerBottom,
  top: slideDown,
};

export function Drawer({
  open,
  onClose,
  placement = 'right',
  title,
  width,
  height,
  closeOnBackdrop = true,
  className = '',
  children,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (typeof window === 'undefined') return null;

  const style: React.CSSProperties & DrawerCSSVars = {};
  if (width) style['--drawer-width'] = typeof width === 'number' ? `${width}px` : width;
  if (height) style['--drawer-height'] = typeof height === 'number' ? `${height}px` : height;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={styles.backdrop}
            onClick={closeOnBackdrop ? onClose : undefined}
            aria-hidden="true"
            {...fadeIn}
          />
          <motion.div
            className={[styles.drawer, styles[placement], className].filter(Boolean).join(' ')}
            style={style}
            role="dialog"
            aria-modal="true"
            {...VARIANTS[placement]}
          >
            {title && (
              <div className={styles.header}>
                <h2 className={styles.title}>{title}</h2>
                <button
                  type="button"
                  className={styles['close-btn']}
                  onClick={onClose}
                  aria-label="Close drawer"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            <div className={styles.body}>{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
