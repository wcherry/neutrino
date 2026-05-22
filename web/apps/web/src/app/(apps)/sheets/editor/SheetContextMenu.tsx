'use client';

import React, { useEffect, useRef } from 'react';
import {
    Scissors, Copy, Clipboard,
    RowsIcon, Columns2, Trash2, Eraser,
} from 'lucide-react';
import styles from './SheetContextMenu.module.css';

export interface SheetContextMenuProps {
    x: number;
    y: number;
    cellId: string;
    selectedCells: Set<string>;
    cellValue: string;
    spellWord?: string;
    /**
     * Suggestions for spellWord.
     * undefined = dictionary still loading ("Checking…" shown)
     * [] = word is correct (no spell section shown)
     * [...] = misspelled — show suggestions
     */
    spellSuggestions?: string[];
    onApplySuggestion: (word: string) => void;
    onCut: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onInsertRowAbove: () => void;
    onInsertRowBelow: () => void;
    onInsertColLeft: () => void;
    onInsertColRight: () => void;
    onDeleteRow: () => void;
    onDeleteCol: () => void;
    onClearCells: () => void;
    onClose: () => void;
}

const MAX_SUGGESTIONS = 5;

export function SheetContextMenu({
    x,
    y,
    spellWord,
    spellSuggestions,
    onApplySuggestion,
    onCut,
    onCopy,
    onPaste,
    onInsertRowAbove,
    onInsertRowBelow,
    onInsertColLeft,
    onInsertColRight,
    onDeleteRow,
    onDeleteCol,
    onClearCells,
    onClose,
}: SheetContextMenuProps) {
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

    // Keep menu within viewport
    const menuWidth = 220;
    const menuHeight = 400;
    const left = Math.min(x, window.innerWidth - menuWidth - 8);
    const top = Math.min(y, window.innerHeight - menuHeight - 8);

    function run(fn: () => void) {
        fn();
        onClose();
    }

    const visibleSuggestions = spellSuggestions?.slice(0, MAX_SUGGESTIONS) ?? [];

    return (
        <div
            ref={ref}
            className={styles.menu}
            style={{ left, top }}
            role="menu"
            aria-label="Cell options"
            onContextMenu={e => e.preventDefault()}
        >
            {/* ── Spell-check section (shown whenever a misspelled word is detected) ── */}
            {!!spellWord && (
                <>
                    {spellSuggestions === undefined ? (
                        <div className={styles.checking}>Checking…</div>
                    ) : visibleSuggestions.length > 0 ? (
                        visibleSuggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                type="button"
                                role="menuitem"
                                className={[styles.item, styles.suggestion].join(' ')}
                                onClick={() => {
                                    onApplySuggestion(suggestion);
                                    onClose();
                                }}
                            >
                                <span className={styles.itemLabel}>{suggestion}</span>
                            </button>
                        ))
                    ) : (
                        <div className={styles.noSuggestions}>
                            Misspelling: <strong>{spellWord}</strong>
                        </div>
                    )}
                    <div className={styles.separator} role="separator" />
                </>
            )}

            {/* ── Clipboard ── */}
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onCut)}
            >
                <span className={styles.itemIcon}><Scissors size={14} /></span>
                <span className={styles.itemLabel}>Cut</span>
                <span className={styles.shortcut}>⌘X</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onCopy)}
            >
                <span className={styles.itemIcon}><Copy size={14} /></span>
                <span className={styles.itemLabel}>Copy</span>
                <span className={styles.shortcut}>⌘C</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onPaste)}
            >
                <span className={styles.itemIcon}><Clipboard size={14} /></span>
                <span className={styles.itemLabel}>Paste</span>
                <span className={styles.shortcut}>⌘V</span>
            </button>

            <div className={styles.separator} role="separator" />

            {/* ── Insert rows/cols ── */}
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onInsertRowAbove)}
            >
                <span className={styles.itemIcon}><RowsIcon size={14} /></span>
                <span className={styles.itemLabel}>Insert row above</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onInsertRowBelow)}
            >
                <span className={styles.itemIcon}><RowsIcon size={14} /></span>
                <span className={styles.itemLabel}>Insert row below</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onInsertColLeft)}
            >
                <span className={styles.itemIcon}><Columns2 size={14} /></span>
                <span className={styles.itemLabel}>Insert column left</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onInsertColRight)}
            >
                <span className={styles.itemIcon}><Columns2 size={14} /></span>
                <span className={styles.itemLabel}>Insert column right</span>
            </button>

            <div className={styles.separator} role="separator" />

            {/* ── Delete / clear ── */}
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onDeleteRow)}
            >
                <span className={styles.itemIcon}><Trash2 size={14} /></span>
                <span className={styles.itemLabel}>Delete row</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onDeleteCol)}
            >
                <span className={styles.itemIcon}><Trash2 size={14} /></span>
                <span className={styles.itemLabel}>Delete column</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => run(onClearCells)}
            >
                <span className={styles.itemIcon}><Eraser size={14} /></span>
                <span className={styles.itemLabel}>Clear cell(s)</span>
            </button>
        </div>
    );
}
