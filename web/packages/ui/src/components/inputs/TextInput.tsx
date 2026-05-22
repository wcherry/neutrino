'use client';

import React, { useId } from 'react';
import styles from './TextInput.module.css';

export type TextInputSize = 'sm' | 'md' | 'lg';

export interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: TextInputSize;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export function TextInput({
  label,
  hint,
  error,
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth = true,
  className = '',
  id: externalId,
  required,
  disabled,
  ...props
}: TextInputProps) {
  const generatedId = useId();
  const id = externalId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const wrapperClasses = [
    styles.wrapper,
    iconLeft ? styles['has-left'] : '',
    iconRight ? styles['has-right'] : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inputClasses = [
    styles.input,
    styles[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={[styles.field, fullWidth ? 'u-w-full' : ''].filter(Boolean).join(' ')}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
      )}
      <div className={wrapperClasses}>
        {iconLeft && (
          <span className={styles['icon-left']} aria-hidden="true">
            {iconLeft}
          </span>
        )}
        <input
          id={id}
          className={inputClasses}
          disabled={disabled}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            [error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined
          }
          {...props}
        />
        {iconRight && (
          <span className={styles['icon-right']} aria-hidden="true">
            {iconRight}
          </span>
        )}
      </div>
      {hint && !error && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className={styles['error-message']} id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
