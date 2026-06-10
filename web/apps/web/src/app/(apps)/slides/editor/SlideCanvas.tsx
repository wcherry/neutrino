'use client';

'use client';

import React, { useEffect, useState as useStateHook, useRef, useState } from 'react';
import type { Slide, SlideElement, TextElement, ShapeElement, LineElement, SheetEmbedElement, VideoElement, ImageElement, DiagramElement } from './slideEditorTypes';
import { SHAPE_CATALOG, RESIZE_HANDLES } from './slideEditorConstants';
import { slideBackgroundStyle, getVideoEmbedInfo } from './slideEditorHelpers';
import { SheetEmbedRenderer } from '@neutrino/sheet-embed';
import type { CellValue } from '@neutrino/sheet-embed';
import { EmbeddedDiagramView } from '@/app/(apps)/diagrams/editor/EmbeddedDiagramView';
import { diagramsApi } from '@neutrino/api-diagrams';
import type { DiagramDocument, DiagramPage } from '@/app/(apps)/diagrams/types';
import styles from './page.module.css';

function DiagramSlideElement({ el }: { el: DiagramElement }) {
  const [page, setPage] = useStateHook<DiagramPage | null>(null);

  useEffect(() => {
    let cancelled = false;
    diagramsApi.getDiagram(el.diagramId)
      .then(async (meta) => {
        if (cancelled || !meta.contentUrl) return;
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') ?? '' : '';
        const res = await fetch(meta.contentUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const doc = await res.json() as DiagramDocument;
        const p = doc.pages[el.pageIndex] ?? doc.pages[0] ?? null;
        if (!cancelled) setPage(p);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [el.diagramId, el.pageIndex]);

  if (!page) return <div style={{ width: '100%', height: '100%', background: '#f8fafc', borderRadius: 4 }} />;
  return <EmbeddedDiagramView page={page} width="100%" height="100%" />;
}

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
        strokeDasharray={el.strokeDash || undefined}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── LineRenderer ──────────────────────────────────────────────────────────────

export function LineRenderer({
  el,
  isSelected,
  onBodyMouseDown,
  onEndpointMouseDown,
}: {
  el: LineElement;
  isSelected?: boolean;
  onBodyMouseDown?: (e: React.MouseEvent) => void;
  onEndpointMouseDown?: (e: React.MouseEvent, endpoint: 'start' | 'end') => void;
}) {
  const sid         = el.id.replace(/[^a-z0-9]/gi, '');
  const color       = el.stroke || '#000000';
  const sw          = el.strokeWidth || 2;
  const startArrow  = el.startArrow ?? 'none';
  const endArrow    = el.endArrow   ?? 'none';
  const arrowSize   = Math.max(8, sw * 4);
  const half        = arrowSize / 2;

  const arrowContent = (type: 'arrow' | 'triangle') =>
    type === 'triangle'
      ? <polygon points={`0 0, ${arrowSize} ${half}, 0 ${arrowSize}`} fill={color} />
      : <polyline points={`0 0, ${arrowSize} ${half}, 0 ${arrowSize}`} fill="none" stroke={color} strokeWidth={sw} />;

  return (
    <svg
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        {startArrow !== 'none' && (
          <marker id={`ls-${sid}`} markerWidth={arrowSize} markerHeight={arrowSize}
            refX={arrowSize} refY={half} orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            {arrowContent(startArrow)}
          </marker>
        )}
        {endArrow !== 'none' && (
          <marker id={`le-${sid}`} markerWidth={arrowSize} markerHeight={arrowSize}
            refX={arrowSize} refY={half} orient="auto" markerUnits="userSpaceOnUse">
            {arrowContent(endArrow)}
          </marker>
        )}
      </defs>

      {/* Wide transparent hit area */}
      {onBodyMouseDown && (
        <line
          x1={`${el.x1}%`} y1={`${el.y1}%`} x2={`${el.x2}%`} y2={`${el.y2}%`}
          stroke="transparent" strokeWidth={Math.max(16, sw + 10)}
          style={{ pointerEvents: 'stroke', cursor: 'move' }}
          onMouseDown={onBodyMouseDown}
        />
      )}

      {/* Selection highlight */}
      {isSelected && (
        <line
          x1={`${el.x1}%`} y1={`${el.y1}%`} x2={`${el.x2}%`} y2={`${el.y2}%`}
          stroke="#2563eb" strokeWidth={sw + 6} strokeOpacity={0.3}
          vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Visible line */}
      <line
        x1={`${el.x1}%`} y1={`${el.y1}%`} x2={`${el.x2}%`} y2={`${el.y2}%`}
        stroke={color} strokeWidth={sw}
        strokeDasharray={el.strokeDash || undefined}
        vectorEffect="non-scaling-stroke"
        markerStart={startArrow !== 'none' ? `url(#ls-${sid})` : undefined}
        markerEnd={endArrow   !== 'none' ? `url(#le-${sid})` : undefined}
        style={{ pointerEvents: 'none' }}
      />

      {/* Endpoint drag handles */}
      {isSelected && onEndpointMouseDown && (
        <>
          <circle cx={`${el.x1}%`} cy={`${el.y1}%`} r={6}
            fill="white" stroke="#2563eb" strokeWidth={2}
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onMouseDown={(e) => onEndpointMouseDown(e, 'start')}
          />
          <circle cx={`${el.x2}%`} cy={`${el.y2}%`} r={6}
            fill="white" stroke="#2563eb" strokeWidth={2}
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onMouseDown={(e) => onEndpointMouseDown(e, 'end')}
          />
        </>
      )}
    </svg>
  );
}

// ── SlideCanvas ───────────────────────────────────────────────────────────────

interface SlideCanvasProps {
  slide: Slide;
  selectedElementId: string | null;
  editingElementId: string | null;
  editingInitialText: string | null;
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
  /** Called when an item is dragged from the Insert panel and dropped on the canvas. */
  onInsertDrop?: (kind: string, shape: string | null, pctX: number, pctY: number) => void;
}

export default function SlideCanvas({
  slide,
  selectedElementId,
  editingElementId,
  editingInitialText,
  spellCheck,
  onSelectElement,
  onStartEdit,
  onStopEdit,
  onUpdateElement,
  onClickBackground,
  onEmbedCacheUpdate,
  onEmbedConvertToStatic,
  onEmbedRemove,
  onInsertDrop,
}: SlideCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
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

  function handleMouseDown(e: React.MouseEvent, elementId: string, el: Exclude<SlideElement, LineElement>) {
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
    el: Exclude<SlideElement, LineElement>,
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
      const { handle: h, startMouseX, startMouseY, startX, startY, startW, startH, elementId } = resizeState.current;
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

      // Lock aspect ratio for video elements on a 16:9 slide.
      // 16:9 video → h% = w%  (ratio 1)
      // 9:16 Shorts → h% = w% × (16/9)/(9/16) = w% × 256/81
      onUpdateElement(elementId, (elem) => {
        if (elem.type === 'video') {
          const { isPortrait } = getVideoEmbedInfo((elem as VideoElement).url);
          const ratio = isPortrait ? 256 / 81 : 1;
          const deltaW = Math.abs(newW - startW);
          const deltaH = Math.abs(newH - startH);
          if (deltaW >= deltaH) {
            const lockedH = newW * ratio;
            if (h.includes('n')) newY = startY + startH - lockedH;
            newH = lockedH;
          } else {
            const lockedW = newH / ratio;
            if (h.includes('w')) newX = startX + startW - lockedW;
            newW = lockedW;
          }
        }
        return { ...elem, x: newX, y: newY, w: newW, h: newH };
      });
    }

    function onUp() {
      resizeState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const DRAG_MIME = 'application/x-slide-insert';

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!canvasRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let payload: { kind: string; shape?: string };
    try { payload = JSON.parse(raw); } catch { return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pctX = ((e.clientX - rect.left) / rect.width) * 100;
    const pctY = ((e.clientY - rect.top) / rect.height) * 100;
    onInsertDrop?.(payload.kind, payload.shape ?? null, pctX, pctY);
  }

  return (
    <div
      ref={canvasRef}
      className={`${styles.slideCanvas} ${isDragOver ? styles.slideCanvasDragOver : ''}`}
      style={slideBackgroundStyle(slide.background)}
      onClick={onClickBackground}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
                  onFocus={(e) => {
                    if (editingInitialText === null) {
                      e.target.select();
                    } else {
                      const len = e.target.value.length;
                      e.target.setSelectionRange(len, len);
                    }
                  }}
                  spellCheck={spellCheck}
                  defaultValue={editingInitialText !== null ? editingInitialText : textEl.content}
                  style={{
                    fontSize: `${textEl.style.fontSize * 0.75}px`,
                    fontWeight: textEl.style.bold ? 700 : 400,
                    fontStyle: textEl.style.italic ? 'italic' : 'normal',
                    textDecoration: [
                      textEl.style.underline ? 'underline' : '',
                      textEl.style.strikethrough ? 'line-through' : '',
                    ].filter(Boolean).join(' ') || 'none',
                    color: textEl.style.color,
                    backgroundColor: textEl.style.backgroundColor ?? 'transparent',
                    textAlign: textEl.style.align,
                    fontFamily: textEl.style.fontFamily,
                    lineHeight: textEl.style.lineHeight ?? 1.3,
                    textShadow: textEl.style.shadow ? `2px 2px 4px ${textEl.style.shadowColor ?? 'rgba(0,0,0,0.5)'}` : undefined,
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
                    textDecoration: [
                      textEl.style.underline ? 'underline' : '',
                      textEl.style.strikethrough ? 'line-through' : '',
                    ].filter(Boolean).join(' ') || 'none',
                    color: textEl.style.color,
                    backgroundColor: textEl.style.backgroundColor ?? 'transparent',
                    textAlign: textEl.style.align,
                    fontFamily: textEl.style.fontFamily,
                    lineHeight: textEl.style.lineHeight ?? 1.3,
                    textShadow: textEl.style.shadow ? `2px 2px 4px ${textEl.style.shadowColor ?? 'rgba(0,0,0,0.5)'}` : undefined,
                  }}
                >
                  {!textEl.content ? (
                    <span style={{ opacity: 0.4 }}>Empty text box</span>
                  ) : textEl.content.split('\n').map((line, i, arr) => {
                    const listType = textEl.style.listType ?? 'none';
                    const spaceBefore = (textEl.style.spaceBefore ?? 0) * 0.75;
                    const spaceAfter = (textEl.style.spaceAfter ?? 0) * 0.75;
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: listType !== 'none' ? '0.4em' : undefined,
                          marginTop: i > 0 ? spaceBefore : 0,
                          marginBottom: i < arr.length - 1 ? spaceAfter : 0,
                        }}
                      >
                        {listType === 'bullet' && (
                          <span style={{ flexShrink: 0, userSelect: 'none' }}>•</span>
                        )}
                        {listType === 'numbered' && (
                          <span style={{ flexShrink: 0, userSelect: 'none' }}>{i + 1}.</span>
                        )}
                        <span style={{ flex: 1 }}>{line || ' '}</span>
                      </div>
                    );
                  })}
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

        if (el.type === 'line') {
          const lineEl = el as LineElement;

          function handleLineBodyMouseDown(e: React.MouseEvent) {
            e.stopPropagation();
            onSelectElement(el.id);
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const startMX = e.clientX, startMY = e.clientY;
            const sx1 = lineEl.x1, sy1 = lineEl.y1, sx2 = lineEl.x2, sy2 = lineEl.y2;
            function onMove(me: MouseEvent) {
              const dx = ((me.clientX - startMX) / rect.width)  * 100;
              const dy = ((me.clientY - startMY) / rect.height) * 100;
              onUpdateElement(el.id, (elem) => ({ ...(elem as LineElement), x1: sx1 + dx, y1: sy1 + dy, x2: sx2 + dx, y2: sy2 + dy }));
            }
            function onUp() {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }

          function handleEndpointMouseDown(e: React.MouseEvent, endpoint: 'start' | 'end') {
            e.stopPropagation();
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const startMX = e.clientX, startMY = e.clientY;
            const sx = endpoint === 'start' ? lineEl.x1 : lineEl.x2;
            const sy = endpoint === 'start' ? lineEl.y1 : lineEl.y2;
            function onMove(me: MouseEvent) {
              const dx = ((me.clientX - startMX) / rect.width)  * 100;
              const dy = ((me.clientY - startMY) / rect.height) * 100;
              onUpdateElement(el.id, (elem) => {
                const l = elem as LineElement;
                return endpoint === 'start'
                  ? { ...l, x1: sx + dx, y1: sy + dy }
                  : { ...l, x2: sx + dx, y2: sy + dy };
              });
            }
            function onUp() {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }

          return (
            <div
              key={el.id}
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              <LineRenderer
                el={lineEl}
                isSelected={isSelected}
                onBodyMouseDown={handleLineBodyMouseDown}
                onEndpointMouseDown={handleEndpointMouseDown}
              />
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

        if (el.type === 'video') {
          const videoEl = el as VideoElement;
          const info = getVideoEmbedInfo(videoEl.url, {
            startSeconds: videoEl.startSeconds,
            autoplay: videoEl.autoplay,
            loop: videoEl.loop,
            muted: videoEl.muted,
          });
          // isEditing doubles as "play mode" for video — overlay is removed so the
          // iframe can receive pointer events and the video can actually be played.
          return (
            <div
              key={el.id}
              className={`${styles.slideElement} ${isSelected ? styles.slideElementSelected : ''}`}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                cursor: isEditing ? 'default' : 'move',
                overflow: 'hidden',
                background: '#000',
              }}
              onMouseDown={(e) => { if (!isEditing) handleMouseDown(e, el.id, el); }}
              onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(el.id); }}
              onClick={(e) => e.stopPropagation()}
            >
              {info.isPortrait ? (
                <div className={styles.shortVideoContainer}>
                  <iframe
                    src={info.embedUrl}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    title="Video embed"
                  />
                </div>
              ) : info.provider === 'mp4' ? (
                <video
                  src={info.embedUrl}
                  controls
                  autoPlay={videoEl.autoplay}
                  loop={videoEl.loop}
                  muted={videoEl.muted}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <iframe
                  src={info.embedUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="Video embed"
                />
              )}
              {/* Transparent overlay captures mouse events for drag/resize when not in play mode */}
              {!isEditing && (
                <div style={{ position: 'absolute', inset: 0, cursor: 'move' }} />
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

        if (el.type === 'image') {
          const imgEl = el as ImageElement;
          const filterParts: string[] = [];
          if (imgEl.brightness !== 0) filterParts.push(`brightness(${1 + imgEl.brightness / 100})`);
          if (imgEl.contrast !== 0) filterParts.push(`contrast(${1 + imgEl.contrast / 100})`);
          if (imgEl.saturation !== 0) filterParts.push(`saturate(${Math.max(0, 1 + imgEl.saturation / 100)})`);
          if (imgEl.warmth > 0) {
            filterParts.push(`sepia(${(imgEl.warmth / 100) * 0.5})`);
            filterParts.push(`hue-rotate(${imgEl.warmth * -0.1}deg)`);
          } else if (imgEl.warmth < 0) {
            filterParts.push(`hue-rotate(${imgEl.warmth * 0.5}deg)`);
          }
          const imgFilter = filterParts.length > 0 ? filterParts.join(' ') : undefined;

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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgEl.src}
                alt=""
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: imgEl.objectFit ?? 'cover',
                  opacity: imgEl.opacity ?? 1,
                  filter: imgFilter,
                  display: 'block',
                  pointerEvents: 'none',
                }}
              />
              {imgEl.tintColor && imgEl.tintStrength > 0 && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: imgEl.tintColor,
                  opacity: imgEl.tintStrength,
                  mixBlendMode: 'multiply',
                  pointerEvents: 'none',
                }} />
              )}
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

        if (el.type === 'diagram') {
          const diagEl = el as DiagramElement;
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
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 4,
              }}
              onMouseDown={(e) => handleMouseDown(e, el.id, el)}
              onClick={(e) => e.stopPropagation()}
            >
              <DiagramSlideElement el={diagEl} />
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
