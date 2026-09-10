'use client';

import React from 'react';
import { Maximize2 } from 'lucide-react';
import { ZoomSlider } from '@neutrino/ui';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitToScreen: () => void;
  /** The canvas dimensions, e.g. `1920 × 1080`. */
  canvasSize: string;
  empty: boolean;
}

export function StatusBar({ zoom, onZoomChange, onFitToScreen, canvasSize, empty }: StatusBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.info}>
        {canvasSize} px{empty ? ' · empty' : ''}
      </span>
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
