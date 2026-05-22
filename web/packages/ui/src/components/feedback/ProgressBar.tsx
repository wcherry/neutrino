import React from 'react';
import styles from './ProgressBar.module.css';

export type ProgressBarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type ProgressBarColor = 'accent' | 'success' | 'warning' | 'error' | 'info';

export interface ProgressBarProps {
  value?: number;
  max?: number;
  size?: ProgressBarSize;
  color?: ProgressBarColor;
  label?: string;
  showValue?: boolean;
  indeterminate?: boolean;
  className?: string;
}

export function ProgressBar({
  value = 0,
  max = 100,
  size = 'md',
  color = 'accent',
  label,
  showValue = false,
  indeterminate = false,
  className = '',
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const wrapperClasses = [styles.wrapper, className].filter(Boolean).join(' ');

  const trackClasses = [
    styles.track,
    styles[size],
    styles[color],
    indeterminate ? styles.indeterminate : '',
  ]
    .filter(Boolean)
    .join(' ');

  const displayValue = showValue
    ? `${Math.round(percentage)}%`
    : undefined;

  return (
    <div className={wrapperClasses}>
      {(label || showValue) && (
        <div className={styles.header}>
          {label && <span className={styles.label}>{label}</span>}
          {displayValue && (
            <span className={styles.value} aria-hidden="true">
              {displayValue}
            </span>
          )}
        </div>
      )}
      <div
        className={trackClasses}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        aria-busy={indeterminate}
      >
        <div
          className={styles.bar}
          style={indeterminate ? undefined : { width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
