import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { FolderOpen } from 'lucide-react';
import styles from './EmptyState.module.css';

export type EmptyStateSize = 'sm' | 'md';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  size?: EmptyStateSize;
  className?: string;
}

export function EmptyState({
  icon: IconComponent = FolderOpen,
  title,
  description,
  action,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  const classes = [styles.empty, size === 'sm' ? styles.sm : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="status">
      <div className={styles['icon-wrapper']} aria-hidden="true">
        <IconComponent size={size === 'sm' ? 24 : 32} strokeWidth={1.5} />
      </div>
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
