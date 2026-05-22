'use client';

import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Select.module.css';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: SelectSize;
  options?: SelectOption[];
  placeholder?: string;
  fullWidth?: boolean;
}

export function Select({
  label,
  hint,
  error,
  size = 'md',
  options = [],
  placeholder,
  fullWidth = true,
  className = '',
  id: externalId,
  required,
  children,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const id = externalId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const selectClasses = [styles.select, styles[size], className].filter(Boolean).join(' ');

  return (
    <div className={[styles.field, fullWidth ? 'u-w-full' : ''].filter(Boolean).join(' ')}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
      )}
      <div className={styles.wrapper}>
        <select
          id={id}
          className={selectClasses}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            [error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined
          }
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {children ??
            options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
        </select>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronDown size={16} />
        </span>
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
