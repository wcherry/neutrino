'use client';

import React, { useEffect, useRef } from 'react';
import { ArrowDownAZ, ArrowUpZA, ArrowDown01, ArrowUp10, Filter, X, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Trash2, Eraser, EyeOff } from 'lucide-react';
import styles from './SheetContextMenu.module.css';

export interface HeaderContextMenuProps {
    x: number;
    y: number;
    type: 'col' | 'row';
    count?: number;
    hasFilter?: boolean;
    onSortAsc: () => void;
    onSortDesc: () => void;
    onFilter?: () => void;
    onClearFilter?: () => void;
    onInsertBefore: () => void;
    onInsertAfter: () => void;
    onDelete: () => void;
    onClear: () => void;
    onHide: () => void;
    onClose: () => void;
}

export function HeaderContextMenu({
    x, y, type, count = 1, hasFilter,
    onSortAsc, onSortDesc,
    onFilter, onClearFilter,
    onInsertBefore, onInsertAfter,
    onDelete, onClear, onHide,
    onClose,
}: HeaderContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onPointerDown(e: PointerEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose]);

    const menuWidth = 220;
    const menuHeight = 320;
    const left = Math.min(x, window.innerWidth - menuWidth - 8);
    const top = Math.min(y, window.innerHeight - menuHeight - 8);

    function run(fn: () => void) {
        fn();
        onClose();
    }

    const plural = count > 1;
    const noun = type === 'col'
        ? (plural ? 'columns' : 'column')
        : (plural ? 'rows' : 'row');

    return (
        <div
            ref={ref}
            className={styles.menu}
            style={{ left, top }}
            role="menu"
            aria-label="Header options"
            onContextMenu={e => e.preventDefault()}
        >
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onSortAsc)}
            >
                <span className={styles.itemIcon}>
                    {type === 'col' ? <ArrowDownAZ size={14} /> : <ArrowDown01 size={14} />}
                </span>
                <span className={styles.itemLabel}>
                    {type === 'col' ? 'Sort A → Z' : 'Sort ascending'}
                </span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onSortDesc)}
            >
                <span className={styles.itemIcon}>
                    {type === 'col' ? <ArrowUpZA size={14} /> : <ArrowUp10 size={14} />}
                </span>
                <span className={styles.itemLabel}>
                    {type === 'col' ? 'Sort Z → A' : 'Sort descending'}
                </span>
            </button>

            {type === 'col' && (
                <>
                    <div className={styles.separator} role="separator" />
                    {onFilter && (
                        <button
                            type="button"
                            role="menuitem"
                            className={styles.item}
                            onClick={() => { onFilter(); onClose(); }}
                        >
                            <span className={styles.itemIcon}><Filter size={14} /></span>
                            <span className={styles.itemLabel}>Filter by values…</span>
                        </button>
                    )}
                    {hasFilter && onClearFilter && (
                        <button
                            type="button"
                            role="menuitem"
                            className={styles.item}
                            onClick={() => run(onClearFilter)}
                        >
                            <span className={styles.itemIcon}><X size={14} /></span>
                            <span className={styles.itemLabel}>Clear filter</span>
                        </button>
                    )}
                </>
            )}

            <div className={styles.separator} role="separator" />

            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onInsertBefore)}
            >
                <span className={styles.itemIcon}>
                    {type === 'col' ? <ArrowLeft size={14} /> : <ArrowUp size={14} />}
                </span>
                <span className={styles.itemLabel}>
                    {type === 'col' ? `Insert ${noun} left` : `Insert ${noun} above`}
                </span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onInsertAfter)}
            >
                <span className={styles.itemIcon}>
                    {type === 'col' ? <ArrowRight size={14} /> : <ArrowDown size={14} />}
                </span>
                <span className={styles.itemLabel}>
                    {type === 'col' ? `Insert ${noun} right` : `Insert ${noun} below`}
                </span>
            </button>

            <div className={styles.separator} role="separator" />

            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onDelete)}
            >
                <span className={styles.itemIcon}><Trash2 size={14} /></span>
                <span className={styles.itemLabel}>Delete {noun}</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onClear)}
            >
                <span className={styles.itemIcon}><Eraser size={14} /></span>
                <span className={styles.itemLabel}>Clear {noun}</span>
            </button>

            <div className={styles.separator} role="separator" />

            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onHide)}
            >
                <span className={styles.itemIcon}><EyeOff size={14} /></span>
                <span className={styles.itemLabel}>Hide {noun}</span>
            </button>
        </div>
    );
}
