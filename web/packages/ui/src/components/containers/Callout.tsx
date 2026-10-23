import React from 'react';
import styles from './Callout.module.css';

/** A tinted box that sets content apart — a note, a warning, a summary. Not an app panel: see `Panel`. */

export type CalloutColor = 'default' | 'accent' | 'success' | 'warning' | 'error';
export type CalloutPadding = 'sm' | 'md' | 'lg';

export interface CalloutProps {
  color?: CalloutColor;
  padding?: CalloutPadding;
  className?: string;
  children?: React.ReactNode;
}

export function Callout({
  color = 'default',
  padding = 'md',
  className = '',
  children,
}: CalloutProps) {
  const classes = [styles.callout, styles[color], styles[padding], className]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
}
