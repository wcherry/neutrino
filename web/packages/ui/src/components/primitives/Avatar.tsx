import React from 'react';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export type AvatarStatus = 'online' | 'offline' | 'busy';

export interface AvatarProps {
  name?: string;
  src?: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  className?: string;
  alt?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function getColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 8;
}

export function Avatar({
  name = '',
  src,
  size = 'md',
  status,
  className = '',
  alt,
}: AvatarProps) {
  const colorIndex = getColorIndex(name);

  const classes = [
    styles.avatar,
    styles[size],
    !src ? styles[`color-${colorIndex}`] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      role="img"
      aria-label={alt ?? name ?? 'Avatar'}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? name ?? 'Avatar'}
          className={styles.image}
        />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {getInitials(name)}
        </span>
      )}
      {status && (
        <span
          className={[styles['status-dot'], styles[`status-${status}`]].join(' ')}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  );
}
