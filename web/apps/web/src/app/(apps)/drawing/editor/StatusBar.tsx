'use client';

import React from 'react';
import { Maximize2 } from 'lucide-react';
import { ZoomSlider } from '@neutrino/ui';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitToScreen: () => void;
}

export function StatusBar({ zoom, onZoomChange, onFitToScreen }: StatusBarProps) {
  return (
    <div className={styles.bar}>
      <div className={styles.spacer} />
      <div className={styles.zoomArea}>
        <button
          className={styles.fitBtn}
          onClick={onFitToScreen}
          title="Fit to screen"
          aria-label="Fit to screen"
        >
          <Maximize2 size={13} />
        </button>
        <ZoomSlider
          value={Math.min(400, Math.max(10, Math.round(zoom)))}
          onChange={onZoomChange}
          min={10}
          max={400}
          step={25}
        />
      </div>
    </div>
  );
}
