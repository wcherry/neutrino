import React from 'react';
import styles from './Chip.module.css';

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Whether the chip is on — a filter that applies, a toggle that is set. */
  selected?: boolean;
  icon?: React.ReactNode;
  /** A trailing count, in the mono numerals the look-and-feel roadmap uses for figures. */
  count?: number;
  children: React.ReactNode;
}

/**
 * A pill that filters or toggles, such as Drive's file-type filters. Announced as a toggle button
 * (`aria-pressed`). Every value is a look token (`--chip-*` in packages/tokens/src/looks.css).
 */
export function Chip({ selected = false, icon, count, className = '', type = 'button', children, ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={[styles.chip, selected ? styles.selected : '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon && <span className={styles.icon} aria-hidden>{icon}</span>}
      <span>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
