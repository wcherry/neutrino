'use client';

import React, { useRef, useState, useEffect } from 'react';
import styles from '../page.module.css';

const TAB_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

/**
 * Black or white, whichever reads better on `hex`.
 *
 * A tab carrying a colour is the one place in the bar whose background does not
 * come from the theme, so its foreground must not either. `var(--color-text)`
 * is near-white under a dark theme, and every one of `TAB_COLORS` is light
 * enough that white fails on all seven — 4.2:1 at best on the violet, 1.9:1 on
 * the yellow. Deciding from the colour itself holds for all of them, and for a
 * `tabColor` that came out of somebody's .xlsx, which can be any colour at all.
 *
 * Luminance and the contrast ratio are WCAG 2.x. Anything unparseable falls
 * back to the theme's own text colour, which is right for a tab with no colour.
 */
export function readableTextOn(hex: string | null): string | undefined {
    const rgb = parseHexColor(hex);
    if (!rgb) return undefined;

    // Relative luminance, sRGB gamma-expanded per channel.
    const channel = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

    // Contrast against white is (1.05 / (lum + 0.05)), against black
    // ((lum + 0.05) / 0.05); they cross at lum ≈ 0.1791.
    return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#000000' : '#ffffff';
}

/** `#rgb` / `#rrggbb` → `[r, g, b]`, or null for anything else. */
function parseHexColor(hex: string | null): [number, number, number] | null {
    if (!hex) return null;
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const d = m[1];
    const full = d.length === 3 ? d[0] + d[0] + d[1] + d[1] + d[2] + d[2] : d;
    return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
    ];
}

type Props = {
    sheetNames: string[];
    sheetColors: (string | null)[];
    setSheetColors: React.Dispatch<React.SetStateAction<(string | null)[]>>;
    activeSheetIndex: number;
    dirtyRef: React.MutableRefObject<boolean>;
    onSwitchSheet: (index: number) => void;
    onAddSheet: () => void;
    onDeleteSheet: (index: number) => void;
    onDuplicateSheet: (index: number) => void;
    onMoveSheet: (index: number, direction: 'left' | 'right') => void;
    onCommitRename: (index: number, value: string) => void;
    readOnly?: boolean;
};

export function SheetTabBar({
    sheetNames,
    sheetColors,
    setSheetColors,
    activeSheetIndex,
    dirtyRef,
    onSwitchSheet,
    onAddSheet,
    onDeleteSheet,
    onDuplicateSheet,
    onMoveSheet,
    onCommitRename,
    readOnly = false,
}: Props) {
    const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [contextMenu, setContextMenu] = useState<{
        x: number; y: number; index: number; deleteConfirm: boolean;
    } | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    // Close context menu on outside click.
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        if (contextMenu) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [contextMenu]);

    const commitRename = (index: number, value: string) => {
        onCommitRename(index, value);
        setRenamingIndex(null);
    };

    return (
        <>
            <div className={styles.sheetTabBar}>
                {sheetNames.map((name, i) => {
                    const tabColor = sheetColors[i] ?? null;
                    return (
                        <div
                            key={i}
                            className={`${styles.sheetTab} ${i === activeSheetIndex ? styles.sheetTabActive : ''}`}
                            style={tabColor ? { backgroundColor: tabColor, color: readableTextOn(tabColor) } : undefined}
                            onClick={() => { if (renamingIndex !== i) onSwitchSheet(i); }}
                            onDoubleClick={readOnly ? undefined : () => { setRenamingIndex(i); setRenameValue(name); }}
                            onContextMenu={readOnly ? undefined : e => {
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, index: i, deleteConfirm: false });
                            }}
                        >
                            {renamingIndex === i ? (
                                <input
                                    autoFocus
                                    data-testid="sheet-tab-rename-input"
                                    className={styles.sheetTabInput}
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onBlur={() => commitRename(i, renameValue)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') commitRename(i, renameValue);
                                        if (e.key === 'Escape') setRenamingIndex(null);
                                        e.stopPropagation();
                                    }}
                                    onClick={e => e.stopPropagation()}
                                />
                            ) : name}
                        </div>
                    );
                })}
                {!readOnly && <button className={styles.sheetTabAdd} onClick={onAddSheet} title="Add sheet">+</button>}
            </div>

            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className={styles.tabContextMenu}
                    style={{ bottom: '32px', left: contextMenu.x }}
                >
                    {contextMenu.deleteConfirm ? (
                        <div className={styles.tabContextMenuConfirm}>
                            <span>Delete &ldquo;{sheetNames[contextMenu.index]}&rdquo;?</span>
                            <div className={styles.tabContextMenuConfirmActions}>
                                <button
                                    className={styles.tabContextMenuConfirmDelete}
                                    onClick={() => { onDeleteSheet(contextMenu.index); setContextMenu(null); }}
                                >Delete</button>
                                <button
                                    className={styles.tabContextMenuConfirmCancel}
                                    onClick={() => setContextMenu(prev => prev ? { ...prev, deleteConfirm: false } : null)}
                                >Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <button className={styles.tabContextMenuItem} onClick={() => {
                                setRenamingIndex(contextMenu.index);
                                setRenameValue(sheetNames[contextMenu.index]);
                                setContextMenu(null);
                            }}>Rename</button>
                            <button
                                className={styles.tabContextMenuItem}
                                disabled={contextMenu.index === 0}
                                onClick={() => {
                                    onMoveSheet(contextMenu.index, 'left');
                                    setContextMenu(prev => prev ? { ...prev, index: prev.index - 1 } : null);
                                }}
                            >Move left</button>
                            <button
                                className={styles.tabContextMenuItem}
                                disabled={contextMenu.index === sheetNames.length - 1}
                                onClick={() => {
                                    onMoveSheet(contextMenu.index, 'right');
                                    setContextMenu(prev => prev ? { ...prev, index: prev.index + 1 } : null);
                                }}
                            >Move right</button>
                            <button className={styles.tabContextMenuItem} onClick={() => {
                                onDuplicateSheet(contextMenu.index);
                                setContextMenu(null);
                            }}>Duplicate</button>
                            <div className={styles.tabContextMenuDivider} />
                            <div className={styles.tabContextMenuColorRow}>
                                {TAB_COLORS.map(color => (
                                    <button
                                        key={color}
                                        className={`${styles.tabContextMenuColorSwatch} ${sheetColors[contextMenu.index] === color ? styles.tabContextMenuColorSwatchSelected : ''}`}
                                        style={{ background: color }}
                                        title={color}
                                        onClick={() => {
                                            setSheetColors(prev => prev.map((c, i) => i === contextMenu.index ? color : c));
                                            dirtyRef.current = true;
                                            setContextMenu(null);
                                        }}
                                    />
                                ))}
                                <button
                                    className={`${styles.tabContextMenuColorSwatch} ${styles.tabContextMenuColorSwatchNone} ${!sheetColors[contextMenu.index] ? styles.tabContextMenuColorSwatchSelected : ''}`}
                                    title="No color"
                                    onClick={() => {
                                        setSheetColors(prev => prev.map((c, i) => i === contextMenu.index ? null : c));
                                        dirtyRef.current = true;
                                        setContextMenu(null);
                                    }}
                                >✕</button>
                            </div>
                            <div className={styles.tabContextMenuDivider} />
                            <button
                                className={`${styles.tabContextMenuItem} ${styles.tabContextMenuDelete}`}
                                disabled={sheetNames.length <= 1}
                                onClick={() => setContextMenu(prev => prev ? { ...prev, deleteConfirm: true } : null)}
                            >Delete</button>
                        </>
                    )}
                </div>
            )}
        </>
    );
}
