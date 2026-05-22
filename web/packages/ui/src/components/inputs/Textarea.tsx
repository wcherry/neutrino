'use client';

import React, { useId } from 'react';
import styles from './Textarea.module.css';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  showCharCount?: boolean;
  fullWidth?: boolean;
}

export function Textarea({
  label,
  hint,
  error,
  showCharCount = false,
  fullWidth = true,
  className = '',
  id: externalId,
  required,
  maxLength,
  value,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const id = externalId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const currentLength = typeof value === 'string' ? value.length : 0;
  const isOverLimit = maxLength !== undefined && currentLength > maxLength;

  const textareaClasses = [styles.textarea, className].filter(Boolean).join(' ');

  return (
    <div className={[styles.field, fullWidth ? 'u-w-full' : ''].filter(Boolean).join(' ')}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
          {required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
      )}
      <textarea
        id={id}
        className={textareaClasses}
        required={required}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={
          [error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined
        }
        {...props}
      />
      <div className={styles.footer}>
        <div>
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
        {showCharCount && maxLength !== undefined && (
          <span
            className={[styles['char-count'], isOverLimit ? styles['over-limit'] : '']
              .filter(Boolean)
              .join(' ')}
            aria-live="polite"
          >
            {currentLength}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}
