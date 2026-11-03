'use client';

import React, { useCallback, useRef } from 'react';
import { Node, mergeAttributes, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { parseCanvasClip, type DrawingClipSelection } from '@/lib/canvasClipboard';
import { useEmbeddedDrawing } from '@/components/CanvasEmbeds/useEmbeddedCanvas';
import { LazyEmbeddedDrawingView as EmbeddedDrawingView } from '@/components/CanvasEmbeds/LazyEmbeddedDrawingView';
import styles from './DrawingEmbedExtension.module.css';

/**
 * A live view of part of a drawing, in a document.
 *
 * The drawing's counterpart of `diagramEmbed`: the document stores which drawing
 * and what was selected in it, never pixels, and the picture is drawn from the
 * drawing each time the document opens — so an edit to the drawing shows up in
 * every document that embeds it. Made by pasting a copied drawing selection and
 * choosing "Paste as live drawing".
 *
 * Attributes are strings, as `diagramEmbed`'s are, because that is what survives
 * the `.docx` round trip's placeholder extras unchanged.
 */

const MIN_WIDTH = 48;
const MAX_WIDTH = 1200;

/** The stored selection, or null for "the whole drawing" (and for anything unreadable). */
export function parseEmbedSelection(raw: string | null): DrawingClipSelection | null {
  if (!raw) return null;
  try {
    // Validated the same way a pasted clip is: the attribute came out of a file.
    const clip = parseCanvasClip({ v: 1, kind: 'drawing', fileId: 'x', width: 1, height: 1, selection: JSON.parse(raw) });
    return clip?.kind === 'drawing' ? clip.selection : null;
  } catch {
    return null;
  }
}

function DrawingEmbedNodeView({ node, deleteNode, updateAttributes, selected }: ReactNodeViewProps) {
  const attrs = node.attrs as Record<string, string | null>;
  const drawingId = attrs.drawingId;
  const width = Number(attrs.width) || 480;
  const height = Number(attrs.height) || 280;
  const selection = parseEmbedSelection(attrs.selection);
  const state = useEmbeddedDrawing(drawingId);
  const dragRef = useRef<{ x: number; width: number } | null>(null);

  // A corner drag scales the box and keeps its shape: a drawing has an aspect ratio of its own,
  // and the picture would letterbox inside a box that lost it.
  const onResizeStart = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [width]);

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.width + e.clientX - drag.x)));
    updateAttributes({ width: String(next), height: String(Math.round(next * (height / width))) });
  }, [height, width, updateAttributes]);

  const onResizeEnd = useCallback(() => { dragRef.current = null; }, []);

  return (
    <NodeViewWrapper data-type="drawing-embed" className={styles.wrapper}>
      <div
        className={[styles.box, selected ? styles.selected : ''].filter(Boolean).join(' ')}
        style={{ width, height }}
        data-testid="drawing-embed"
      >
        {state.status === 'ready' ? (
          <EmbeddedDrawingView drawing={state.value} selection={selection} drawingId={drawingId ?? undefined} />
        ) : (
          <div className={styles.placeholder}>
            {state.status === 'error' ? state.message : attrs.title ? `Loading drawing: ${attrs.title}…` : 'Loading drawing…'}
          </div>
        )}
        <button type="button" className={styles.remove} onClick={deleteNode} title="Remove" aria-label="Remove drawing">
          ✕
        </button>
        <button
          type="button"
          className={styles.resize}
          aria-label="Resize drawing"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
        />
      </div>
    </NodeViewWrapper>
  );
}

export const DrawingEmbedExtension = Node.create({
  name: 'drawingEmbed',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      drawingId: { default: null },
      title: { default: null },
      /** `DrawingClipSelection` as JSON; null shows everything drawn. */
      selection: { default: null },
      width: { default: '480' },
      height: { default: '280' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="drawing-embed"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes as Record<string, string>, { 'data-type': 'drawing-embed' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingEmbedNodeView as React.ComponentType<ReactNodeViewProps>);
  },
});
