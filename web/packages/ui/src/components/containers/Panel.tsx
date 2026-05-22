import React from 'react';
import styles from './Panel.module.css';

export type PanelColor = 'default' | 'accent' | 'success' | 'warning' | 'error';
export type PanelPadding = 'sm' | 'md' | 'lg';

export interface PanelProps {
  color?: PanelColor;
  padding?: PanelPadding;
  className?: string;
  children?: React.ReactNode;
}

export function Panel({
  color = 'default',
  padding = 'md',
  className = '',
  children,
}: PanelProps) {
  const classes = [styles.panel, styles[color], styles[padding], className]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
}
