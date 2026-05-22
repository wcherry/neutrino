'use client';

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import styles from './ChangeToneDialog.module.css';

export interface ToneValues {
  formal: number;    // 0 = informal, 100 = formal
  cheerful: number;  // 0 = reserved, 100 = cheerful
  verbose: number;   // 0 = succinct, 100 = verbose
}

interface ChangeToneDialogProps {
  hasSelection: boolean;
  onApply: (values: ToneValues) => void;
  onClose: () => void;
}

function Slider({
  label,
  minLabel,
  maxLabel,
  value,
  onChange,
}: {
  label: string;
  minLabel: string;
  maxLabel: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className={styles.sliderGroup}>
      <div className={styles.sliderLabel}>{label}</div>
      <div className={styles.sliderRow}>
        <span className={styles.sliderMinLabel}>{minLabel}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={styles.sliderInput}
          aria-label={label}
        />
        <span className={styles.sliderMaxLabel}>{maxLabel}</span>
      </div>
      <div className={styles.sliderTick}>
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

export function ChangeToneDialog({
  hasSelection,
  onApply,
  onClose,
}: ChangeToneDialogProps) {
  const [formal, setFormal] = useState(50);
  const [cheerful, setCheerful] = useState(50);
  const [verbose, setVerbose] = useState(50);

  function handleApply() {
    onApply({ formal, cheerful, verbose });
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Sparkles size={15} className={styles.sparkleIcon} />
            Change Tone
          </div>
          <p className={styles.headerDesc}>
            {hasSelection
              ? 'Adjust the tone of the selected text.'
              : 'Adjust the tone of the whole document.'}
          </p>
        </div>

        {/* Sliders */}
        <div className={styles.sliders}>
          <Slider
            label="Formality"
            minLabel="Informal"
            maxLabel="Formal"
            value={formal}
            onChange={setFormal}
          />
          <Slider
            label="Mood"
            minLabel="Reserved"
            maxLabel="Cheerful"
            value={cheerful}
            onChange={setCheerful}
          />
          <Slider
            label="Length"
            minLabel="Succinct"
            maxLabel="Verbose"
            value={verbose}
            onChange={setVerbose}
          />
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">
            Cancel
          </button>
          <button className={styles.applyBtn} onClick={handleApply} type="button">
            <Sparkles size={13} />
            Apply tone
          </button>
        </div>
      </div>
    </div>
  );
}
