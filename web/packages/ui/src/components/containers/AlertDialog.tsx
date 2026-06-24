'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { scaleIn, fadeIn } from '../../motion/variants';
import { Button } from '../primitives/Button';
import type { ButtonVariant } from '../primitives/Button';
import styles from './AlertDialog.module.css';

export type AlertDialogVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  variant?: AlertDialogVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  loading?: boolean;
  className?: string;
}

const ICONS: Record<AlertDialogVariant, React.FC<{ size: number; className: string }>> = {
  info: (p) => <Info {...p} />,
  success: (p) => <CheckCircle {...p} />,
  warning: (p) => <AlertTriangle {...p} />,
  error: (p) => <AlertCircle {...p} />,
};

const CONFIRM_VARIANT: Record<AlertDialogVariant, ButtonVariant> = {
  info: 'primary',
  success: 'primary',
  warning: 'primary',
  error: 'danger',
};

export function AlertDialog({
  open,
  onClose,
  title,
  description,
  variant = 'info',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  loading = false,
  className = '',
}: AlertDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const AlertIcon = ICONS[variant];

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!dialogRef.current) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusableEls = dialogRef.current.querySelectorAll<HTMLElement>(
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
  }, [open, onClose]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          onClick={onClose}
          aria-modal="true"
          role="alertdialog"
          aria-labelledby="alert-dialog-title"
          aria-describedby={description ? 'alert-dialog-description' : undefined}
          {...fadeIn}
        >
          <motion.div
            ref={dialogRef}
            className={[styles.dialog, className].filter(Boolean).join(' ')}
            onClick={(e) => e.stopPropagation()}
            {...scaleIn}
          >
            <button
              type="button"
              className={styles['close-btn']}
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>

            <div className={[styles['icon-wrapper'], styles[variant]].join(' ')} aria-hidden="true">
              <AlertIcon size={28} className={styles.icon} />
            </div>

            <h2 id="alert-dialog-title" className={styles.title}>
              {title}
            </h2>

            {description && (
              <p id="alert-dialog-description" className={styles.description}>
                {description}
              </p>
            )}

            <div className={styles.footer}>
              {cancelLabel && (
                <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
                  {cancelLabel}
                </Button>
              )}
              {onConfirm && (
                <Button
                  variant={CONFIRM_VARIANT[variant]}
                  size="sm"
                  onClick={onConfirm}
                  loading={loading}
                >
                  {confirmLabel}
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
