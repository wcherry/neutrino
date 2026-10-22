'use client';

import React from 'react';
import { AlertCircle, CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import styles from './Toast.module.css';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastData {
  id: string;
  variant?: ToastVariant;
  title?: string;
  message: React.ReactNode;
  duration?: number;
}

export interface ToastProps extends ToastData {
  onClose: (id: string) => void;
  /** Dismissed and playing its exit animation; the provider removes it when that ends. */
  leaving?: boolean;
}

const ICONS: Record<ToastVariant, React.FC<{ size: number }>> = {
  info: (p) => <Info {...p} />,
  success: (p) => <CheckCircle {...p} />,
  warning: (p) => <AlertTriangle {...p} />,
  error: (p) => <AlertCircle {...p} />,
};

export function Toast({
  id,
  variant = 'info',
  title,
  message,
  duration = 4000,
  onClose,
  leaving = false,
}: ToastProps) {
  const ToastIcon = ICONS[variant];

  React.useEffect(() => {
    if (duration === Infinity) return;
    const timer = setTimeout(() => onClose(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  const classes = [styles.toast, styles[variant]].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      role="status"
      aria-live="polite"
      data-motion="toast"
      data-state={leaving ? 'closed' : 'open'}
    >
      <span className={styles['icon-wrapper']} aria-hidden="true">
        <ToastIcon size={18} />
      </span>
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        <div className={styles.message}>{message}</div>
      </div>
      <button
        type="button"
        className={styles['close-btn']}
        onClick={() => onClose(id)}
        aria-label="Close notification"
      >
        <X size={14} />
      </button>
      {duration !== Infinity && (
        <div
          className={styles['progress-bar']}
          style={{ animationDuration: `${duration}ms` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
