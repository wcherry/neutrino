'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { CellProps } from './types';
import styles from './page.module.css';

interface FindReplaceDialogProps {
    data: Map<string, CellProps>;
    initialMode?: 'find' | 'replace';
    onNavigateTo: (cellId: string) => void;
    onReplaceOne: (cellId: string, newRaw: string) => void;
    onReplaceAll: (replacements: Map<string, string>) => void;
    onClose: () => void;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function computeMatches(
    data: Map<string, CellProps>,
    findText: string,
    matchCase: boolean,
    matchEntireCell: boolean,
): string[] {
    if (!findText) return [];
    const needle = matchCase ? findText : findText.toLowerCase();
    const ids = Array.from(data.keys()).sort((a, b) => {
        const ma = a.match(/^([A-Z]+)(\d+)$/);
        const mb = b.match(/^([A-Z]+)(\d+)$/);
        if (!ma || !mb) return 0;
        const rowDiff = parseInt(ma[2]) - parseInt(mb[2]);
        if (rowDiff !== 0) return rowDiff;
        return a.localeCompare(b);
    });
    const matches: string[] = [];
    for (const id of ids) {
        const cell = data.get(id)!;
        const raw = cell.raw ?? '';
        const haystack = matchCase ? raw : raw.toLowerCase();
        if (matchEntireCell ? haystack === needle : haystack.includes(needle)) {
            matches.push(id);
        }
    }
    return matches;
}

export function FindReplaceDialog({
    data,
    initialMode = 'find',
    onNavigateTo,
    onReplaceOne,
    onReplaceAll,
    onClose,
}: FindReplaceDialogProps) {
    const [findText, setFindText] = useState('');
    const [replaceText, setReplaceText] = useState('');
    const [matchCase, setMatchCase] = useState(false);
    const [matchEntireCell, setMatchEntireCell] = useState(false);
    const [showReplace, setShowReplace] = useState(initialMode === 'replace');
    const [currentIndex, setCurrentIndex] = useState(0);
    const findInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        findInputRef.current?.focus();
    }, []);

    const matches = useMemo(
        () => computeMatches(data, findText, matchCase, matchEntireCell),
        [data, findText, matchCase, matchEntireCell],
    );

    // When search params change, jump to first match
    useEffect(() => {
        setCurrentIndex(0);
        if (matches.length > 0) onNavigateTo(matches[0]);
    // Intentionally excludes `matches` — we only want to reset on param change,
    // not on every data update (e.g. after a replacement).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [findText, matchCase, matchEntireCell]);

    const safeIndex = matches.length === 0 ? 0 : Math.min(currentIndex, matches.length - 1);

    const navigateNext = useCallback(() => {
        if (matches.length === 0) return;
        const next = (safeIndex + 1) % matches.length;
        setCurrentIndex(next);
        onNavigateTo(matches[next]);
    }, [matches, safeIndex, onNavigateTo]);

    const navigatePrev = useCallback(() => {
        if (matches.length === 0) return;
        const prev = (safeIndex - 1 + matches.length) % matches.length;
        setCurrentIndex(prev);
        onNavigateTo(matches[prev]);
    }, [matches, safeIndex, onNavigateTo]);

    const handleReplaceOne = useCallback(() => {
        if (matches.length === 0) return;
        const cellId = matches[safeIndex];
        const cell = data.get(cellId);
        if (!cell) return;
        const raw = cell.raw ?? '';
        const pattern = new RegExp(escapeRegex(findText), matchCase ? '' : 'i');
        const newRaw = raw.replace(pattern, replaceText);
        onReplaceOne(cellId, newRaw);
        // After replace, data will update and matches recompute; clamp index.
        const nextIndex = safeIndex >= matches.length - 1 ? 0 : safeIndex;
        setCurrentIndex(nextIndex);
    }, [matches, safeIndex, data, findText, replaceText, matchCase, onReplaceOne]);

    const handleReplaceAll = useCallback(() => {
        if (matches.length === 0) return;
        const replacements = new Map<string, string>();
        const pattern = new RegExp(escapeRegex(findText), matchCase ? 'g' : 'gi');
        for (const cellId of matches) {
            const cell = data.get(cellId);
            if (!cell) continue;
            replacements.set(cellId, (cell.raw ?? '').replace(pattern, replaceText));
        }
        onReplaceAll(replacements);
        setCurrentIndex(0);
    }, [matches, data, findText, replaceText, matchCase, onReplaceAll]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            navigateNext();
        } else if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            navigatePrev();
        }
    }, [onClose, navigateNext, navigatePrev]);

    const matchLabel = findText
        ? matches.length === 0
            ? 'No matches'
            : `${safeIndex + 1} of ${matches.length}`
        : '';

    return (
        <div
            className={styles.dialogOverlay}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className={styles.dialogBox}
                style={{ minWidth: 360, maxWidth: 440 }}
                onKeyDown={handleKeyDown}
            >
                <div className={styles.dialogTitle}>
                    {showReplace ? 'Find and Replace' : 'Find'}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <input
                                ref={findInputRef}
                                type="text"
                                placeholder="Find…"
                                value={findText}
                                onChange={e => setFindText(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '6px 10px',
                                    paddingRight: matchLabel ? 80 : 10,
                                    borderRadius: 6,
                                    border: '1px solid var(--color-border)',
                                    fontSize: 13,
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                    background: 'var(--color-surface-raised, #f9f9fb)',
                                    color: 'var(--color-text)',
                                }}
                            />
                            {matchLabel && (
                                <span style={{
                                    position: 'absolute',
                                    right: 8,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    fontSize: 11,
                                    color: matches.length === 0 ? '#dc2626' : 'var(--color-text-muted)',
                                    pointerEvents: 'none',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {matchLabel}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={navigatePrev}
                            disabled={matches.length === 0}
                            title="Previous match (Shift+Enter)"
                            style={{
                                padding: '6px 10px',
                                border: '1px solid var(--color-border)',
                                borderRadius: 6,
                                background: 'none',
                                cursor: matches.length === 0 ? 'default' : 'pointer',
                                fontSize: 14,
                                color: matches.length === 0 ? 'var(--color-text-muted)' : 'var(--color-text)',
                                minWidth: 32,
                            }}
                        >↑</button>
                        <button
                            type="button"
                            onClick={navigateNext}
                            disabled={matches.length === 0}
                            title="Next match (Enter)"
                            style={{
                                padding: '6px 10px',
                                border: '1px solid var(--color-border)',
                                borderRadius: 6,
                                background: 'none',
                                cursor: matches.length === 0 ? 'default' : 'pointer',
                                fontSize: 14,
                                color: matches.length === 0 ? 'var(--color-text-muted)' : 'var(--color-text)',
                                minWidth: 32,
                            }}
                        >↓</button>
                    </div>

                    {showReplace && (
                        <input
                            type="text"
                            placeholder="Replace with…"
                            value={replaceText}
                            onChange={e => setReplaceText(e.target.value)}
                            style={{
                                padding: '6px 10px',
                                borderRadius: 6,
                                border: '1px solid var(--color-border)',
                                fontSize: 13,
                                outline: 'none',
                                boxSizing: 'border-box',
                                width: '100%',
                                background: 'var(--color-surface-raised, #f9f9fb)',
                                color: 'var(--color-text)',
                            }}
                        />
                    )}

                    <div style={{ display: 'flex', gap: 16, fontSize: 12, alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--color-text)' }}>
                            <input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)} />
                            Match case
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--color-text)' }}>
                            <input type="checkbox" checked={matchEntireCell} onChange={e => setMatchEntireCell(e.target.checked)} />
                            Entire cell
                        </label>
                        {!showReplace && (
                            <button
                                type="button"
                                onClick={() => setShowReplace(true)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--color-accent, #0064ff)',
                                    padding: 0,
                                    fontSize: 12,
                                }}
                            >
                                Replace…
                            </button>
                        )}
                    </div>
                </div>

                <div className={styles.dialogActions}>
                    <button type="button" className={styles.dialogBtnSecondary} onClick={onClose}>
                        Close
                    </button>
                    {showReplace && (
                        <>
                            <button
                                type="button"
                                className={styles.dialogBtnSecondary}
                                onClick={handleReplaceOne}
                                disabled={matches.length === 0}
                            >
                                Replace
                            </button>
                            <button
                                type="button"
                                className={styles.dialogBtnPrimary}
                                onClick={handleReplaceAll}
                                disabled={matches.length === 0}
                            >
                                Replace all
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
