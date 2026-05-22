import React from 'react';
import styles from './Heading.module.css';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingSize = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
export type HeadingColor = 'primary' | 'secondary' | 'muted';
export type HeadingWeight = 'normal' | 'medium' | 'semibold' | 'bold';

export interface HeadingProps {
  level?: HeadingLevel;
  size?: HeadingSize;
  color?: HeadingColor;
  weight?: HeadingWeight;
  className?: string;
  children?: React.ReactNode;
  id?: string;
}

export function Heading({
  level = 2,
  size,
  color = 'primary',
  weight,
  className = '',
  children,
  id,
}: HeadingProps) {
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;

  const classes = [
    styles.heading,
    styles[`h${level}`],
    size ? styles[`size-${size}`] : '',
    styles[color],
    weight ? styles[weight] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={classes} id={id}>
      {children}
    </Tag>
  );
}
