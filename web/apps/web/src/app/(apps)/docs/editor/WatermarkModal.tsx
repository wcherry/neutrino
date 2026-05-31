'use client';

import React, { useState } from 'react';
import styles from './page.module.css';

export interface WatermarkModalProps {
  watermarkText: string;
  bgColor: string;
  onSave: (watermarkText: string, bgColor: string) => void;
  onClose: () => void;
}

export function WatermarkModal({
  watermarkText: initialWatermark,
  bgColor: initialBgColor,
  onSave,
  onClose,
}: WatermarkModalProps) {
  const [watermark, setWatermark] = useState(initialWatermark);
  const [bg, setBg] = useState(initialBgColor || '#ffffff');

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>Watermark &amp; page background</div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Watermark text</label>
          <input
            className={styles.formInput}
            type="text"
            value={watermark}
            onChange={(e) => setWatermark(e.target.value)}
            placeholder="e.g. DRAFT, CONFIDENTIAL"
          />
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Page background</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              style={{ width: 40, height: 34, cursor: 'pointer', padding: 2, border: '1px solid var(--color-border, #e0e0e0)', borderRadius: 6 }}
            />
            <input
              className={styles.formInput}
              type="text"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              style={{ flex: 1 }}
              placeholder="#ffffff"
            />
            <button
              className={styles.exportBtn}
              onClick={() => setBg('#ffffff')}
              title="Reset to white"
              style={{ whiteSpace: 'nowrap' }}
            >
              Reset
            </button>
          </div>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.exportBtn}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
            onClick={() => { onSave(watermark, bg === '#ffffff' ? '' : bg); onClose(); }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
