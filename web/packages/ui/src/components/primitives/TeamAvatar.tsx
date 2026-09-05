import React from 'react';
import styles from './TeamAvatar.module.css';

export type TeamAvatarSize = 'xs' | 'sm' | 'md';

export interface TeamAvatarProps {
  name: string;
  /** The team's chosen colour. Absent falls back to the product accent. */
  color?: string | null;
  /** The team's chosen emoji. Absent falls back to the first letter of the name. */
  emoji?: string | null;
  size?: TeamAvatarSize;
  className?: string;
}

/**
 * A team's mark: its colour, and its emoji or first letter.
 *
 * Separate from `Avatar` rather than a variant of it, because the two are drawn to be told apart at
 * a glance — a circle is a person, a rounded square is a team — and they now appear in the same
 * lists. A team has no photograph to fall back to, which is why there is no `src`.
 */
export function TeamAvatar({
  name,
  color,
  emoji,
  size = 'sm',
  className = '',
}: TeamAvatarProps) {
  const mark = emoji || name.trim().charAt(0).toUpperCase() || '#';

  return (
    <span
      className={[styles.avatar, styles[size], className].filter(Boolean).join(' ')}
      style={{ ['--team-avatar-color' as string]: color ?? undefined }}
      role="img"
      aria-label={name}
    >
      {mark}
    </span>
  );
}
