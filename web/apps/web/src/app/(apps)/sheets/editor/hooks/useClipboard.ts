'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { CellProps, ClipboardCell, ClipboardData } from '../types';
import { getRangeCells, encodeFormula, decodeFormula } from '../utils';
import { alphaToNum, numToAlpha } from '../utils';
import { computeCell, propagateDeps } from '../formula';
import { parseGoogleSpreadsheetCompactTableJson, fixRealtiveFormulas } from '../google.transfomer';
import { NEUTRINO_SHEET_SELECTION_MIME, buildSheetSelectionPayload } from '@neutrino/sheet-embed';

export function useClipboard({
    dataRef,
    selectionAnchorRef,
    selectionActiveRef,
    formulaInputRef,
    pushToUndo,
    dirtyRef,
    setData,
    spreadsheetId,
    activeSheetIndexRef,
}: {
    dataRef: React.MutableRefObject<Map<string, CellProps>>;
    selectionAnchorRef: React.MutableRefObject<string | undefined>;
    selectionActiveRef: React.MutableRefObject<string | undefined>;
    formulaInputRef: React.RefObject<HTMLInputElement>;
    pushToUndo: (snapshot: Map<string, CellProps>) => void;
    dirtyRef: React.MutableRefObject<boolean>;
    setData: React.Dispatch<React.SetStateAction<Map<string, CellProps>>>;
    /** The drive file ID of the parent spreadsheet. Used for the live-embed clipboard payload. */
    spreadsheetId: string;
    /** Ref to the active tab index (FortuneSheet tab identifier). */
    activeSheetIndexRef: React.MutableRefObject<number>;
}) {
    const clipboardRef = useRef<ClipboardData | null>(null);
    const cutSourceRef = useRef<Set<string>>(new Set<string>());
    const [cutCells, setCutCells] = useState<Set<string>>(new Set<string>());

    const handleCopy = useCallback((isCut: boolean, transfer: DataTransfer) => {
        const anchor = selectionAnchorRef.current;
        if (!anchor) return;
        const cells = getRangeCells(anchor, selectionActiveRef.current ?? anchor);

        let minR = Infinity, minC = Infinity;
        for (const id of cells) {
            const m = id.match(/^([A-Z]+)(\d+)$/);
            if (!m) continue;
            const c = alphaToNum(m[1]), r = parseInt(m[2]);
            if (r < minR) minR = r;
            if (c < minC) minC = c;
        }

        const entries: ClipboardCell[] = [];
        for (const id of cells) {
            const m = id.match(/^([A-Z]+)(\d+)$/);
            if (!m) continue;
            const col = alphaToNum(m[1]), row = parseInt(m[2]);
            const cell = dataRef.current.get(id);
            entries.push({
                relRow: row - minR,
                relCol: col - minC,
                raw: encodeFormula(cell?.raw ?? '', row, col),
                cellStyle: cell?.cellStyle,
            });
        }
        // Sort top-to-bottom, left-to-right so paste evaluates in dependency order.
        entries.sort((a, b) => a.relRow - b.relRow || a.relCol - b.relCol);

        clipboardRef.current = { isCut, cells: entries };
        cutSourceRef.current = isCut ? new Set(cells) : new Set();
        setCutCells(isCut ? new Set(cells) : new Set());

        // Write tab-separated values to the system clipboard so cells can be
        // pasted into other applications.
        let maxRelRow = 0, maxRelCol = 0;
        for (const e of entries) {
            if (e.relRow > maxRelRow) maxRelRow = e.relRow;
            if (e.relCol > maxRelCol) maxRelCol = e.relCol;
        }
        const grid: string[][] = Array.from({ length: maxRelRow + 1 }, () => Array(maxRelCol + 1).fill(''));
        for (const e of entries) {
            const cell = dataRef.current.get(`${numToAlpha(minC + e.relCol)}${minR + e.relRow}`);
            grid[e.relRow][e.relCol] = cell?.value ?? cell?.raw ?? '';
        }
        transfer.setData('text/plain', grid.map(row => row.join('\t')).join('\n'));
        // Custom format carries the full rich payload (relative formula encoding + styles).
        transfer.setData('application/x-neutrino-sheet', JSON.stringify({ isCut, cells: entries }));

        // When the live-embed feature is enabled, also write the selection payload
        // so that pasting into Docs or Slides offers a "Paste as live view" option.
        if (!isCut) {
            const sheetTabId = String(activeSheetIndexRef.current);
            const previewData = grid.map(row =>
                row.map(cell => (cell === '' ? null : cell))
            );
            transfer.setData(
                NEUTRINO_SHEET_SELECTION_MIME,
                buildSheetSelectionPayload(
                    spreadsheetId,
                    sheetTabId,
                    minR - 1,  // grid rows are 1-based in the cell ID system
                    minC - 1,  // grid cols are 1-based in the cell ID system
                    minR - 1 + maxRelRow,
                    minC - 1 + maxRelCol,
                    previewData,
                ),
            );
        }
    }, [dataRef, selectionAnchorRef, selectionActiveRef, spreadsheetId, activeSheetIndexRef]);

    const handlePaste = useCallback((transfer?: DataTransfer) => {
        const anchor = selectionAnchorRef.current;
        if (!anchor) return;

        const m = anchor.match(/^([A-Z]+)(\d+)$/);
        if (!m) return;
        const pasteCol = alphaToNum(m[1]), pasteRow = parseInt(m[2]);

        // Prefer the rich custom format; fall back to in-memory ref, then plain text.
        if (transfer) {
            const rich = transfer.getData('application/x-neutrino-sheet');
            if (rich) {
                try { clipboardRef.current = JSON.parse(rich) as ClipboardData; } catch { /* ignore */ }
            }
        }

        // If still no internal clipboard, try the Google Sheets compact-table format.
        if (!clipboardRef.current && transfer) {
            const gSheet = transfer.getData('application/x-vnd.google-spreadsheet-compact-table+json');
            if (gSheet) {
                try {
                    const cells = parseGoogleSpreadsheetCompactTableJson(JSON.parse(gSheet));
                    if (cells.length > 0) {
                        setData(prev => {
                            pushToUndo(new Map(prev));
                            const next = new Map(prev);
                            for (const cell of cells) {
                                const currentRow = pasteRow + cell.row;
                                const currentCol = pasteCol + cell.col;
                                const targetId = `${numToAlpha(currentCol)}${currentRow}`;
                                let raw = cell.raw;
                                const existing = next.get(targetId) ?? { id: targetId, value: '', raw, edit: false };
                                const oldDeps = existing.deps ?? [];
                                raw = fixRealtiveFormulas(raw, currentRow, currentCol);
                                const { value, deps: newDeps } = computeCell(raw, next);
                                const rowSpan = (cell.rowSpan ?? 1) > 1 ? cell.rowSpan : undefined;
                                const colSpan = (cell.colSpan ?? 1) > 1 ? cell.colSpan : undefined;
                                next.set(targetId, { ...existing, id: targetId, raw, value, deps: newDeps, edit: false, cellStyle: cell.cellStyle, rowSpan, colSpan, mergeAnchor: undefined });
                                for (const depId of oldDeps.filter(d => !newDeps.includes(d))) {
                                    const depCell = next.get(depId);
                                    if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== targetId) });
                                }
                                for (const depId of newDeps.filter(d => !oldDeps.includes(d))) {
                                    const depCell = next.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
                                    next.set(depId, { ...depCell, dependents: [...(depCell.dependents ?? []), targetId] });
                                }
                                propagateDeps(targetId, next, new Set([targetId]));
                                // Create covered-cell entries for every position spanned by this anchor.
                                // Google Sheets encodes covered cells as BLANK so they are absent from
                                // the parsed cells array; we must synthesise them here.
                                if (rowSpan || colSpan) {
                                    const rs = rowSpan ?? 1;
                                    const cs = colSpan ?? 1;
                                    for (let dr = 0; dr < rs; dr++) {
                                        for (let dc = 0; dc < cs; dc++) {
                                            if (dr === 0 && dc === 0) continue;
                                            const coveredId = `${numToAlpha(currentCol + dc)}${currentRow + dr}`;
                                            const coveredExisting = next.get(coveredId) ?? { id: coveredId, value: '', raw: '', edit: false };
                                            next.set(coveredId, { ...coveredExisting, id: coveredId, raw: '', value: '', deps: [], edit: false, mergeAnchor: targetId, rowSpan: undefined, colSpan: undefined, cellStyle: undefined });
                                        }
                                    }
                                }
                            }
                            return next;
                        });
                        dirtyRef.current = true;
                        return;
                    }
                } catch { /* ignore */ }
            }
        }

        // If still no internal clipboard but system clipboard text is available, paste as plain values.
        if (!clipboardRef.current && transfer) {
            const text = transfer.getData('text/plain');
            if (!text) return;
            const rows = text.split('\n').map(r => r.split('\t'));
            setData(prev => {
                pushToUndo(new Map(prev));
                const next = new Map(prev);
                for (let r = 0; r < rows.length; r++) {
                    for (let c = 0; c < rows[r].length; c++) {
                        const targetId = `${numToAlpha(pasteCol + c)}${pasteRow + r}`;
                        const raw = rows[r][c];
                        const existing = next.get(targetId) ?? { id: targetId, value: '', raw: '', edit: false };
                        const oldDeps = existing.deps ?? [];
                        const { value, deps: newDeps } = computeCell(raw, next);
                        next.set(targetId, { ...existing, id: targetId, raw, value, deps: newDeps, edit: false });
                        for (const depId of oldDeps.filter(d => !newDeps.includes(d))) {
                            const depCell = next.get(depId);
                            if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== targetId) });
                        }
                        for (const depId of newDeps.filter(d => !oldDeps.includes(d))) {
                            const depCell = next.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
                            next.set(depId, { ...depCell, dependents: [...(depCell.dependents ?? []), targetId] });
                        }
                        propagateDeps(targetId, next, new Set([targetId]));
                    }
                }
                return next;
            });
            dirtyRef.current = true;
            return;
        }

        const clipboard = clipboardRef.current;
        if (!clipboard) return;

        setData(prev => {
            pushToUndo(new Map(prev));
            const next = new Map(prev);

            // Clear cut sources before writing so self-referencing pastes work correctly.
            if (clipboard.isCut) {
                for (const id of cutSourceRef.current) {
                    const cell = next.get(id);
                    if (!cell) continue;
                    // Remove the cut cell from its dependencies' dependents lists.
                    for (const depId of cell.deps ?? []) {
                        const depCell = next.get(depId);
                        if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== id) });
                    }
                    next.set(id, { ...cell, raw: '', value: '', cellStyle: undefined, deps: [] });
                }
            }

            // Write raw values first so inter-cell formula refs resolve correctly.
            for (const entry of clipboard.cells) {
                const targetRow = pasteRow + entry.relRow;
                const targetCol = pasteCol + entry.relCol;
                const targetId = `${numToAlpha(targetCol)}${targetRow}`;
                const raw = decodeFormula(entry.raw, targetRow, targetCol);
                const existing = next.get(targetId) ?? { id: targetId, value: '', raw: '', edit: false };
                next.set(targetId, { ...existing, id: targetId, raw, value: existing.value, cellStyle: entry.cellStyle, edit: false });
            }

            // Compute values in insertion order (already sorted top-left → bottom-right).
            for (const entry of clipboard.cells) {
                const targetRow = pasteRow + entry.relRow;
                const targetCol = pasteCol + entry.relCol;
                const targetId = `${numToAlpha(targetCol)}${targetRow}`;
                const cell = next.get(targetId)!;
                const oldDeps = cell.deps ?? [];
                const { value, deps: newDeps } = computeCell(cell.raw ?? '', next);
                next.set(targetId, { ...cell, value, deps: newDeps });
                // Reconcile the reverse dependency graph so future changes to referenced
                // cells correctly propagate into the pasted cell.
                for (const depId of oldDeps.filter(d => !newDeps.includes(d))) {
                    const depCell = next.get(depId);
                    if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== targetId) });
                }
                for (const depId of newDeps.filter(d => !oldDeps.includes(d))) {
                    const depCell = next.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
                    next.set(depId, { ...depCell, dependents: [...(depCell.dependents ?? []), targetId] });
                }
                propagateDeps(targetId, next, new Set([targetId]));
            }

            return next;
        });
        dirtyRef.current = true;

        if (clipboard.isCut) {
            clipboardRef.current = null;
            cutSourceRef.current = new Set();
            setCutCells(new Set());
        }
    }, [selectionAnchorRef, pushToUndo, dirtyRef, setData]);

    // Native copy/cut/paste events — fire before the browser writes the clipboard,
    // so setData() reliably reaches the OS regardless of which element has focus.
    useEffect(() => {
        const shouldLetFormulaInputHandleShortcut = () => {
            const active = document.activeElement as HTMLInputElement | null;
            return active === formulaInputRef.current &&
                (active?.selectionStart ?? 0) !== (active?.selectionEnd ?? 0);
        };

        const createMemoryTransfer = (): DataTransfer => {
            if (typeof DataTransfer !== 'undefined') return new DataTransfer();
            const store = new Map<string, string>();
            return {
                setData: (type: string, value: string) => { store.set(type, value); },
                getData: (type: string) => store.get(type) ?? '',
            } as DataTransfer;
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
            if (shouldLetFormulaInputHandleShortcut()) return;
            if (!selectionAnchorRef.current) return;

            const key = e.key.toLowerCase();
            if (key === 'c') {
                handleCopy(false, createMemoryTransfer());
            } else if (key === 'x') {
                handleCopy(true, createMemoryTransfer());
            } else if (key === 'v' && clipboardRef.current) {
                e.preventDefault();
                handlePaste();
            }
        };

        const onCopy = (e: ClipboardEvent) => {
            // Let the browser copy if the user has text selected inside the formula bar.
            if (shouldLetFormulaInputHandleShortcut()) return;
            if (!selectionAnchorRef.current || !e.clipboardData) return;
            e.preventDefault();
            handleCopy(false, e.clipboardData);
        };
        const onCut = (e: ClipboardEvent) => {
            if (shouldLetFormulaInputHandleShortcut()) return;
            if (!selectionAnchorRef.current || !e.clipboardData) return;
            e.preventDefault();
            handleCopy(true, e.clipboardData);
        };
        const onPaste = (e: ClipboardEvent) => {
            if (shouldLetFormulaInputHandleShortcut()) return;
            if (!selectionAnchorRef.current) return;
            e.preventDefault();
            handlePaste(e.clipboardData ?? undefined);
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('copy', onCopy);
        document.addEventListener('cut', onCut);
        document.addEventListener('paste', onPaste);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('copy', onCopy);
            document.removeEventListener('cut', onCut);
            document.removeEventListener('paste', onPaste);
        };
    }, [handleCopy, handlePaste, formulaInputRef, selectionAnchorRef]);

    return { cutCells, handleCopy, handlePaste };
}
