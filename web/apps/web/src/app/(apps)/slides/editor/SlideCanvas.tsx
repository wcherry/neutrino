'use client';

import React, { useRef } from 'react';
import type { Slide, SlideElement, TextElement, ShapeElement, SheetEmbedElement } from './slideEditorTypes';
import { SHAPE_CATALOG, RESIZE_HANDLES } from './slideEditorConstants';
import { slideBackgroundStyle } from './slideEditorHelpers';
import { SheetEmbedRenderer } from '@neutrino/sheet-embed';
import type { CellValue } from '@neutrino/sheet-embed';
import styles from './page.module.css';

// ── ShapeRenderer ─────────────────────────────────────────────────────────────

export function ShapeRenderer({ el }: { el: ShapeElement }) {
  const def = SHAPE_CATALOG[el.shape];
  if (!def) return null;
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
      <path
        d={def.path}
        fill={el.fill}
        stroke={el.stroke || 'none'}
        strokeWidth={el.strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── SlideCanvas ───────────────────────────────────────────────────────────────

interface SlideCanvasProps {
  slide: Slide;
  selectedElementId: string | null;
  editingElementId: string | null;
  spellCheck: boolean;
  onSelectElement: (id: string) => void;
  onStartEdit: (id: string) => void;
  onStopEdit: () => void;
  onUpdateElement: (id: string, updater: (el: SlideElement) => SlideElement) => void;
  onClickBackground: () => void;
  /** Called when a sheet embed's cache is refreshed; caller persists it. */
  onEmbedCacheUpdate?: (id: string, rows: CellValue[][], fetchedAt: string) => void;
  /** Called when the user chooses "Convert to static table" on a sheet embed. */
  onEmbedConvertToStatic?: (id: string, data: CellValue[][]) => void;
  /** Called when the user removes a sheet embed. */
  onEmbedRemove?: (id: string) => void;
}

export default function SlideCanvas({
  slide,
  selectedElementId,
  editingElementId,
  spellCheck,
  onSelectElement,
  onStartEdit,
  onStopEdit,
  onUpdateElement,
  onClickBackground,
  onEmbedCacheUpdate,
  onEmbedConvertToStatic,
  onEmbedRemove,
}: SlideCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    elementId: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const resizeState = useRef<{
    elementId: string;
    handle: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  function handleMouseDown(e: React.MouseEvent, elementId: string, el: SlideElement) {
    if (editingElementId === elementId) return;
    e.stopPropagation();
    onSelectElement(elementId);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragState.current = {
      elementId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: el.x,
      startY: el.y,
    };

    function onMove(me: MouseEvent) {
      if (!dragState.current || !canvas) return;
      const dx = ((me.clientX - dragState.current.startMouseX) / rect.width) * 100;
      const dy = ((me.clientY - dragState.current.startMouseY) / rect.height) * 100;
      const newX = Math.max(0, Math.min(100, dragState.current.startX + dx));
      const newY = Math.max(0, Math.min(100, dragState.current.startY + dy));
      onUpdateElement(dragState.current.elementId, (el) => ({ ...el, x: newX, y: newY }));
    }

    function onUp() {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleResizeMouseDown(
    e: React.MouseEvent,
    elementId: string,
    el: SlideElement,
    handle: string,
  ) {
    e.stopPropagation();
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    resizeState.current = {
      elementId,
      handle,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: el.x,
      startY: el.y,
      startW: el.w,
      startH: el.h,
    };

    function onMove(me: MouseEvent) {
      if (!resizeState.current) return;
      const { handle: h, startMouseX, startMouseY, startX, startY, startW, startH } = resizeState.current;
      const dx = ((me.clientX - startMouseX) / rect.width) * 100;
      const dy = ((me.clientY - startMouseY) / rect.height) * 100;

      let newX = startX, newY = startY, newW = startW, newH = startH;

      if (h.includes('e')) newW = Math.max(5, startW + dx);
      if (h.includes('w')) {
        const clampedDx = Math.min(dx, startW - 5);
        newX = startX + clampedDx;
        newW = startW - clampedDx;
      }
      if (h.includes('s')) newH = Math.max(5, startH + dy);
      if (h.includes('n')) {
        const clampedDy = Math.min(dy, startH - 5);
        newY = startY + clampedDy;
        newH = startH - clampedDy;
      }

      onUpdateElement(resizeState.current.elementId, (elem) => ({
        ...elem, x: newX, y: newY, w: newW, h: newH,
      }));
    }

    function onUp() {
      resizeState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      ref={canvasRef}
      className={styles.slideCanvas}
      style={slideBackgroundStyle(slide.background)}
      onClick={onClickBackground}
    >
      {slide.elements.map((el) => {
        const isSelected = el.id === selectedElementId;
        const isEditing = el.id === editingElementId;

        if (el.type === 'text') {
          const textEl = el as TextElement;
          return (
            <div
              key={el.id}
              className={`${styles.slideElement} ${isSelected ? styles.slideElementSelected : ''}`}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                cursor: isEditing ? 'text' : 'move',
              }}
              onMouseDown={(e) => handleMouseDown(e, el.id, el)}
              onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(el.id); }}
              onClick={(e) => e.stopPropagation()}
            >
              {isEditing ? (
                <textarea
                  className={styles.textEditArea}
                  autoFocus
                  spellCheck={spellCheck}
                  defaultValue={textEl.content}
                  style={{
                    fontSize: `${textEl.style.fontSize * 0.75}px`,
                    fontWeight: textEl.style.bold ? 700 : 400,
                    fontStyle: textEl.style.italic ? 'italic' : 'normal',
                    textDecoration: textEl.style.underline ? 'underline' : 'none',
                    color: textEl.style.color,
                    textAlign: textEl.style.align,
                    fontFamily: textEl.style.fontFamily,
                  }}
                  onBlur={(e) => {
                    onUpdateElement(el.id, (elem) => ({ ...elem, content: e.target.value } as TextElement));
                    onStopEdit();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div
                  className={styles.textDisplay}
                  style={{
                    fontSize: `${textEl.style.fontSize * 0.75}px`,
                    fontWeight: textEl.style.bold ? 700 : 400,
                    fontStyle: textEl.style.italic ? 'italic' : 'normal',
                    textDecoration: textEl.style.underline ? 'underline' : 'none',
                    color: textEl.style.color,
                    textAlign: textEl.style.align,
                    fontFamily: textEl.style.fontFamily,
                  }}
                >
                  {textEl.content || <span style={{ opacity: 0.4 }}>Empty text box</span>}
                </div>
              )}
              {isSelected && !isEditing && RESIZE_HANDLES.map((h) => (
                <div
                  key={h.id}
                  className={styles.resizeHandle}
                  style={{ top: h.top, left: h.left, cursor: h.cursor }}
                  onMouseDown={(e) => handleResizeMouseDown(e, el.id, el, h.id)}
                />
              ))}
            </div>
          );
        }

        if (el.type === 'shape') {
          const shapeEl = el as ShapeElement;
          return (
            <div
              key={el.id}
              className={`${styles.slideElement} ${isSelected ? styles.slideElementSelected : ''}`}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                cursor: 'move',
              }}
              onMouseDown={(e) => handleMouseDown(e, el.id, el)}
              onClick={(e) => e.stopPropagation()}
            >
              <ShapeRenderer el={shapeEl} />
              {isSelected && RESIZE_HANDLES.map((h) => (
                <div
                  key={h.id}
                  className={styles.resizeHandle}
                  style={{ top: h.top, left: h.left, cursor: h.cursor }}
                  onMouseDown={(e) => handleResizeMouseDown(e, el.id, el, h.id)}
                />
              ))}
            </div>
          );
        }

        if (el.type === 'sheetEmbed') {
          const embedEl = el as SheetEmbedElement;
          const parsedCachedData: CellValue[][] | null = (() => {
            try {
              return embedEl.cachedData ? (JSON.parse(embedEl.cachedData) as CellValue[][]) : null;
            } catch {
              return null;
            }
          })();
          const attrs = {
            spreadsheetId: embedEl.spreadsheetId,
            sheetId: embedEl.sheetId,
            namedRangeId: embedEl.namedRangeId,
            cachedData: parsedCachedData,
            cachedAt: embedEl.cachedAt,
            title: embedEl.title ?? null,
          };
          return (
            <div
              key={el.id}
              className={`${styles.slideElement} ${isSelected ? styles.slideElementSelected : ''}`}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                cursor: 'move',
                overflow: 'hidden',
              }}
              onMouseDown={(e) => handleMouseDown(e, el.id, el)}
              onClick={(e) => e.stopPropagation()}
            >
              <SheetEmbedRenderer
                attrs={attrs}
                onCacheUpdate={(rows, fetchedAt) => onEmbedCacheUpdate?.(el.id, rows, fetchedAt)}
                onConvertToStatic={(data) => onEmbedConvertToStatic?.(el.id, data)}
                onRemove={() => onEmbedRemove?.(el.id)}
              />
              {isSelected && RESIZE_HANDLES.map((h) => (
                <div
                  key={h.id}
                  className={styles.resizeHandle}
                  style={{ top: h.top, left: h.left, cursor: h.cursor }}
                  onMouseDown={(e) => handleResizeMouseDown(e, el.id, el, h.id)}
                />
              ))}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
