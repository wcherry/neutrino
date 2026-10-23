'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismiss } from '@neutrino/commands';
import { usePresence, type MotionName } from '../../motion/presence';
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

const MOTION: Record<DrawerPlacement, MotionName> = {
  left: 'drawer-left',
  right: 'drawer-right',
  bottom: 'drawer-bottom',
  top: 'drop',
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
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useDismiss(onClose, open);
  const { mounted, state } = usePresence(open);

  if (typeof window === 'undefined' || !mounted) return null;

  const style: React.CSSProperties & DrawerCSSVars = {};
  if (width) style['--drawer-width'] = typeof width === 'number' ? `${width}px` : width;
  if (height) style['--drawer-height'] = typeof height === 'number' ? `${height}px` : height;

  return createPortal(
    <>
      <div
        className={styles.backdrop}
        onClick={closeOnBackdrop && open ? onClose : undefined}
        aria-hidden="true"
        data-motion="fade"
        data-state={state}
      />
      <div
        className={[styles.drawer, styles[placement], className].filter(Boolean).join(' ')}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-hidden={open ? undefined : true}
        data-motion={MOTION[placement]}
        data-state={state}
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
      </div>
    </>,
    document.body
  );
}
