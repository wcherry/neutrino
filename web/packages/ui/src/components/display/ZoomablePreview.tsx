'use client';

import React, { useState } from 'react';
import { ZoomSlider } from '../inputs/ZoomSlider';
import styles from './ZoomablePreview.module.css';

export interface ZoomablePreviewProps {
  /** The rendered preview — a note's blocks, a page of a document, anything laid out in HTML. */
  children: React.ReactNode;
  /** Controlled zoom, in percent. Omit it (with `onZoomChange`) and the preview keeps its own. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** Starting zoom when uncontrolled, in percent (default 100). */
  defaultZoom?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Accessible name for the preview region, e.g. the file's name. */
  label?: string;
  className?: string;
}

/**
 * A preview with a zoom slider laid over it.
 *
 * The content is laid out at `100% / scale` of the box's width and then scaled
 * back down by `scale`, so zooming out reflows it onto a wider page and shows
 * more of it, and zooming in enlarges it to be read — the same thing a page
 * zoom does, rather than a bitmap being stretched. It is not tied to any file
 * type: `FileGrid` uses it for every `GridItem.preview`, so a type that can
 * render one gets the slider with it.
 *
 * The slider sits inside whatever card hosts the preview, so it swallows its
 * own pointer and key events — otherwise dragging it opens the file and an
 * arrow key or Space typed on it reaches the card's own keyboard handler.
 */
export function ZoomablePreview({
  children,
  zoom: zoomProp,
  onZoomChange,
  defaultZoom = 100,
  min = 50,
  max = 200,
  step = 25,
  label,
  className = '',
}: ZoomablePreviewProps) {
  const [uncontrolledZoom, setUncontrolledZoom] = useState(defaultZoom);
  const zoom = zoomProp ?? uncontrolledZoom;
  const scale = zoom / 100;

  function handleZoom(next: number) {
    setUncontrolledZoom(next);
    onZoomChange?.(next);
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label ? `Preview of ${label}` : 'Preview'}
    >
      <div className={styles.viewport} aria-hidden="true">
        <div
          className={styles.content}
          style={{ '--preview-scale': scale } as React.CSSProperties}
        >
          {children}
        </div>
      </div>
      <div
        className={styles.overlay}
        onClick={stop}
        onDoubleClick={stop}
        onMouseDown={stop}
        onPointerDown={stop}
        onKeyDown={stop}
      >
        <ZoomSlider
          size="sm"
          value={zoom}
          onChange={handleZoom}
          min={min}
          max={max}
          step={step}
          showHandle
        />
      </div>
    </div>
  );
}
