import React from 'react';
import styles from './Divider.module.css';

export type DividerOrientation = 'horizontal' | 'vertical';
export type DividerSpacing = 'sm' | 'md' | 'lg' | 'xl';

export interface DividerProps {
  orientation?: DividerOrientation;
  spacing?: DividerSpacing;
  label?: string;
  className?: string;
}

export function Divider({
  orientation = 'horizontal',
  spacing = 'md',
  label,
  className = '',
}: DividerProps) {
  if (label) {
    return (
      <div className={[styles.labeled, className].filter(Boolean).join(' ')} role="separator">
        <span className={styles['label-text']}>{label}</span>
      </div>
    );
  }

  const classes = [
    styles.divider,
    styles[orientation],
    orientation === 'horizontal' ? styles[`spacing-${spacing}`] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <hr
      className={classes}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
