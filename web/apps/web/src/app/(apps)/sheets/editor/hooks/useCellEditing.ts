'use client';

import React, { useRef, useState, useCallback, useTransition, useMemo } from 'react';
import type { CellProps, CellStyle } from '../types';
import { getRangeCells } from '../utils';
import { alphaToNum, numToAlpha, rangeAddress } from '../utils';

// ── Formula reference highlighting ────────────────────────────────────────────

const FORMULA_REF_COLORS = [
    '#1a73e8', // blue
    '#e8341a', // red
    '#0f9d58', // green
    '#f5a623', // orange
    '#9c27b0', // purple
    '#00bcd4', // cyan
    '#e91e63', // pink
    '#795548', // brown
];

export type FormulaRefHighlight = { cells: Set<string>; color: string };

// Parses a formula string and returns one highlight entry per unique cell reference
// or range token, each assigned a distinct color. Cross-sheet refs (preceded by !)
// are skipped since they belong to another sheet's grid.
function parseFormulaRefs(raw: string): FormulaRefHighlight[] {
    if (!raw.startsWith('=')) return [];
    const formula = raw.slice(1);
    const re = /(?<![!])\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/g;
    const seen = new Map<string, FormulaRefHighlight>();
    let colorIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(formula)) !== null) {
        const [full, startCol, startRow, endCol, endRow] = match;
        const normalizedRef = full.replace(/\$/g, '');
        if (seen.has(normalizedRef)) continue;
        const cells = (endCol && endRow)
            ? getRangeCells(`${startCol}${startRow}`, `${endCol}${endRow}`)
            : new Set([`${startCol}${startRow}`]);
        seen.set(normalizedRef, { cells, color: FORMULA_REF_COLORS[colorIdx % FORMULA_REF_COLORS.length] });
        colorIdx++;
    }
    return Array.from(seen.values());
}
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
    eagerDataRef,
    formulaInputRef: formulaInputRefProp,
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
    /**
     * Optional ref that holds the most-recently eagerly committed data map.
     * Set in the eager block so flush-on-unmount serialization can use it even
     * after useLayoutEffect overwrites dataRef with the pre-transition React state.
     * Cleared when the corresponding startTransition commits (so normal timed saves
     * fall back to the up-to-date dataRef instead).
     */
    eagerDataRef?: React.MutableRefObject<Map<string, CellProps> | null>;
    /** Optional ref for the formula bar input. When provided, the hook uses it
     *  instead of creating its own so callers (e.g. SheetEditor) can access the
     *  same ref before useCellEditing is called, avoiding a forward reference. */
    formulaInputRef?: React.RefObject<HTMLInputElement>;
}) {
    const [, startTransition] = useTransition();
    const [showFunctions, setShowFunctions] = useState(false);
    const [showAllFunctions, setShowAllFunctions] = useState(false);
    const ownFormulaInputRef = useRef<HTMLInputElement>(null);
    // Use the caller-provided ref when available so the caller can access it
    // without a forward reference (see SheetEditor's flushActiveSheetForPersist).
    const formulaInputRef = formulaInputRefProp ?? ownFormulaInputRef;
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
        // Guard against re-activating the same cell. Enter moves to the next cell
        // and a subsequent click on that same cell would commit currentCell (itself)
        // with an empty raw value before any text is typed, corrupting the data state.
        if (currentCell?.id === id) {
            setSelectionAnchor(id);
            setSelectionActive(id);
            selectionAnchorLatestRef.current = id;
            // Refresh the formula bar if data changed while this cell was selected
            // (e.g. paste wrote a new formula into the currently-selected cell).
            // Only refresh when the formula bar is not actively focused (user typing).
            const latestRaw = dataRef.current.get(id)?.raw ?? '';
            if (latestRaw !== (currentCell.raw ?? '') && document.activeElement !== formulaInputRef.current) {
                setCurrentCell(prev => prev ? { ...prev, raw: latestRaw } : prev);
            }
            return;
        }

        const existing = dataRef.current.get(id) ?? { id, value: '', raw: '', edit: false } as CellProps;
        const activated = { ...existing, edit: true };
        setCurrentCell(activated);
        setSelectionAnchor(id);
        setSelectionActive(id);
        selectionAnchorLatestRef.current = id;
        formulaInputRef.current?.blur();
        // No focus() call — formula bar focuses only on explicit user click, keeping arrow-key navigation active.

        // Eagerly commit the previous cell's raw value into dataRef.current before the
        // startTransition below. The transition is deferred and may not commit before the
        // component unmounts (e.g. SPA navigation immediately after Enter). The flush-on-
        // unmount save reads dataRef.current directly, so this ensures the latest edit is
        // always captured even if the transition never commits to React state.
        if (currentCell) {
            // Prefer the formula bar's DOM value over currentCell.raw (React state).
            // React may not have committed the setCurrentCell update from handleTextChange
            // yet when activateCell is called (e.g. Enter pressed immediately after fill
            // in an E2E test), leaving currentCell.raw stale. The DOM input always holds
            // the actual typed content regardless of React render timing.
            const rawToCommit = formulaInputRef.current?.value ?? currentCell.raw ?? '';
            const eagerMap = new Map(dataRef.current);
            const prevCell = eagerMap.get(currentCell.id) ?? { id: currentCell.id, value: '', raw: '', edit: false };
            // Commit if the cell is actively edited in the data map, OR if the cell isn't
            // in the data map at all (isFallback). The fallback occurs when startTransition
            // updates haven't committed yet and useLayoutEffect already overwrote dataRef
            // with the empty pre-transition state (e.g. typing in a new sheet then
            // immediately navigating away via the sidebar). When edit is false AND the cell
            // exists in the map, an external write (e.g. paste) stored the correct raw
            // value — don't overwrite it.
            const isFallback = !dataRef.current.has(currentCell.id);
            // During rapid entry (fill + Enter in an E2E test) the cell may already exist
            // in dataRef as edit=false: useLayoutEffect can overwrite dataRef from committed
            // `data` before the low-priority handleTextChange transition lands, clearing the
            // eager edit flag. In that case the typed content lives only in the focused
            // formula bar's DOM value. Treat a focused formula bar whose value differs from
            // the stored raw as pending user input and commit it — a paste never has the
            // formula bar focused, so this can't clobber pasted content.
            const hasPendingTypedInput =
                document.activeElement === formulaInputRef.current &&
                rawToCommit !== (prevCell.raw ?? '');
            if (prevCell.edit || isFallback || hasPendingTypedInput) {
                // Also compute value so subsequent formula evaluations in the same
                // turn (e.g. =SUM(B2:B6) entered after plain values) see the correct
                // .value field via dataRef.current rather than empty strings.
                const { value: eagerValue } = computeCell(rawToCommit, eagerMap, getAllSheets?.());
                eagerMap.set(currentCell.id, { ...prevCell, raw: rawToCommit, value: eagerValue, edit: false });
            }
            // Eagerly mark the newly activated cell as editing so the next activateCell's
            // eager block sees edit=true even before the startTransition commits to React
            // state. Without this, rapid cell navigation (e.g. E2E tests) skips the eager
            // commit because the activation transition hasn't flushed yet.
            const newEntry = eagerMap.get(id) ?? { id, value: '', raw: '', edit: false };
            eagerMap.set(id, { ...newEntry, edit: true });
            dataRef.current = eagerMap;
            // Store in eagerDataRef so flush-on-unmount can use it even after
            // useLayoutEffect overwrites dataRef with the pre-transition React state.
            if (eagerDataRef) eagerDataRef.current = eagerMap;
        }

        startTransition(() => {
            const base = dataRef.current;
            const next = new Map(base);
            const allSheets = getAllSheets?.();

            if (currentCell) {
                const latestCell = next.get(currentCell.id) ?? currentCell;
                // When edit is true the user is actively typing; prefer the formula bar's
                // DOM value (formulaInputRef) over currentCell.raw (React state), since
                // currentCell.raw may be stale if the handleTextChange re-render hasn't
                // committed yet (e.g. Enter pressed immediately after fill in an E2E test).
                // When edit is false an external write (e.g. paste) already stored the
                // correct raw in the map — trust that instead.
                const rawToCommit = latestCell.edit
                    ? (formulaInputRef.current?.value ?? currentCell.raw ?? latestCell.raw ?? '')
                    : (latestCell.raw ?? '');
                const { value, deps: newDeps } = computeCell(rawToCommit, next, allSheets);
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
                next.set(currentCell.id, { ...latestCell, raw: rawToCommit, edit: false, value, deps: newDeps });
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

                // Re-evaluate any formula on the committed cell using result (= prevData +
                // dep-graph changes). prevCellChanges may carry a stale computed value when
                // dataRef.current lags behind prevData (concurrent transitions still in flight),
                // causing range formulas like =SUM(B2:B6) to see empty cells and return 0.
                if (currentCell) {
                    const committedCell = result.get(currentCell.id);
                    if (committedCell?.raw?.startsWith('=')) {
                        const { value: correctValue } = computeCell(committedCell.raw, result, allSheets);
                        result.set(currentCell.id, { ...committedCell, value: correctValue });
                        propagateDeps(currentCell.id, result, new Set([currentCell.id]), allSheets);
                    }
                }

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
            const existing = dataRef.current.get(currentCell.id) ?? { id: currentCell.id, value: '', raw: '', edit: true };
            const patched = { ...existing, raw: newRaw, edit: true };
            // Synchronously reflect the typed value in dataRef *before* the deferred
            // transition. A subsequent Enter (activateCell) may fire its eager commit
            // before this low-priority transition lands; without this, dataRef would
            // still show the cell as edit=false / empty and the eager block would skip
            // it, dropping the just-typed value (flaky in rapid fill+Enter E2E entry).
            // Reading dataRef.current here guarantees edit=true + latest raw regardless
            // of React render timing or formula-bar focus/remount.
            dataRef.current = applyPatch(dataRef.current, { [currentCell.id]: patched });
            startTransition(() => {
                setData(prev => applyPatch(prev, {
                    [currentCell.id]: patched,
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
            if (showFunctions || showAllFunctions) {
                event.preventDefault();
                event.stopPropagation();
                setShowFunctions(false);
                setShowAllFunctions(false);
                return;
            }
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

    const formulaRefHighlights = useMemo((): FormulaRefHighlight[] => {
        if (!currentCell?.edit || !currentCell.raw?.startsWith('=')) return [];
        return parseFormulaRefs(currentCell.raw);
    }, [currentCell?.edit, currentCell?.raw]);

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
        // Formula reference highlights
        formulaRefHighlights,
    };
}
