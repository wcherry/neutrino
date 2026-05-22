'use client';

import React, { useId } from 'react';
import styles from './Radio.module.css';

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export function Radio({
  label,
  description,
  className = '',
  disabled,
  id: externalId,
  ...props
}: RadioProps) {
  const generatedId = useId();
  const id = externalId ?? generatedId;

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
        type="radio"
        id={id}
        className={styles.input}
        disabled={disabled}
        {...props}
      />
      <span className={styles.circle} aria-hidden="true">
        <span className={styles.dot} />
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

export interface RadioGroupProps {
  label?: string;
  name: string;
  direction?: 'column' | 'row';
  className?: string;
  children: React.ReactNode;
}

export function RadioGroup({
  label,
  name,
  direction = 'column',
  className = '',
  children,
}: RadioGroupProps) {
  const groupClasses = [
    styles.group,
    direction === 'row' ? styles.row : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <fieldset>
      {label && <legend className={styles['group-label']}>{label}</legend>}
      <div className={groupClasses} role="radiogroup">
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement<RadioProps>, { name });
          }
          return child;
        })}
      </div>
    </fieldset>
  );
}
