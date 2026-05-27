'use client';

import React from 'react';
import type { Slide } from './slideEditorTypes';
import { slideBackgroundStyle } from './slideEditorHelpers';
import { SlideRenderer } from './SlideRenderer';
import styles from './page.module.css';

// Reference slide dimensions used by the canvas.
const SLIDE_W = 1280;
const SLIDE_H = 720;

// Thumbnail width: panel(180px) − list-padding(2×8px) − border(2×2px) = 160px
// Scale: 160 / 1280 = 0.125
const SCALE = 160 / SLIDE_W;

export default function SlideThumbnail({ slide }: { slide: Slide }) {
  return (
    // Background applied here so it's always visible at the correct thumbnail size.
    <div className={styles.thumbnailPreview} style={slideBackgroundStyle(slide.background)}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: SLIDE_W,
          height: SLIDE_H,
          transformOrigin: 'top left',
          transform: `scale(${SCALE})`,
        }}
      >
        <SlideRenderer slide={slide} scale={0.75} />
      </div>
    </div>
  );
}
