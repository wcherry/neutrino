'use client';

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FunctionMeta } from '../formula';
import styles from '../page.module.css';

/** Gap between the anchor (cell or formula bar) and the helper. */
const GAP = 4;
/** Keep the helper this far from the viewport edges. */
const MARGIN = 8;
/** Must match .functionDropdown width in page.module.css. */
const WIDTH = 440;
const MAX_HEIGHT = 280;
/** Below this much free space we flip the helper above the anchor instead. */
const MIN_HEIGHT = 120;

export type HelperPosition = {
    left: number;
    /** Set when the helper opens downwards (the common case). */
    top?: number;
    /** Set when the helper is flipped above the anchor, so its bottom edge hugs it. */
    bottom?: number;
    maxHeight: number;
};

/**
 * Places the helper under `anchor`, flipping it above when there is not enough
 * room below, and clamping it to the viewport horizontally.
 */
export function computeHelperPosition(
    anchor: { top: number; bottom: number; left: number },
    viewport: { width: number; height: number },
): HelperPosition {
    const spaceBelow = viewport.height - anchor.bottom - GAP - MARGIN;
    const spaceAbove = anchor.top - GAP - MARGIN;
    const flip = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow;
    const space = flip ? spaceAbove : spaceBelow;

    const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - WIDTH - MARGIN));
    const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, space));

    return flip
        ? { left, bottom: viewport.height - anchor.top + GAP, maxHeight }
        : { left, top: anchor.bottom + GAP, maxHeight };
}

type Props = {
    functions: FunctionMeta[];
    /**
     * ID of the cell being edited. The helper hangs off that cell so the
     * suggestions sit next to what the user is looking at. Cells are
     * virtualised, so the element is absent when the cell is scrolled out of
     * view — `fallbackRef` takes over then.
     */
    anchorCellId?: string;
    /** Formula input wrapper — anchor of last resort, also treated as "inside". */
    fallbackRef: React.RefObject<HTMLElement | null>;
    onSelect: (fnName: string) => void;
    /** Called on a mousedown outside both the helper and the formula bar. */
    onDismiss?: () => void;
};

export function FunctionHelper({ functions, anchorCellId, fallbackRef, onSelect, onDismiss }: Props) {
    const [position, setPosition] = useState<HelperPosition | null>(null);
    const [helperEl, setHelperEl] = useState<HTMLDivElement | null>(null);

    const reposition = useCallback(() => {
        const anchorEl = (anchorCellId ? document.getElementById(anchorCellId) : null) ?? fallbackRef.current;
        if (!anchorEl) {
            setPosition(null);
            return;
        }
        const rect = anchorEl.getBoundingClientRect();
        setPosition(computeHelperPosition(rect, { width: window.innerWidth, height: window.innerHeight }));
    }, [anchorCellId, fallbackRef]);

    useLayoutEffect(() => {
        reposition();
    }, [reposition, functions.length]);

    // The grid, not the window, is what scrolls — listen in the capture phase so
    // scrolls inside the grid container reposition the helper too.
    useEffect(() => {
        // Layout effects of a child run before the parent host element's ref is
        // attached, so the fallback anchor is only readable from here on mount.
        reposition();
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [reposition]);

    useEffect(() => {
        if (!onDismiss) return;
        const handle = (e: MouseEvent) => {
            const target = e.target as Node;
            if (helperEl?.contains(target)) return;
            if (fallbackRef.current?.contains(target)) return;
            onDismiss();
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [onDismiss, helperEl, fallbackRef]);

    if (typeof document === 'undefined' || !position) return null;

    return createPortal(
        <div
            ref={setHelperEl}
            className={styles.functionDropdown}
            data-testid="function-helper"
            style={{
                left: position.left,
                top: position.top,
                bottom: position.bottom,
                maxHeight: position.maxHeight,
            }}
        >
            {functions.map(fn => (
                <button
                    key={fn.name}
                    className={styles.functionItem}
                    onMouseDown={e => {
                        e.preventDefault();
                        onSelect(fn.name);
                    }}
                    type="button"
                >
                    <span className={styles.functionSignature}>
                        <span className={styles.functionName}>{fn.name}</span>
                        {fn.signature.slice(fn.name.length)}
                    </span>
                    <span className={styles.functionDescription}>{fn.description}</span>
                </button>
            ))}
        </div>,
        document.body,
    );
}
