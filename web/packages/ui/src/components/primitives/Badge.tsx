import React from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'error' | 'info';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  className = '',
  children,
}: BadgeProps) {
  const classes = [
    styles.badge,
    styles[variant],
    styles[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
