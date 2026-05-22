import React from 'react';
import styles from './Link.module.css';

export type LinkVariant = 'default' | 'subtle' | 'muted';

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: LinkVariant;
  underline?: boolean;
  external?: boolean;
}

export function Link({
  variant = 'default',
  underline = true,
  external = false,
  className = '',
  children,
  ...props
}: LinkProps) {
  const classes = [
    styles.link,
    variant !== 'default' ? styles[variant] : '',
    !underline ? styles['no-underline'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const externalProps = external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <a className={classes} {...externalProps} {...props}>
      {children}
    </a>
  );
}
