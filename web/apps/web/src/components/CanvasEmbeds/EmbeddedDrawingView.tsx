'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import type { DrawingClipSelection } from '@/lib/canvasClipboard';
import { selectionRender, renderSelection } from '@/app/(apps)/drawing/editor/io/selectionImage';
import { documentContentBounds } from '@/app/(apps)/drawing/editor/document/tree';
import type { EmbeddedDrawing } from './useEmbeddedCanvas';
import styles from './CanvasEmbeds.module.css';

/** The longest side, in device pixels, an embed is ever drawn at. */
const MAX_EDGE = 4096;

export interface EmbeddedDrawingViewProps {
  drawing: EmbeddedDrawing;
  /** What to show; null is everything drawn. */
  selection: DrawingClipSelection | null;
  drawingId?: string;
}

/**
 * A live picture of part of a drawing, fitted into its box.
 *
 * Drawn on a canvas at the device's pixel ratio from the drawing itself, through
 * the same plan the copy used, so the embed and the picture that was pasted
 * agree. Fitting is CSS (`object-fit: contain`), so resizing the embed costs no
 * re-render.
 */
export function EmbeddedDrawingView({ drawing, selection, drawingId }: EmbeddedDrawingViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plan = useMemo(() => {
    if (selection) return selectionRender(drawing.doc, selection);
    const bounds = documentContentBounds(drawing.doc);
    return bounds ? { doc: drawing.doc, skipNodeIds: new Set<string>(), bounds } : null;
  }, [drawing.doc, selection]);

  useEffect(() => {
    const target = canvasRef.current;
    if (!target || !plan) return;
    // Sharp on a high-density screen, but never past MAX_EDGE on the long side: a selection from a
    // large canvas at 4× would ask for a canvas bigger than browsers allocate, and draw nothing.
    const longEdge = Math.max(plan.bounds.width, plan.bounds.height);
    const scale = Math.min(Math.max(1, window.devicePixelRatio || 1) * 2, MAX_EDGE / longEdge);
    const surface = renderSelection(plan, drawing.bitmaps, scale);
    if (!surface) return;
    target.width = surface.width;
    target.height = surface.height;
    target.getContext('2d')?.drawImage(surface as CanvasImageSource, 0, 0);
  }, [plan, drawing.bitmaps]);

  if (!plan) {
    return <div className={styles.message}>What was embedded is no longer in this drawing.</div>;
  }

  return (
    <div className={styles.frame}>
      <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={drawing.doc.metadata.title || 'Drawing'} />
      {drawingId && (
        <a href={`/drawing/editor?id=${drawingId}`} className={styles.openLink} target="_blank" rel="noreferrer">
          Open
        </a>
      )}
    </div>
  );
}
