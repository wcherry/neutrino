'use client';

import React, { useState, useMemo } from 'react';
import type { CellProps } from './types';
import { numToAlpha } from './utils';
import styles from './page.module.css';

interface FilterDialogProps {
    colIndex: number; // 0-based
    data: Map<string, CellProps>;
    currentFilter: Set<string> | undefined;
    onApply: (colIndex: number, values: Set<string> | null) => void;
    onClose: () => void;
}

export function FilterDialog({ colIndex, data, currentFilter, onApply, onClose }: FilterDialogProps) {
    const colLetter = numToAlpha(colIndex + 1);

    const uniqueValues = useMemo(() => {
        const values = new Set<string>();
        values.add(''); // always include blanks option
        for (const [id, cell] of data) {
            const m = id.match(/^([A-Z]+)\d+$/);
            if (m && m[1] === colLetter) {
                values.add(cell.raw ?? '');
            }
        }
        return Array.from(values).sort((a, b) => {
            if (a === '' && b !== '') return 1;
            if (b === '' && a !== '') return -1;
            const an = parseFloat(a);
            const bn = parseFloat(b);
            if (!isNaN(an) && !isNaN(bn)) return an - bn;
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });
    }, [data, colLetter]);

    const [selected, setSelected] = useState<Set<string>>(
        currentFilter ? new Set(currentFilter) : new Set(uniqueValues),
    );
    const [search, setSearch] = useState('');

    const visibleValues = search
        ? uniqueValues.filter(v => (v === '' ? '(Blanks)' : v).toLowerCase().includes(search.toLowerCase()))
        : uniqueValues;

    const allVisible = visibleValues.every(v => selected.has(v));

    function toggle(v: string) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(v)) next.delete(v);
            else next.add(v);
            return next;
        });
    }

    function selectAll() {
        setSelected(prev => {
            const next = new Set(prev);
            for (const v of visibleValues) next.add(v);
            return next;
        });
    }

    function clearAll() {
        setSelected(prev => {
            const next = new Set(prev);
            for (const v of visibleValues) next.delete(v);
            return next;
        });
    }

    return (
        <div
            className={styles.dialogOverlay}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className={styles.dialogBox} style={{ minWidth: 300, maxWidth: 380 }}>
                <div className={styles.dialogTitle}>Filter column {colLetter}</div>

                <input
                    type="text"
                    placeholder="Search values…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                    style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--color-border)',
                        fontSize: 13,
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                    }}
                />

                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                    <button
                        type="button"
                        onClick={selectAll}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent, #0064ff)', padding: 0 }}
                    >
                        Select all
                    </button>
                    <button
                        type="button"
                        onClick={clearAll}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent, #0064ff)', padding: 0 }}
                    >
                        Clear all
                    </button>
                </div>

                <div style={{ overflowY: 'auto', maxHeight: 240, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {visibleValues.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '4px 0' }}>No values</div>
                    ) : visibleValues.map(v => (
                        <label
                            key={v}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 2px', fontSize: 13, borderRadius: 4 }}
                        >
                            <input
                                type="checkbox"
                                checked={selected.has(v)}
                                onChange={() => toggle(v)}
                            />
                            <span style={{ color: v === '' ? 'var(--color-text-muted)' : undefined }}>
                                {v === '' ? '(Blanks)' : v}
                            </span>
                        </label>
                    ))}
                </div>

                <div className={styles.dialogActions}>
                    <button type="button" className={styles.dialogBtnSecondary} onClick={onClose}>
                        Cancel
                    </button>
                    {currentFilter && (
                        <button
                            type="button"
                            className={styles.dialogBtnSecondary}
                            onClick={() => { onApply(colIndex, null); onClose(); }}
                        >
                            Clear filter
                        </button>
                    )}
                    <button
                        type="button"
                        className={styles.dialogBtnPrimary}
                        onClick={() => { onApply(colIndex, selected); onClose(); }}
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
