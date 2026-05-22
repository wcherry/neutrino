'use client';

import React from 'react';
import { AlertCircle, CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import styles from './Alert.module.css';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  message: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

const ICONS: Record<AlertVariant, React.FC<{ size: number }>> = {
  info: (p) => <Info {...p} />,
  success: (p) => <CheckCircle {...p} />,
  warning: (p) => <AlertTriangle {...p} />,
  error: (p) => <AlertCircle {...p} />,
};

const ROLE: Record<AlertVariant, string> = {
  info: 'status',
  success: 'status',
  warning: 'alert',
  error: 'alert',
};

export function Alert({
  variant = 'info',
  title,
  message,
  onClose,
  className = '',
}: AlertProps) {
  const AlertIcon = ICONS[variant];

  const classes = [styles.alert, styles[variant], className].filter(Boolean).join(' ');

  return (
    <div className={classes} role={ROLE[variant]} aria-live={variant === 'error' || variant === 'warning' ? 'assertive' : 'polite'}>
      <span className={styles['icon-wrapper']} aria-hidden="true">
        <AlertIcon size={18} />
      </span>
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        <div className={styles.message}>{message}</div>
      </div>
      {onClose && (
        <button
          type="button"
          className={styles['close-btn']}
          onClick={onClose}
          aria-label="Dismiss alert"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
