'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { scaleIn, fadeIn } from '../../motion/variants';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
  className = '',
  children,
}: ModalProps) {
  const firstFocusableRef = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus trap
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable && focusable.length > 0) {
      focusable[0].focus();
      firstFocusableRef.current = focusable[0];
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!modalRef.current) return;

      if (e.key === 'Escape' && closeOnEsc) {
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusableEls = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const first = focusableEls[0];
        const last = focusableEls[focusableEls.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previouslyFocused?.focus();
    };
  }, [open, closeOnEsc, onClose]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          onClick={closeOnBackdrop ? onClose : undefined}
          aria-modal="true"
          role="dialog"
          {...fadeIn}
        >
          <motion.div
            ref={modalRef}
            className={[styles.modal, styles[size], className].filter(Boolean).join(' ')}
            onClick={(e) => e.stopPropagation()}
            {...scaleIn}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export interface ModalHeaderProps {
  title?: string;
  onClose?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function ModalHeader({ title, onClose, className = '', children }: ModalHeaderProps) {
  return (
    <div className={[styles.header, className].filter(Boolean).join(' ')}>
      <h2 className={styles.title}>{children ?? title}</h2>
      {onClose && (
        <button
          type="button"
          className={styles['close-btn']}
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

export interface ModalBodyProps {
  className?: string;
  children?: React.ReactNode;
}

export function ModalBody({ className = '', children }: ModalBodyProps) {
  return (
    <div className={[styles.body, className].filter(Boolean).join(' ')}>{children}</div>
  );
}

export interface ModalFooterProps {
  className?: string;
  children?: React.ReactNode;
}

export function ModalFooter({ className = '', children }: ModalFooterProps) {
  return (
    <div className={[styles.footer, className].filter(Boolean).join(' ')}>{children}</div>
  );
}
