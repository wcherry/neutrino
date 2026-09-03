'use client';

import React, { useRef, useState, useCallback } from 'react';
import type { ChartAnnotation } from './chartTypes';
import { useSheetZoom } from '../zoom';
import styles from './charts.module.css';

interface ChartAnnotationLayerProps {
    annotations: ChartAnnotation[];
    frameW: number;
    frameH: number;
    isChartSelected: boolean;
    onUpdate: (id: string, patch: Partial<ChartAnnotation>) => void;
    onDelete: (id: string) => void;
}

// ── Helper: convert normalised coords to pixels ───────────────────────────────

function toPixel(norm: number, size: number): number {
    return Math.round(norm * size);
}

function toNorm(px: number, size: number): number {
    return Math.max(0.01, Math.min(0.99, px / size));
}

// Annotation coordinates are kept inside the frame, with a little slack so an
// annotation dragged to an edge stays grabbable.
const MIN_NORM = 0.01;
const MAX_NORM = 0.98;

function clampNorm(v: number): number {
    return Math.max(MIN_NORM, Math.min(MAX_NORM, v));
}

/**
 * Clamp a *translation* rather than each coordinate on its own: an arrow moves
 * as a whole, so the delta has to be limited by whichever end hits the edge
 * first. Clamping the two ends separately would shorten the arrow instead of
 * stopping it.
 */
function clampDelta(delta: number, a: number, b: number): number {
    const lo = MIN_NORM - Math.min(a, b);
    const hi = MAX_NORM - Math.max(a, b);
    return Math.max(lo, Math.min(hi, delta));
}

// ── SVG path for callout bubble ───────────────────────────────────────────────

