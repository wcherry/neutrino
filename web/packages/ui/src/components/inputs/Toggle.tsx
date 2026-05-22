'use client';

import React, { useId } from 'react';
import styles from './Toggle.module.css';

export type ToggleSize = 'sm' | 'md' | 'lg';

export interface ToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  description?: string;
  size?: ToggleSize;
  labelPosition?: 'left' | 'right';
}

export function Toggle({
  label,
  description,
  size = 'md',
  labelPosition = 'right',
  className = '',
  disabled,
  checked,
  id: externalId,
  ...props
}: ToggleProps) {
  const generatedId = useId();
  const id = externalId ?? generatedId;

  const fieldClasses = [
    styles.field,
    styles[size],
    disabled ? styles.disabled : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const labelContent = (label || description) && (
    <span className={styles.content}>
      {label && <span className={styles['label-text']}>{label}</span>}
      {description && <span className={styles.description}>{description}</span>}
    </span>
  );

  return (
    <label className={fieldClasses} htmlFor={id}>
      {labelPosition === 'left' && labelContent}
      <input
        type="checkbox"
        role="switch"
        id={id}
        className={styles.input}
        disabled={disabled}
        checked={checked}
        aria-checked={checked}
        {...props}
      />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      {labelPosition === 'right' && labelContent}
    </label>
  );
}
