import React from 'react';
import styles from './Card.module.css';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type CardShadow = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps {
  padding?: CardPadding;
  shadow?: CardShadow;
  hoverable?: boolean;
  selected?: boolean;
  className?: string;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
}

export function Card({
  padding = 'md',
  shadow = 'none',
  hoverable = false,
  selected = false,
  className = '',
  children,
  onClick,
  onKeyDown,
  ...props
}: CardProps) {
  const classes = [
    styles.card,
    styles[padding],
    styles[`shadow-${shadow}`],
    hoverable ? styles.hoverable : '',
    selected ? styles.selected : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} onClick={onClick} onKeyDown={onKeyDown} {...props}>
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function CardHeader({ title, subtitle, action, className = '', children }: CardHeaderProps) {
  return (
    <div
      className={[styles.header, className].filter(Boolean).join(' ')}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
    >
      <div>
        {children ?? (
          <>
            {title && <p className={styles.title}>{title}</p>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export interface CardFooterProps {
  className?: string;
  children: React.ReactNode;
}

export function CardFooter({ className = '', children }: CardFooterProps) {
  return (
    <div className={[styles.footer, className].filter(Boolean).join(' ')}>{children}</div>
  );
}
