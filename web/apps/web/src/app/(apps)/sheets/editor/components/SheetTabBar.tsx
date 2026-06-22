'use client';

import React, { useRef, useState, useEffect } from 'react';
import styles from '../page.module.css';

const TAB_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

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
                            style={tabColor ? { backgroundColor: tabColor } : undefined}
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
                                        className={styles.tabContextMenuColorSwatch}
                                        style={{ background: color, outline: sheetColors[contextMenu.index] === color ? '2px solid #000' : undefined }}
                                        title={color}
                                        onClick={() => {
                                            setSheetColors(prev => prev.map((c, i) => i === contextMenu.index ? color : c));
                                            dirtyRef.current = true;
                                            setContextMenu(null);
                                        }}
                                    />
                                ))}
                                <button
                                    className={styles.tabContextMenuColorSwatch}
                                    style={{ background: 'transparent', border: '1px dashed #aaa', outline: !sheetColors[contextMenu.index] ? '2px solid #000' : undefined }}
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
