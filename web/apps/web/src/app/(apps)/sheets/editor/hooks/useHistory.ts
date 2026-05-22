'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { CellProps } from '../types';
import { MAX_HISTORY } from '../constants';
import { alphaToNum, numToAlpha } from '../utils';
import { applyPatch, buildReversePatch } from '../cellPatch';
import type { UndoPatch } from '../cellPatch';

// ── History entry types ───────────────────────────────────────────────────────
// The undo/redo stacks store either a legacy full-snapshot entry (for callers
// that haven't migrated yet) or a compact patch entry (for useCellEditing's
// per-keystroke operations).  Both cases are handled transparently by undo/redo.

type SnapshotEntry = { kind: 'snapshot'; map: Map<string, CellProps> };
type PatchEntry    = { kind: 'patch'; patch: UndoPatch };
type HistoryEntry  = SnapshotEntry | PatchEntry;

export function useHistory({
    dataRef,
    setData,
    setCurrentCell,
    setSelectionAnchor,
    setSelectionActive,
}: {
    dataRef: React.MutableRefObject<Map<string, CellProps>>;
    setData: React.Dispatch<React.SetStateAction<Map<string, CellProps>>>;
    setCurrentCell: React.Dispatch<React.SetStateAction<CellProps | undefined>>;
    setSelectionAnchor: React.Dispatch<React.SetStateAction<string | undefined>>;
    setSelectionActive: React.Dispatch<React.SetStateAction<string | undefined>>;
}) {
    const undoStackRef = useRef<HistoryEntry[]>([]);
    const redoStackRef = useRef<HistoryEntry[]>([]);
    const snapshotBeforeEditRef = useRef<Map<string, CellProps> | null>(null);
    const [historyLen, setHistoryLen] = useState({ undo: 0, redo: 0 });

    // Clears selection UI state and the pre-edit snapshot. Called by undo, redo,
    // and sheet switches so the editor never shows stale cell state.
    const clearSelectionState = useCallback(() => {
        setCurrentCell(undefined);
        setSelectionAnchor(undefined);
        setSelectionActive(undefined);
        snapshotBeforeEditRef.current = null;
    }, [setCurrentCell, setSelectionAnchor, setSelectionActive]);

    // Legacy full-snapshot push — kept for callers (clipboard, context menu, etc.)
    // that already hold a cloned Map and pass it here.
    const pushToUndo = useCallback((snapshot: Map<string, CellProps>) => {
        undoStackRef.current.push({ kind: 'snapshot', map: snapshot });
        if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
        redoStackRef.current = [];
        setHistoryLen({ undo: undoStackRef.current.length, redo: 0 });
    }, []);

    // Patch-based push — O(changedCells) instead of O(allCells).
    // The caller provides a UndoPatch with before/after values for only the
    // cells that were modified; undo restores `before`, redo re-applies `after`.
    const pushPatchToUndo = useCallback((patch: UndoPatch) => {
        undoStackRef.current.push({ kind: 'patch', patch });
        if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
        redoStackRef.current = [];
        setHistoryLen({ undo: undoStackRef.current.length, redo: 0 });
    }, []);

    // Helper: convert the current live data into a HistoryEntry for the redo stack.
    // We record a reverse patch against the ids that were affected so redo is also
    // patch-based (no full clone needed for redo pushes either).
    const makeRedoEntry = useCallback((entry: HistoryEntry): HistoryEntry => {
        if (entry.kind === 'patch') {
            // The redo entry re-applies `entry.patch.after`.
            // We need the current `before` values for those same ids.
            const before = buildReversePatch(dataRef.current, Object.keys(entry.patch.after));
            return { kind: 'patch', patch: { before, after: entry.patch.after } };
        }
        // For snapshot entries, still do a full clone (backward compat).
        return { kind: 'snapshot', map: new Map(dataRef.current) };
    }, [dataRef]);

    const undo = useCallback(() => {
        if (!undoStackRef.current.length) return;
        const entry = undoStackRef.current.pop()!;
        redoStackRef.current.push(makeRedoEntry(entry));
        if (entry.kind === 'patch') {
            setData(prev => applyPatch(prev, entry.patch.before));
        } else {
            setData(entry.map);
        }
        clearSelectionState();
        setHistoryLen({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
    }, [dataRef, setData, clearSelectionState, makeRedoEntry]);

    const redo = useCallback(() => {
        if (!redoStackRef.current.length) return;
        const entry = redoStackRef.current.pop()!;
        // Build the undo entry from current data before applying redo.
        if (entry.kind === 'patch') {
            const before = buildReversePatch(dataRef.current, Object.keys(entry.patch.after));
            undoStackRef.current.push({ kind: 'patch', patch: { before, after: entry.patch.after } });
            setData(prev => applyPatch(prev, entry.patch.after));
        } else {
            undoStackRef.current.push({ kind: 'snapshot', map: new Map(dataRef.current) });
            setData(entry.map);
        }
        clearSelectionState();
        setHistoryLen({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
    }, [dataRef, setData, clearSelectionState]);

    // Clears both history stacks AND selection — used when switching/deleting sheets
    // so undo history doesn't bleed across sheet boundaries.
    const resetHistoryAndSelection = useCallback(() => {
        clearSelectionState();
        undoStackRef.current = [];
        redoStackRef.current = [];
        setHistoryLen({ undo: 0, redo: 0 });
    }, [clearSelectionState]);

    // Keyboard shortcuts: Cmd/Ctrl+Z → undo, Cmd/Ctrl+Shift+Z / Y → redo, Cmd/Ctrl+A → select all
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const active = document.activeElement as HTMLElement | null;
            const isTextInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || !!active?.isContentEditable;
            if (e.key === 'z') {
                if (isTextInput) return;
                e.preventDefault();
                if (e.shiftKey) { redo(); } else { undo(); }
            } else if (e.key === 'y') {
                if (isTextInput) return;
                e.preventDefault();
                redo();
            } else if (e.key === 'a') {
                if (isTextInput) return;
                e.preventDefault();
                const cells = dataRef.current;
                if (cells.size === 0) return;
                let maxCol = 0, maxRow = 0;
                for (const id of cells.keys()) {
                    const m = id.match(/^([A-Z]+)(\d+)$/);
                    if (!m) continue;
                    const c = alphaToNum(m[1]), r = parseInt(m[2]);
                    if (c > maxCol) maxCol = c;
                    if (r > maxRow) maxRow = r;
                }
                if (maxCol === 0 || maxRow === 0) return;
                setSelectionAnchor('A1');
                setSelectionActive(`${numToAlpha(maxCol)}${maxRow}`);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [undo, redo, dataRef, setSelectionAnchor, setSelectionActive]);

    return {
        undoStackRef,
        redoStackRef,
        snapshotBeforeEditRef,
        historyLen,
        pushToUndo,
        pushPatchToUndo,
        undo,
        redo,
        resetHistoryAndSelection,
    };
}
