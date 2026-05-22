'use client';

import React, { useId } from 'react';
import styles from './ZoomSlider.module.css';

export interface ZoomSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showHandle?: boolean;
  className?: string;
}

export function ZoomSlider({
  value,
  onChange,
  min = 25,
  max = 200,
  step = 25,
  showHandle = false,
  className = '',
}: ZoomSliderProps) {
  const sliderId = useId();

  function clamp(v: number) {
    return Math.min(max, Math.max(min, v));
  }

  function decrement() {
    onChange(clamp(value - step));
  }

  function increment() {
    onChange(clamp(value + step));
  }

  function handleSlider(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(Number(e.target.value));
  }

  const trackFill = ((value - min) / (max - min)) * 100;

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={decrement}
        disabled={value <= min}
        aria-label="Zoom out"
      >
        <svg width="10" height="2" viewBox="0 0 10 2" aria-hidden="true">
          <rect x="0" y="0" width="10" height="2" rx="1" fill="currentColor" />
        </svg>
      </button>

      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${trackFill}%` }} />
        {showHandle && (
          <div
            className={styles.handle}
            style={{ left: `${trackFill}%` }}
            aria-hidden="true"
          />
        )}
        <input
          id={sliderId}
          type="range"
          className={styles.range}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSlider}
          aria-label="Zoom level"
          aria-valuetext={`${value}%`}
        />
      </div>

      <button
        type="button"
        className={styles.stepBtn}
        onClick={increment}
        disabled={value >= max}
        aria-label="Zoom in"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="4" y="0" width="2" height="10" rx="1" fill="currentColor" />
          <rect x="0" y="4" width="10" height="2" rx="1" fill="currentColor" />
        </svg>
      </button>

      <span className={styles.label} aria-live="polite" aria-atomic="true">
        {value}%
      </span>
    </div>
  );
}
