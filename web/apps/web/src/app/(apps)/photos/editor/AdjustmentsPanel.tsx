'use client';

import React from 'react';
import { RotateCcw, RotateCw, FlipHorizontal, FlipVertical, RefreshCcw } from 'lucide-react';
import type { Adjustments } from './types';
import styles from './page.module.css';

interface AdjustmentsPanelProps {
  adjustments: Adjustments;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  onAdjustmentChange: (key: keyof Adjustments, value: number) => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onResetAdjustments: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  adjKey: keyof Adjustments;
  onChange: (key: keyof Adjustments, value: number) => void;
}

function SliderRow({ label, value, adjKey, onChange }: SliderRowProps) {
  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderLabel}>
        <span>{label}</span>
        <span className={styles.sliderValue}>{value > 0 ? `+${value}` : value}</span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={-100}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(adjKey, Number(e.target.value))}
      />
    </div>
  );
}

export function AdjustmentsPanel({
  adjustments,
  rotation,
  flipH,
  flipV,
  onAdjustmentChange,
  onRotateLeft,
  onRotateRight,
  onFlipH,
  onFlipV,
  onResetAdjustments,
}: AdjustmentsPanelProps) {
  return (
    <div className={styles.adjustmentsPanel}>
      <div className={styles.section}>
        <p className={styles.sectionTitle}>Light</p>
        <SliderRow label="Brightness" value={adjustments.brightness} adjKey="brightness" onChange={onAdjustmentChange} />
        <SliderRow label="Contrast" value={adjustments.contrast} adjKey="contrast" onChange={onAdjustmentChange} />
        <SliderRow label="Exposure" value={adjustments.exposure} adjKey="exposure" onChange={onAdjustmentChange} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Color</p>
        <SliderRow label="Saturation" value={adjustments.saturation} adjKey="saturation" onChange={onAdjustmentChange} />
        <SliderRow label="Temperature" value={adjustments.temperature} adjKey="temperature" onChange={onAdjustmentChange} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Detail</p>
        <SliderRow label="Sharpness" value={adjustments.sharpness} adjKey="sharpness" onChange={onAdjustmentChange} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Orientation</p>
        <div className={styles.orientationGrid}>
          <button className={styles.orientBtn} onClick={onRotateLeft} title="Rotate left">
            <RotateCcw size={16} />
            <span>CCW</span>
          </button>
          <button className={styles.orientBtn} onClick={onRotateRight} title="Rotate right">
            <RotateCw size={16} />
            <span>CW</span>
          </button>
          <button
            className={`${styles.orientBtn} ${flipH ? styles.orientBtnActive : ''}`}
            onClick={onFlipH}
            title="Flip horizontal"
            aria-pressed={flipH}
          >
            <FlipHorizontal size={16} />
            <span>Flip H</span>
          </button>
          <button
            className={`${styles.orientBtn} ${flipV ? styles.orientBtnActive : ''}`}
            onClick={onFlipV}
            title="Flip vertical"
            aria-pressed={flipV}
          >
            <FlipVertical size={16} />
            <span>Flip V</span>
          </button>
        </div>
        <p className={styles.rotationHint}>{rotation}&deg; rotation</p>
        <button className={styles.resetBtn} onClick={onResetAdjustments} title="Reset all adjustments">
          <RefreshCcw size={14} />
          Reset all
        </button>
      </div>
    </div>
  );
}
