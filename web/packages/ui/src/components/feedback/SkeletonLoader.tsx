import React from 'react';
import styles from './SkeletonLoader.module.css';

export type SkeletonShape = 'text' | 'circle' | 'rect' | 'rounded';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  shape?: SkeletonShape;
  className?: string;
}

export function Skeleton({
  width,
  height,
  shape = 'rect',
  className = '',
}: SkeletonProps) {
  const classes = [styles.skeleton, styles[shape], className].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      style={{
        width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : '100%',
        height:
          height !== undefined
            ? typeof height === 'number'
              ? `${height}px`
              : height
            : shape === 'text'
            ? '1em'
            : '2rem',
        display: 'block',
      }}
      aria-hidden="true"
    />
  );
}

export interface FileListSkeletonProps {
  rows?: number;
}

export function FileListSkeleton({ rows = 5 }: FileListSkeletonProps) {
  return (
    <div className={styles.group} role="status" aria-label="Loading files...">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles['row-group']}>
          <Skeleton shape="rect" width={32} height={32} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <Skeleton shape="text" width="60%" height="0.875rem" />
            <Skeleton shape="text" width="40%" height="0.75rem" />
          </div>
          <Skeleton shape="text" width={60} height="0.75rem" />
        </div>
      ))}
    </div>
  );
}
