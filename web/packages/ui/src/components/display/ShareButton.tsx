'use client';

import React from 'react';
import { Share2 } from 'lucide-react';
import { Avatar } from '../primitives/Avatar';
import styles from './ShareButton.module.css';

export interface ShareUser {
  name: string;
  src?: string;
  /** When true, renders a ring to indicate this person is the active writer. */
  isWriter?: boolean;
}

export interface ShareButtonProps {
  users?: ShareUser[];
  onShare?: () => void;
  className?: string;
  'aria-label'?: string;
}

const MAX_VISIBLE = 3;

export function ShareButton({
  users = [],
  onShare,
  className = '',
  'aria-label': ariaLabel = 'Share',
}: ShareButtonProps) {
  const hasOverflow = users.length > MAX_VISIBLE;
  const visibleUsers = hasOverflow ? users.slice(0, 2) : users;
  const overflowCount = hasOverflow ? users.length - 2 : 0;

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {users.length > 0 && (
        <div className={styles.avatarStack} aria-label={`${users.length} people have access`}>
          {visibleUsers.map((user, i) => (
            <div
              key={i}
              className={[styles.avatarRing, user.isWriter ? styles.writerRing : ''].filter(Boolean).join(' ')}
              title={user.name}
            >
              <Avatar name={user.name} src={user.src} size="sm" />
            </div>
          ))}
          {hasOverflow && (
            <div className={styles.avatarRing}>
              <div className={styles.overflow} aria-label={`${overflowCount} more`}>
                +{overflowCount}
              </div>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className={styles.shareBtn}
        onClick={onShare}
        aria-label={ariaLabel}
      >
        <Share2 size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
