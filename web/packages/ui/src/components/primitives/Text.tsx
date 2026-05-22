import React from 'react';
import styles from './Text.module.css';

export type TextSize = 'xs' | 'sm' | 'base' | 'lg' | 'xl';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold';
export type TextColor = 'primary' | 'secondary' | 'muted' | 'accent' | 'success' | 'warning' | 'error';
export type TextLeading = 'tight' | 'normal' | 'relaxed';
export type TextAs = 'p' | 'span' | 'div' | 'label' | 'small' | 'strong' | 'em' | 'li';

export interface TextProps {
  as?: TextAs;
  size?: TextSize;
  weight?: TextWeight;
  color?: TextColor;
  leading?: TextLeading;
  truncate?: boolean;
  mono?: boolean;
  className?: string;
  children?: React.ReactNode;
  id?: string;
  htmlFor?: string;
}

export function Text({
  as: Tag = 'p',
  size = 'base',
  weight = 'normal',
  color = 'primary',
  leading = 'normal',
  truncate = false,
  mono = false,
  className = '',
  children,
  ...props
}: TextProps) {
  const classes = [
    styles.text,
    styles[size],
    styles[weight],
    styles[color],
    leading === 'normal' ? styles['normal-leading'] : styles[leading],
    truncate ? styles.truncate : '',
    mono ? styles.mono : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={classes} {...(props as React.HTMLAttributes<HTMLElement>)}>
      {children}
    </Tag>
  );
}
