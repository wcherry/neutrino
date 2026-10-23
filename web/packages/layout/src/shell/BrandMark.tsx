'use client';

import React from 'react';
import Link from 'next/link';
import styles from './BrandMark.module.css';

/**
 * The instance's brand as the shell draws it — set by an administrator (customization roadmap
 * §6.1). Absent fields are Neutrino's own.
 */
export interface ShellBrand {
  name?: string;
}

/** Neutrino's mark: a nucleus and one orbit. */
function NeutrinoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-30 12 12)" />
    </svg>
  );
}

export interface BrandMarkProps {
  brand?: ShellBrand;
  href: string;
  /** The collapsed rail shows the mark alone. */
  compact?: boolean;
}

/**
 * The `data-brand` attributes are for the server's CSS (`src/branding/inject.rs`): an uploaded logo
 * is drawn over `data-brand="logo"` in place of the mark, and the name beside it hidden, since a
 * logo carries its own wordmark.
 */
export function BrandMark({ brand, href, compact = false }: BrandMarkProps) {
  const name = brand?.name || 'Neutrino';
  return (
    <Link className={styles.brand} href={href} aria-label={`${name} home`} title={compact ? name : undefined}>
      <span className={styles.mark} data-brand="logo">
        <NeutrinoMark />
      </span>
      {!compact && <span className={styles.name} data-brand="name">{name}</span>}
    </Link>
  );
}
