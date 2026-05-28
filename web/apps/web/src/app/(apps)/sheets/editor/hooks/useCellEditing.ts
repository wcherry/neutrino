'use client';

import React, { useRef, useState, useCallback, useTransition, useMemo } from 'react';
import type { CellProps, CellStyle } from '../types';
import { getRangeCells } from '../utils';
import { alphaToNum, numToAlpha, rangeAddress } from '../utils';
import { computeCell, propagateDeps, functionsList, type SheetRef } from '../formula';
import { insertCellRef, isFormulaPickActive } from '../formulaBarCellPick';
import { applyPatch, buildReversePatch } from '../cellPatch';
import type { UndoPatch } from '../cellPatch';
import { MAX_COLS } from '../constants';

export function useCellEditing({
    data,
    setData,
    dataRef,
    currentCell,
    setCurrentCell,
    selectionAnchor,
    selectionActive,
    setSelectionAnchor,
    setSelectionActive,
    dirtyRef,
    pushToUndo,
    pushPatchToUndo,
    snapshotBeforeEditRef,
    getAllSheets,
}: {
    data: Map<string, CellProps>;
    setData: React.Dispatch<React.SetStateAction<Map<string, CellProps>>>;
    dataRef: React.MutableRefObject<Map<string, CellProps>>;
    currentCell: CellProps | undefined;
    setCurrentCell: React.Dispatch<React.SetStateAction<CellProps | undefined>>;
    selectionAnchor: string | undefined;
    selectionActive: string | undefined;
    setSelectionAnchor: React.Dispatch<React.SetStateAction<string | undefined>>;
    setSelectionActive: React.Dispatch<React.SetStateAction<string | undefined>>;
    dirtyRef: React.MutableRefObject<boolean>;
    pushToUndo: (snapshot: Map<string, CellProps>) => void;
    /** Optional patch-based undo push — avoids O(n) Map clone on each edit. */
    pushPatchToUndo?: (patch: UndoPatch) => void;
    snapshotBeforeEditRef: React.MutableRefObject<Map<string, CellProps> | null>;
    /** Returns the current list of all sheets for cross-sheet formula resolution. */
    getAllSheets?: () => SheetRef[];
}) {
    const [, startTransition] = useTransition();
    const [showFunctions, setShowFunctions] = useState(false);
    const [showAllFunctions, setShowAllFunctions] = useState(false);
    const formulaInputRef = useRef<HTMLInputElement>(null);
    // Stable indirection so child event handlers don't re-register on every render.
    const activateCellRef = useRef<(id: string) => void>(() => {});
    // Synchronous ref so applyStyle sees the current anchor even before React
    // re-renders with the new selectionAnchor state (e.g. rapid keyboard shortcuts
    // pressed immediately after a cell click).
    const selectionAnchorLatestRef = useRef<string | undefined>(undefined);

    // ── Formula pick mode ────────────────────────────────────────────────────
    // True when the formula bar is focused and the current formula starts with =.
    // In this mode, clicking grid cells inserts their reference into the formula
    // instead of activating them.
    const [formulaPickMode, setFormulaPickMode] = useState(false);
    // The anchor cell ID for the current pick-mode drag (mousedown start).
    const pickAnchorRef = useRef<string | null>(null);

    // ── Cell activation ──────────────────────────────────────────────────────
    // Commits the currently-edited cell, then opens the given cell for editing.
    // Written as a plain function (not useCallback) and stored in a ref so it can
    // safely close over the latest state without triggering re-renders.
    //
    // Undo recording: instead of storing a full Map snapshot, we collect the
    // set of cell IDs that changed during this commit (the edited cell + its
    // transitive dependents) and build a compact before/after patch.
    const activateCell = (id: string) => {
        const existing = dataRef.current.get(id) ?? { id, value: '', raw: '', edit: false } as CellProps;
        const activated = { ...existing, edit: true };
        setCurrentCell(activated);
        setSelectionAnchor(id);
        setSelectionActive(id);
        selectionAnchorLatestRef.current = id;
        formulaInputRef.current?.blur();
        // No focus() call — formula bar focuses only on explicit user click, keeping arrow-key navigation active.

        startTransition(() => {
            const base = dataRef.current;
            const next = new Map(base);
            const allSheets = getAllSheets?.();

            if (currentCell) {
                // Use the data-map version of this cell as the source of truth for raw/deps.
                // External updates (e.g. paste) modify the data map but not the currentCell
                // React state, so currentCell.raw can be stale. latestCell reflects those updates.
                const latestCell = next.get(currentCell.id) ?? currentCell;
                const { value, deps: newDeps } = computeCell(latestCell.raw ?? '', next, allSheets);
                const oldDeps = latestCell.deps ?? [];

                // Collect IDs that will be mutated so we can build an undo patch.
                const changedIds = new Set<string>([currentCell.id]);

                // Reconcile the dependency graph for the cell being committed.
                for (const depId of oldDeps.filter(d => !newDeps.includes(d))) {
                    changedIds.add(depId);
                    const depCell = next.get(depId);
                    if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== currentCell.id) });
                }
                for (const depId of newDeps.filter(d => !oldDeps.includes(d))) {
                    changedIds.add(depId);
                    const depCell = next.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
                    next.set(depId, { ...depCell, dependents: [...(depCell.dependents ?? []), currentCell.id] });
                }
                next.set(currentCell.id, { ...latestCell, edit: false, value, deps: newDeps });
                propagateDeps(currentCell.id, next, new Set([currentCell.id]), allSheets);

                // Collect all cells touched by propagateDeps into changedIds.
                for (const [k, v] of next) {
                    if (!base.has(k) || base.get(k) !== v) changedIds.add(k);
                }

                // Push the undo record only if the raw value actually changed.
                const prevRaw = snapshotBeforeEditRef.current?.get(currentCell.id)?.raw ?? '';
                if (prevRaw !== (currentCell.raw ?? '')) {
                    if (pushPatchToUndo) {
                        // Compact patch: before = values from the pre-edit snapshot,
                        // after = new computed values for the same IDs.
                        const before = buildReversePatch(snapshotBeforeEditRef.current ?? base, changedIds);
                        const after: Record<string, CellProps | undefined> = {};
                        for (const cid of changedIds) after[cid] = next.get(cid);
                        pushPatchToUndo({ before, after });
                    } else if (snapshotBeforeEditRef.current) {
                        // Fallback: push the full pre-edit snapshot (legacy callers).
                        pushToUndo(snapshotBeforeEditRef.current);
                    }
                }
            }

            // Capture the pre-edit state for this new edit session.
            // Store only a shallow clone of the Map — still O(n) but unavoidable
            // here since we need a stable baseline for future patch recording.
            snapshotBeforeEditRef.current = new Map(next);

            // Collect cells changed by the previous-cell commit (e.g. dep graph
            // updates) so we can replay them inside the functional updater below.
            // We exclude `id` itself — it is handled by the updater with the
            // latest prevData so concurrent style changes (e.g. Ctrl+B pressed
            // immediately after the click) are preserved, not overwritten.
            const prevCellChanges: Array<[string, CellProps]> = [];
            for (const [k, v] of next) {
                if (k !== id && base.get(k) !== v) prevCellChanges.push([k, v]);
            }

            // Use a functional updater so the activation always starts from the
            // most-recent state (prevData), not the snapshot captured above.
            // This prevents a race where applyStyle runs after the transition
            // callback builds `next` but before setData is processed.
            setData(prevData => {
                const result = new Map(prevData);
                for (const [k, v] of prevCellChanges) result.set(k, v);
                const latestForId = result.get(id) ?? existing;
                result.set(id, { ...latestForId, raw: existing.raw, edit: true });
                return result;
            });
        });
    };
    activateCellRef.current = activateCell;

    // Stable wrapper passed to SheetGrid so its handlers never need to re-register.
    const stableOnCellActivate = useCallback((id: string) => activateCellRef.current(id), []);
    const stableOnSelectionExtend = useCallback((id: string) => { setSelectionActive(id); }, [setSelectionActive]);

    const beginTypingInFormulaBar = useCallback((text: string) => {
        const id = selectionAnchorLatestRef.current ?? selectionAnchor;
        if (!id) return;

        const existing = dataRef.current.get(id) ?? { id, value: '', raw: '', edit: true };
        const nextCell = { ...existing, raw: text, edit: true };

        dirtyRef.current = true;
        setCurrentCell(nextCell);
        setSelectionAnchor(id);
        setSelectionActive(id);
        setShowFunctions(text.startsWith('=') && functionsList(text.slice(1).toUpperCase()).length > 0);
        setFormulaPickMode(isFormulaPickActive(text));

        if (!snapshotBeforeEditRef.current) {
            snapshotBeforeEditRef.current = new Map(dataRef.current);
        }

        startTransition(() => {
            setData(prev => applyPatch(prev, {
                [id]: nextCell,
            }));
        });

        setTimeout(() => {
            const input = formulaInputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange(text.length, text.length);
        }, 0);
    }, [dataRef, dirtyRef, selectionAnchor, setCurrentCell, setData, setSelectionAnchor, setSelectionActive, snapshotBeforeEditRef, startTransition]);

    // ── Formula bar handlers ─────────────────────────────────────────────────
    const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        event.stopPropagation();
        dirtyRef.current = true;
        const newRaw = event.target.value;
        setCurrentCell(prev => ({ ...prev, raw: newRaw } as CellProps));
        const query = newRaw.startsWith('=') ? newRaw.slice(1).toUpperCase() : '';
        setShowFunctions(query.length > 0 && functionsList(query).length > 0);
        setFormulaPickMode(isFormulaPickActive(newRaw));
        if (currentCell) {
            // Patch only the one cell being edited — avoids O(n) Map clone.
            const existing = dataRef.current.get(currentCell.id) ?? { id: currentCell.id, value: '', raw: '', edit: true };
            startTransition(() => {
                setData(prev => applyPatch(prev, {
                    [currentCell.id]: { ...existing, raw: newRaw, edit: true },
                }));
            });
        }
    };

    const handleFormulaBarKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && currentCell) {
            event.preventDefault();
            setFormulaPickMode(false);
            pickAnchorRef.current = null;
            const m = currentCell.id.match(/^([A-Z]+)(\d+)$/);
            if (m) {
                activateCell(`${m[1]}${parseInt(m[2]) + 1}`);
                formulaInputRef.current?.blur();
            }
        } else if (event.key === 'Tab' && currentCell) {
            event.preventDefault();
            setFormulaPickMode(false);
            pickAnchorRef.current = null;
            const m = currentCell.id.match(/^([A-Z]+)(\d+)$/);
            if (m) {
                const nextCol = Math.min(alphaToNum(m[1]) + 1, MAX_COLS);
                activateCell(`${numToAlpha(nextCol)}${m[2]}`);
                formulaInputRef.current?.blur();
            }
        } else if (event.key === 'Escape') {
            setFormulaPickMode(false);
            pickAnchorRef.current = null;
        }
    };

    const handleFormulaBarFocus = useCallback(() => {
        setFormulaPickMode(isFormulaPickActive(currentCell?.raw));
    }, [currentCell?.raw]);

    const handleFormulaBarBlur = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
        const related = event.relatedTarget as HTMLElement | null;
        if (related === null) return;
        if (formulaInputRef.current?.parentElement?.contains(related)) return;
        setFormulaPickMode(false);
        pickAnchorRef.current = null;
    }, []);

    // ── Pick-mode grid click handlers ────────────────────────────────────────
    // Called by SheetGrid (via SheetEditor) when formulaPickMode is active.

    const handleFormulaPickMouseDown = useCallback((cellId: string) => {
        if (!currentCell) return;
        pickAnchorRef.current = cellId;
        // Also update the visual selection so the user sees what they are picking.
        setSelectionAnchor(cellId);
        setSelectionActive(cellId);

        const input = formulaInputRef.current;
        const cursor = input?.selectionStart ?? (currentCell.raw ?? '').length;
        const { raw: newRaw, cursorPos } = insertCellRef(currentCell.raw ?? '', cursor, cellId);

        setCurrentCell(prev => ({ ...prev, raw: newRaw } as CellProps));
        dirtyRef.current = true;

        startTransition(() => {
            // Patch only the one formula cell — avoids O(n) Map clone.
            const existing = dataRef.current.get(currentCell.id) ?? { id: currentCell.id, value: '', raw: '', edit: true };
            setData(prev => applyPatch(prev, {
                [currentCell.id]: { ...existing, raw: newRaw, edit: true },
            }));
        });

        // Restore focus and cursor position in the formula bar.
        setTimeout(() => {
            const inp = formulaInputRef.current;
            if (inp) { inp.focus(); inp.setSelectionRange(cursorPos, cursorPos); }
        }, 0);
    }, [currentCell, dataRef, dirtyRef, setCurrentCell, setData, setSelectionAnchor, setSelectionActive, startTransition]);

    const handleFormulaPickMouseMove = useCallback((cellId: string) => {
        if (!currentCell || !pickAnchorRef.current) return;
        const anchor = pickAnchorRef.current;

        // Update the visual selection.
        setSelectionActive(cellId);

        // Build the range reference (or single-cell ref if anchor === cell).
        const ref = anchor === cellId ? cellId : rangeAddress(anchor, cellId);

        const input = formulaInputRef.current;
        // Use the cursor position saved from the mousedown — find it by looking
        // at the formula: the insertCellRef from mousedown placed the last ref
        // ending at the cursor, but the cursor may have moved.  The simplest
        // approach: store the insertion-start position in a ref.
        const cursor = input?.selectionStart ?? (currentCell.raw ?? '').length;
        const { raw: newRaw, cursorPos } = insertCellRef(currentCell.raw ?? '', cursor, ref);

        setCurrentCell(prev => ({ ...prev, raw: newRaw } as CellProps));
        dirtyRef.current = true;

        startTransition(() => {
            // Patch only the one formula cell — avoids O(n) Map clone.
            const existing = dataRef.current.get(currentCell.id) ?? { id: currentCell.id, value: '', raw: '', edit: true };
            setData(prev => applyPatch(prev, {
                [currentCell.id]: { ...existing, raw: newRaw, edit: true },
            }));
        });

        // Restore focus and cursor position.
        setTimeout(() => {
            const inp = formulaInputRef.current;
            if (inp) { inp.focus(); inp.setSelectionRange(cursorPos, cursorPos); }
        }, 0);
    }, [currentCell, dataRef, dirtyRef, setCurrentCell, setData, setSelectionActive, startTransition]);

    const toggleAllFunctions = useCallback(() => {
        setShowAllFunctions(prev => !prev);
        setShowFunctions(false);
    }, []);

    const handleFunctionSelect = useCallback((fnName: string) => {
        const newRaw = `=${fnName}(`;
        setCurrentCell(prev => ({ ...prev, raw: newRaw } as CellProps));
        setShowAllFunctions(false);
        setShowFunctions(false);
        dirtyRef.current = true;
        setFormulaPickMode(true);
        if (currentCell) {
            startTransition(() => {
                // Patch only the one formula cell — avoids O(n) Map clone.
                const existing = dataRef.current.get(currentCell.id) ?? { id: currentCell.id, value: '', raw: '', edit: true };
                setData(prev => applyPatch(prev, {
                    [currentCell.id]: { ...existing, raw: newRaw, edit: true },
                }));
            });
        }
        setTimeout(() => {
            const input = formulaInputRef.current;
            if (input) { input.focus(); input.setSelectionRange(newRaw.length, newRaw.length); }
        }, 0);
    }, [currentCell, dataRef, dirtyRef, setCurrentCell, setData, startTransition]);

    // ── Style application ────────────────────────────────────────────────────
    const applyStyle = useCallback((style: Partial<CellStyle>) => {
        const anchor = selectionAnchorLatestRef.current ?? selectionAnchor;
        if (!anchor) return;
        dirtyRef.current = true;
        const cells = getRangeCells(anchor, selectionActive ?? anchor);
        setData(prev => {
            if (pushPatchToUndo) {
                // Record only the cells that will change, not the full Map.
                const before = buildReversePatch(prev, cells);
                const after: Record<string, CellProps | undefined> = {};
                for (const cellId of cells) {
                    const cell = prev.get(cellId) ?? { id: cellId, value: '', raw: '', edit: false };
                    after[cellId] = { ...cell, cellStyle: { ...cell.cellStyle, ...style } };
                }
                pushPatchToUndo({ before, after });
                return applyPatch(prev, after);
            }
            // Legacy path: full-clone undo + full-clone apply.
            pushToUndo(new Map(prev));
            const next = new Map(prev);
            for (const cellId of cells) {
                const cell = next.get(cellId) ?? { id: cellId, value: '', raw: '', edit: false };
                next.set(cellId, { ...cell, cellStyle: { ...cell.cellStyle, ...style } });
            }
            return next;
        });
    }, [selectionAnchor, selectionActive, dirtyRef, pushToUndo, pushPatchToUndo, setData]);

    // ── Merge / unmerge ──────────────────────────────────────────────────────
    const mergeCells = useCallback(() => {
        if (!selectionAnchor) return;
        const anchorCell = data.get(selectionAnchor);

        // Unmerge if the anchor is already a merge origin.
        if ((anchorCell?.colSpan ?? 1) > 1 || (anchorCell?.rowSpan ?? 1) > 1) {
            const am = selectionAnchor.match(/^([A-Z]+)(\d+)$/);
            if (!am) return;
            const minC = alphaToNum(am[1]), minR = parseInt(am[2]);
            const maxC = minC + (anchorCell!.colSpan ?? 1) - 1;
            const maxR = minR + (anchorCell!.rowSpan ?? 1) - 1;
            setData(prev => {
                pushToUndo(new Map(prev));
                const next = new Map(prev);
                const anchor = next.get(selectionAnchor)!;
                next.set(selectionAnchor, { ...anchor, colSpan: undefined, rowSpan: undefined });
                for (let c = minC; c <= maxC; c++) {
                    for (let r = minR; r <= maxR; r++) {
                        const id = `${numToAlpha(c)}${r}`;
                        if (id === selectionAnchor) continue;
                        const cell = next.get(id) ?? { id, value: '', raw: '', edit: false };
                        next.set(id, { ...cell, mergeAnchor: undefined });
                    }
                }
                return next;
            });
            dirtyRef.current = true;
            return;
        }

        // Merge the current selection.
        const cells = getRangeCells(selectionAnchor, selectionActive ?? selectionAnchor);
        if (cells.size < 2) return;

        const am = selectionAnchor.match(/^([A-Z]+)(\d+)$/);
        if (!am) return;
        let minC = alphaToNum(am[1]), minR = parseInt(am[2]);
        let maxC = minC, maxR = minR;
        for (const id of cells) {
            const m = id.match(/^([A-Z]+)(\d+)$/);
            if (!m) continue;
            const c = alphaToNum(m[1]), r = parseInt(m[2]);
            if (c < minC) minC = c;
            if (r < minR) minR = r;
            if (c > maxC) maxC = c;
            if (r > maxR) maxR = r;
        }
        const anchorId = `${numToAlpha(minC)}${minR}`;

        setData(prev => {
            pushToUndo(new Map(prev));
            const next = new Map(prev);
            const anchor = next.get(anchorId) ?? { id: anchorId, value: '', raw: '', edit: false };
            next.set(anchorId, { ...anchor, colSpan: maxC - minC + 1, rowSpan: maxR - minR + 1, mergeAnchor: undefined });
            for (const id of cells) {
                if (id === anchorId) continue;
                const cell = next.get(id) ?? { id, value: '', raw: '', edit: false };
                next.set(id, { ...cell, mergeAnchor: anchorId, colSpan: undefined, rowSpan: undefined });
            }
            return next;
        });
        dirtyRef.current = true;
    }, [selectionAnchor, selectionActive, data, dirtyRef, pushToUndo, setData]);

    // ── Derived values ───────────────────────────────────────────────────────
    const selectedCells = useMemo(() => {
        if (!selectionAnchor) return new Set<string>();
        return getRangeCells(selectionAnchor, selectionActive ?? selectionAnchor);
    }, [selectionAnchor, selectionActive]);

    const selectedCellStyle = selectionAnchor ? data.get(selectionAnchor)?.cellStyle : undefined;
    const isMerged = (() => {
        const cell = selectionAnchor ? data.get(selectionAnchor) : undefined;
        return (cell?.colSpan ?? 1) > 1 || (cell?.rowSpan ?? 1) > 1;
    })();

    return {
        showFunctions,
        showAllFunctions,
        formulaInputRef,
        activateCellRef,
        stableOnCellActivate,
        stableOnSelectionExtend,
        beginTypingInFormulaBar,
        handleTextChange,
        handleFormulaBarKeyDown,
        handleFormulaBarFocus,
        handleFormulaBarBlur,
        toggleAllFunctions,
        handleFunctionSelect,
        applyStyle,
        mergeCells,
        selectedCells,
        selectedCellStyle,
        isMerged,
        // Formula pick mode
        formulaPickMode,
        handleFormulaPickMouseDown,
        handleFormulaPickMouseMove,
    };
}
