'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { CellProps } from '../types';
import type { ChartDef, ChartAnnotation } from './chartTypes';
import { ChartRenderer } from './ChartRenderer';
import { ChartAnnotationLayer } from './ChartAnnotationLayer';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import styles from './charts.module.css';
import animStyles from './chartAnimation.module.css';

const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type ResizeHandle = typeof RESIZE_HANDLES[number];

interface ChartFrameProps {
    def: ChartDef;
    data: Map<string, CellProps>;
    isSelected: boolean;
    onSelect: () => void;
    onUpdate: (patch: Partial<ChartDef>) => void;
    onDelete: () => void;
    containerRef: React.RefObject<HTMLDivElement | null>;
    /** Forwarded ref to the frame element — used by Phase 5 export utilities. */
    frameRef?: React.RefObject<HTMLDivElement | null>;
}

export function ChartFrame({
    def,
    data,
    isSelected,
    onSelect,
    onUpdate,
    onDelete,
    containerRef,
    frameRef,
}: ChartFrameProps) {
    const flags = useFeatureFlags();
    const internalRef = useRef<HTMLDivElement | null>(null);
    const resolvedFrameRef = frameRef ?? internalRef;

    const dragState = useRef<{
        startMouseX: number;
        startMouseY: number;
        startX: number;
        startY: number;
    } | null>(null);

    const resizeState = useRef<{
        handle: ResizeHandle;
        startMouseX: number;
        startMouseY: number;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
    } | null>(null);

    // Track frame pixel dimensions for annotation positioning
    const [frameDims, setFrameDims] = useState({ w: def.w, h: def.h });
    useEffect(() => {
        setFrameDims({ w: def.w, h: def.h });
    }, [def.w, def.h]);

    // Keyboard Delete handler when selected
    useEffect(() => {
        if (!isSelected) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            const active = document.activeElement as HTMLElement | null;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
            onDelete();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isSelected, onDelete]);

    function handleBodyMouseDown(e: React.MouseEvent) {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect();

        const container = containerRef.current;
        if (!container) return;

        dragState.current = {
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startX: def.x,
            startY: def.y,
        };

        function onMove(me: MouseEvent) {
            if (!dragState.current) return;
            const dx = me.clientX - dragState.current.startMouseX;
            const dy = me.clientY - dragState.current.startMouseY;
            const newX = Math.max(0, dragState.current.startX + dx);
            const newY = Math.max(0, dragState.current.startY + dy);
            onUpdate({ x: newX, y: newY });
        }

        function onUp() {
            dragState.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    function handleResizeMouseDown(e: React.MouseEvent, handle: ResizeHandle) {
        e.stopPropagation();
        e.preventDefault();

        resizeState.current = {
            handle,
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startX: def.x,
            startY: def.y,
            startW: def.w,
            startH: def.h,
        };

        function onMove(me: MouseEvent) {
            if (!resizeState.current) return;
            const { handle: h, startMouseX, startMouseY, startX, startY, startW, startH } = resizeState.current;
            const dx = me.clientX - startMouseX;
            const dy = me.clientY - startMouseY;

            let newX = startX, newY = startY, newW = startW, newH = startH;

            if (h.includes('e')) newW = Math.max(120, startW + dx);
            if (h.includes('s')) newH = Math.max(80, startH + dy);
            if (h.includes('w')) { newX = startX + dx; newW = Math.max(120, startW - dx); }
            if (h.includes('n')) { newY = startY + dy; newH = Math.max(80, startH - dy); }

            onUpdate({ x: newX, y: newY, w: newW, h: newH });
        }

        function onUp() {
            resizeState.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    // ── Phase 5: Annotation handlers ─────────────────────────────────────────

    function handleAnnotationUpdate(annId: string, patch: Partial<ChartAnnotation>) {
        if (!flags.sheetsChartsPhase5) return;
        const annotations = (def.annotations ?? []).map(a =>
            a.id === annId ? { ...a, ...patch } : a,
        );
        onUpdate({ annotations });
    }

    function handleAnnotationDelete(annId: string) {
        if (!flags.sheetsChartsPhase5) return;
        const annotations = (def.annotations ?? []).filter(a => a.id !== annId);
        onUpdate({ annotations });
    }

    // ── Phase 5: Animation class resolution ───────────────────────────────────

    const animCssStyle: Record<string, string> = {};
    let animClassName = '';

    if (flags.sheetsChartsPhase5 && def.animation && def.animation.mode !== 'none') {
        const { mode, durationMs = 600, delayMs = 150 } = def.animation;
        animCssStyle['--anim-duration'] = `${durationMs}ms`;
        animCssStyle['--anim-delay'] = `${delayMs}ms`;

        if (mode === 'reveal-series') animClassName = animStyles.revealSeries;
        else if (mode === 'highlight-points') animClassName = animStyles.highlightPoints;
        else if (mode === 'presentation-transition') animClassName = animStyles.presentationTransition;
    }

    const frameStyle: React.CSSProperties = {
        left: def.x,
        top: def.y,
        width: def.w,
        height: def.h,
    };

    return (
        <div
            ref={resolvedFrameRef as React.RefObject<HTMLDivElement>}
            className={`${styles.chartFrame} ${isSelected ? styles.chartFrameSelected : ''}`}
            style={frameStyle}
            data-chart-id={def.id}
            onMouseDown={handleBodyMouseDown}
        >
            <div
                className={`${styles.chartContent} ${animClassName}`}
                style={animCssStyle}
            >
                <ChartRenderer def={def} data={data} />
            </div>

            {/* Phase 5: Annotation overlay */}
            {flags.sheetsChartsPhase5 && (
                <ChartAnnotationLayer
                    annotations={def.annotations ?? []}
                    frameW={frameDims.w}
                    frameH={frameDims.h}
                    isChartSelected={isSelected}
                    onUpdate={handleAnnotationUpdate}
                    onDelete={handleAnnotationDelete}
                />
            )}

            {isSelected && RESIZE_HANDLES.map(handle => (
                <div
                    key={handle}
                    className={styles.resizeHandle}
                    data-handle={handle}
                    onMouseDown={(e) => handleResizeMouseDown(e, handle)}
                />
            ))}
        </div>
    );
}
