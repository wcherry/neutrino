'use client';

import React from 'react';
import styles from './Menu.module.css';

export interface MenuItemDef {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}

export interface MenuProps {
  items?: MenuItemDef[];
  className?: string;
  children?: React.ReactNode;
  'aria-label'?: string;
}

export function Menu({ items, className = '', children, 'aria-label': ariaLabel }: MenuProps) {
  return (
    <div
      className={[styles.menu, className].filter(Boolean).join(' ')}
      role="menu"
      aria-label={ariaLabel}
    >
      {children ??
        items?.map((item) => <MenuItem key={item.id} {...item} />)}
    </div>
  );
}

export interface MenuItemProps extends MenuItemDef {}

export function MenuItem({
  label,
  icon,
  shortcut,
  disabled = false,
  danger = false,
  active = false,
  href,
  onClick,
}: MenuItemProps) {
  const classes = [
    styles.item,
    active ? styles.active : '',
    danger ? styles.danger : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (href) {
    return (
      <a href={href} className={classes} role="menuitem">
        {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
        <span className={styles.label}>{label}</span>
        {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
    >
      {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
      <span className={styles.label}>{label}</span>
      {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className={styles.separator} role="separator" aria-hidden="true" />;
}

export interface MenuGroupProps {
  label: string;
  children: React.ReactNode;
}

export function MenuGroup({ label, children }: MenuGroupProps) {
  return (
    <div role="group" aria-label={label}>
      <p className={styles['group-label']}>{label}</p>
      {children}
    </div>
  );
}
