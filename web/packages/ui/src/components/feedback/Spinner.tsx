import React from 'react';
import styles from './Spinner.module.css';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerColor = 'accent' | 'white' | 'muted' | 'success' | 'error';

export interface SpinnerProps {
  size?: SpinnerSize;
  color?: SpinnerColor;
  label?: string;
  overlay?: boolean;
  className?: string;
}

export function Spinner({
  size = 'md',
  color = 'accent',
  label = 'Loading...',
  overlay = false,
  className = '',
}: SpinnerProps) {
  const inner = (
    <div
      className={[styles.spinner, styles[size], styles[color], className].filter(Boolean).join(' ')}
      role="status"
      aria-label={label}
    >
      <div className={styles.ring} aria-hidden="true" />
      <span className="u-sr-only">{label}</span>
    </div>
  );

  if (overlay) {
    return <div className={styles.overlay}>{inner}</div>;
  }

  return inner;
}
