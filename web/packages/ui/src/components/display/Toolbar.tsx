'use client';

import React from 'react';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  children?: React.ReactNode;
  className?: string;
}

export function Toolbar({ children, className }: ToolbarProps) {
  const cls = [styles.toolbar, className].filter(Boolean).join(' ');
  return <div className={cls}>{children}</div>;
}

export interface ToolbarGroupProps {
  children?: React.ReactNode;
}

export function ToolbarGroup({ children }: ToolbarGroupProps) {
  return <div className={styles.toolbarGroup}>{children}</div>;
}

export function ToolbarDivider() {
  return <div className={styles.toolbarDivider} />;
}

export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  wide?: boolean;
}

export function ToolbarButton({ active, wide, className, ...props }: ToolbarButtonProps) {
  const base = wide ? styles.toolBtnWide : styles.toolBtn;
  const cls = [base, active ? styles.active : '', className].filter(Boolean).join(' ');
  return <button className={cls} {...props} />;
}

export type ToolbarSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function ToolbarSelect({ className, ...props }: ToolbarSelectProps) {
  const cls = [styles.toolbarSelect, className].filter(Boolean).join(' ');
  return <select className={cls} {...props} />;
}

export interface ColorSwatchProps {
  color?: string;
}

export function ColorSwatch({ color }: ColorSwatchProps) {
  return <span className={styles.colorSwatch} style={{ background: color }} />;
}
