'use client';

import React, { useId } from 'react';
import { Check, Minus } from 'lucide-react';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
  indeterminate?: boolean;
}

export function Checkbox({
  label,
  description,
  indeterminate = false,
  className = '',
  disabled,
  id: externalId,
  checked,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const id = externalId ?? generatedId;

  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  const fieldClasses = [
    styles.field,
    disabled ? styles.disabled : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={fieldClasses} htmlFor={id}>
      <input
        ref={inputRef}
        type="checkbox"
        id={id}
        className={styles.input}
        disabled={disabled}
        checked={checked}
        aria-checked={indeterminate ? 'mixed' : checked}
        {...props}
      />
      <span className={styles.box} aria-hidden="true">
        {indeterminate ? (
          <span className={styles['minus-icon']} />
        ) : (
          <Check size={11} className={styles['check-icon']} strokeWidth={3} />
        )}
      </span>
      {(label || description) && (
        <span className={styles.content}>
          {label && <span className={styles.label}>{label}</span>}
          {description && <span className={styles.description}>{description}</span>}
        </span>
      )}
    </label>
  );
}
