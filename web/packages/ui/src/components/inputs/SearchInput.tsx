'use client';

import React, { useId } from 'react';
import { Search, X } from 'lucide-react';
import styles from './SearchInput.module.css';

export type SearchInputSize = 'sm' | 'md' | 'lg';
export type SearchInputVariant = 'default' | 'subtle';

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: SearchInputSize;
  variant?: SearchInputVariant;
  onClear?: () => void;
}

export function SearchInput({
  size = 'md',
  variant = 'default',
  onClear,
  className = '',
  value,
  onChange,
  ...props
}: SearchInputProps) {
  const id = useId();
  const hasValue = typeof value === 'string' && value.length > 0;

  const wrapperClasses = [
    styles.wrapper,
    variant === 'subtle' ? styles.subtle : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const inputClasses = [styles.input, styles[size]].filter(Boolean).join(' ');

  return (
    <div className={wrapperClasses}>
      <span className={styles['icon-left']} aria-hidden="true">
        <Search size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
      </span>
      <input
        id={id}
        type="search"
        className={inputClasses}
        value={value}
        onChange={onChange}
        role="searchbox"
        {...props}
      />
      {hasValue && onClear && (
        <button
          type="button"
          className={styles['clear-btn']}
          onClick={onClear}
          aria-label="Clear search"
          tabIndex={-1}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