function calloutPath(x: number, y: number, w: number, h: number, r = 6): string {
    // Rounded rect with a bottom-left "tail"
    const tailX = x + w * 0.2;
    const tailY = y + h + 12;
    return [
        `M ${x + r} ${y}`,
        `L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r}`,
        `L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
        `L ${tailX + 10} ${y + h}`,
        `L ${tailX} ${tailY}`,
        `L ${tailX - 2} ${y + h}`,
        `L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r}`,
        `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}`,
        'Z',
    ].join(' ');
}

// ── Single annotation renderer ────────────────────────────────────────────────

/** 'move' drags the whole annotation; 'tail'/'head' drag one end of an arrow. */
type DragMode = 'move' | 'tail' | 'head';

interface AnnotationItemProps {
    ann: ChartAnnotation;
    frameW: number;
    frameH: number;
    isChartSelected: boolean;
    onUpdate: (patch: Partial<ChartAnnotation>) => void;
    onDelete: () => void;
}

function AnnotationItem({ ann, frameW, frameH, isChartSelected, onUpdate, onDelete }: AnnotationItemProps) {
    const [editing, setEditing] = useState(false);
    const [selectedAnn, setSelectedAnn] = useState(false);
    const dragState = useRef<{
        mode: DragMode;
        startMX: number;
        startMY: number;
        startX: number;
        startY: number;
        startX2: number;
        startY2: number;
    } | null>(null);
    // The drag delta arrives in screen pixels; frameW/frameH are grid pixels.
    const zoomScale = useSheetZoom();

    const px = toPixel(ann.x, frameW);
    const py = toPixel(ann.y, frameH);
    const pw = toPixel(ann.w, frameW);
    const ph = toPixel(ann.h, frameH);

    // An arrow's head is an absolute point, not an offset from its tail.
    const annX2 = ann.x2 ?? ann.x + ann.w;
    const annY2 = ann.y2 ?? ann.y + ann.h;

    const fill = ann.fillColor ?? 'rgba(255,255,255,0.85)';
    const stroke = ann.strokeColor ?? '#2563eb';
    const strokeW = ann.strokeWidth ?? 1.5;
    const fontColor = ann.fontColor ?? '#1a1a1a';
    const fontSize = ann.fontSize ?? 12;
    const text = ann.text ?? '';

    function handleMouseDown(e: React.MouseEvent, mode: DragMode = 'move') {
        if (!isChartSelected) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        setSelectedAnn(true);

        const isArrow = ann.type === 'arrow';
        dragState.current = {
            mode,
            startMX: e.clientX,
            startMY: e.clientY,
            startX: ann.x,
            startY: ann.y,
            startX2: annX2,
            startY2: annY2,
        };

        function onMove(me: MouseEvent) {
            const st = dragState.current;
            if (!st) return;
            const dx = (me.clientX - st.startMX) / zoomScale / frameW;
            const dy = (me.clientY - st.startMY) / zoomScale / frameH;

            if (st.mode === 'head') {
                onUpdate({ x2: clampNorm(st.startX2 + dx), y2: clampNorm(st.startY2 + dy) });
                return;
            }
            if (st.mode === 'tail') {
                onUpdate({ x: clampNorm(st.startX + dx), y: clampNorm(st.startY + dy) });
                return;
            }
            if (isArrow) {
                // Move the whole arrow: both ends travel by the same delta, so
                // dragging the body no longer leaves the head behind.
                const cdx = clampDelta(dx, st.startX, st.startX2);
                const cdy = clampDelta(dy, st.startY, st.startY2);
                onUpdate({
                    x: st.startX + cdx,
                    y: st.startY + cdy,
                    x2: st.startX2 + cdx,
                    y2: st.startY2 + cdy,
                });
                return;
            }
            onUpdate({
                x: clampNorm(st.startX + dx),
                y: clampNorm(st.startY + dy),
            });
        }
        function onUp() {
            dragState.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    function handleDoubleClick(e: React.MouseEvent) {
        if (!isChartSelected) return;
        e.stopPropagation();
        setEditing(true);
    }

    function handleDeleteKey(e: React.KeyboardEvent) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedAnn && !editing) {
                e.preventDefault();
                onDelete();
            }
        }
        if (e.key === 'Escape') {
            setEditing(false);
        }
    }

    const commonProps = {
        onMouseDown: handleMouseDown,
        onDoubleClick: handleDoubleClick,
        style: { cursor: isChartSelected ? 'move' : 'default' },
        tabIndex: isChartSelected ? 0 : -1,
        onKeyDown: handleDeleteKey,
        onBlur: () => setSelectedAnn(false),
    };

    if (ann.type === 'arrow') {
        const x2 = toPixel(annX2, frameW);
        const y2 = toPixel(annY2, frameH);
        // Compute arrowhead
        const angle = Math.atan2(y2 - py, x2 - px);
        const headLen = 10;
        const a1x = x2 - headLen * Math.cos(angle - Math.PI / 7);
        const a1y = y2 - headLen * Math.sin(angle - Math.PI / 7);
        const a2x = x2 - headLen * Math.cos(angle + Math.PI / 7);
        const a2y = y2 - headLen * Math.sin(angle + Math.PI / 7);

        return (
            <g {...commonProps} className={selectedAnn ? styles.annotationSelected : ''}>
                <line x1={px} y1={py} x2={x2} y2={y2} stroke={stroke} strokeWidth={strokeW} />
                <polygon points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`} fill={stroke} />
                {/* Transparent hit area */}
                <line x1={px} y1={py} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
                {/* Endpoint handles — each end is dragged on its own, and they sit
                    above the hit area so a grab near an end reshapes rather than moves. */}
                {selectedAnn && isChartSelected && (
                    <>
                        <circle
                            className={styles.annotationHandle}
                            data-handle="tail"
                            cx={px} cy={py} r={5}
                            onMouseDown={e => handleMouseDown(e, 'tail')}
                        />
                        <circle
                            className={styles.annotationHandle}
                            data-handle="head"
                            cx={x2} cy={y2} r={5}
                            onMouseDown={e => handleMouseDown(e, 'head')}
                        />
                    </>
                )}
            </g>
        );
    }

    if (ann.type === 'shape') {
        const kind = ann.shapeKind ?? 'rect';
        if (kind === 'ellipse') {
            return (
                <g {...commonProps} className={selectedAnn ? styles.annotationSelected : ''}>
                    <ellipse cx={px + pw / 2} cy={py + ph / 2} rx={pw / 2} ry={ph / 2}
                        fill={fill} stroke={stroke} strokeWidth={strokeW} />
                </g>
            );
        }
        if (kind === 'line') {
            return (
                <g {...commonProps} className={selectedAnn ? styles.annotationSelected : ''}>
                    <line x1={px} y1={py} x2={px + pw} y2={py + ph}
                        stroke={stroke} strokeWidth={strokeW} />
                    <line x1={px} y1={py} x2={px + pw} y2={py + ph}
                        stroke="transparent" strokeWidth={12} />
                </g>
            );
        }
        // Default: rect
        return (
            <g {...commonProps} className={selectedAnn ? styles.annotationSelected : ''}>
                <rect x={px} y={py} width={pw} height={ph}
                    fill={fill} stroke={stroke} strokeWidth={strokeW} rx={3} ry={3} />
            </g>
        );
    }

    if (ann.type === 'callout') {
        return (
            <g {...commonProps} className={selectedAnn ? styles.annotationSelected : ''}>
                <path d={calloutPath(px, py, pw, ph)} fill={fill} stroke={stroke} strokeWidth={strokeW} />
                {editing ? (
                    <foreignObject x={px + 6} y={py + 4} width={Math.max(60, pw - 12)} height={Math.max(30, ph - 8)}>
                        <input
                            ref={(el: HTMLInputElement | null) => el?.focus()}
                            style={{
                                width: '100%', height: '100%', border: 'none',
                                background: 'transparent', fontSize, color: fontColor,
                                outline: 'none', fontFamily: 'inherit',
                            }}
                            defaultValue={text}
                            onBlur={e => { onUpdate({ text: e.target.value }); setEditing(false); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { onUpdate({ text: e.currentTarget.value }); setEditing(false); } }}
                        />
                    </foreignObject>
                ) : text ? (
                    <text x={px + 8} y={py + 18} fontSize={fontSize} fill={fontColor} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                        {text}
                    </text>
                ) : null}
            </g>
        );
    }

    // 'note' and 'text' — both use a rect + text, 'text' has transparent fill
    const noteFill = ann.type === 'text' ? 'transparent' : fill;
    const noteStroke = ann.type === 'text' ? 'none' : stroke;

    return (
        <g {...commonProps} className={selectedAnn ? styles.annotationSelected : ''}>
            {ann.type === 'note' && (
                <rect x={px} y={py} width={pw} height={ph}
                    fill={noteFill} stroke={noteStroke} strokeWidth={strokeW} rx={4} ry={4} />
            )}
            {editing ? (
                <foreignObject x={px + 4} y={py + 2} width={Math.max(60, pw - 8)} height={Math.max(30, ph - 4)}>
                    <input
                        ref={(el: HTMLInputElement | null) => el?.focus()}
                        style={{
                            width: '100%', height: '100%', border: 'none',
                            background: 'transparent', fontSize, color: fontColor,
                            outline: 'none', fontFamily: 'inherit',
                        }}
                        defaultValue={text}
                        onBlur={e => { onUpdate({ text: e.target.value }); setEditing(false); }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { onUpdate({ text: e.currentTarget.value }); setEditing(false); } }}
                    />
                </foreignObject>
            ) : text ? (
                <text x={px + 6} y={py + fontSize + 2} fontSize={fontSize} fill={fontColor}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {text}
                </text>
            ) : (
                // Placeholder hint (only 'note' and 'text' reach this branch)
                <text x={px + 6} y={py + fontSize + 2} fontSize={fontSize - 1} fill="#aaa"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {ann.type === 'note' ? 'Note' : 'Text'}
                </text>
            )}
        </g>
    );
}

// ── ChartAnnotationLayer ──────────────────────────────────────────────────────

export function ChartAnnotationLayer({
    annotations,
    frameW,
    frameH,
    isChartSelected,
    onUpdate,
    onDelete,
}: ChartAnnotationLayerProps) {
    const handleUpdate = useCallback((id: string, patch: Partial<ChartAnnotation>) => {
        onUpdate(id, patch);
    }, [onUpdate]);

    if (!annotations || annotations.length === 0) return null;

    return (
        <svg
            className={styles.annotationLayer}
            width={frameW}
            height={frameH}
            style={{ position: 'absolute', inset: 0, pointerEvents: isChartSelected ? 'all' : 'none' }}
        >
            {annotations.map(ann => (
                <AnnotationItem
                    key={ann.id}
                    ann={ann}
                    frameW={frameW}
                    frameH={frameH}
                    isChartSelected={isChartSelected}
                    onUpdate={(patch) => handleUpdate(ann.id, patch)}
                    onDelete={() => onDelete(ann.id)}
                />
            ))}
        </svg>
    );
}
