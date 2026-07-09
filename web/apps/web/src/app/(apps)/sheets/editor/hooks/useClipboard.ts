'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { CellProps, CellStyle, ClipboardCell, ClipboardCFRule, ClipboardData, CFRule, CFRuleSpec } from '../types';
import { getRangeCells, encodeFormula, decodeFormula } from '../utils';
import { alphaToNum, numToAlpha } from '../utils';
import { computeCell, propagateDeps, type SheetRef } from '../formula';
import { parseGoogleSpreadsheetCompactTableJson, parseGoogleSheetsHtml, fixRealtiveFormulas, mergeCellStyles } from '../google.transfomer';
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
    getAllSheets,
    conditionalFormatsRef,
    updateConditionalFormats,
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
    /** Returns all sheets for cross-sheet formula resolution. */
    getAllSheets?: () => SheetRef[];
    conditionalFormatsRef?: React.MutableRefObject<CFRule[]>;
    updateConditionalFormats?: (rules: CFRule[]) => void;
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

        // Collect CF rules that intersect the copied range, clipped to relative coords.
        const cfRules: ClipboardCFRule[] = [];
        if (conditionalFormatsRef) {
            const maxRow = minR + (entries.reduce((m, e) => Math.max(m, e.relRow), 0));
            const maxCol = minC + (entries.reduce((m, e) => Math.max(m, e.relCol), 0));
            for (const cfRule of conditionalFormatsRef.current) {
                const rm = cfRule.range.trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
                if (!rm) continue;
                const rc1 = alphaToNum(rm[1].toUpperCase()), rr1 = parseInt(rm[2]);
                const rc2 = rm[3] ? alphaToNum(rm[3].toUpperCase()) : rc1;
                const rr2 = rm[4] ? parseInt(rm[4]) : rr1;
                const rMinR = Math.min(rr1, rr2), rMaxR = Math.max(rr1, rr2);
                const rMinC = Math.min(rc1, rc2), rMaxC = Math.max(rc1, rc2);
                // Check intersection with copied range [minR..maxRow] x [minC..maxCol]
                const intMinR = Math.max(rMinR, minR), intMaxR = Math.min(rMaxR, maxRow);
                const intMinC = Math.max(rMinC, minC), intMaxC = Math.min(rMaxC, maxCol);
                if (intMinR > intMaxR || intMinC > intMaxC) continue;
                cfRules.push({
                    relRowMin: intMinR - minR,
                    relColMin: intMinC - minC,
                    relRowMax: intMaxR - minR,
                    relColMax: intMaxC - minC,
                    rule: cfRule.rule,
                });
            }
        }

        clipboardRef.current = { isCut, cells: entries, cfRules };
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
        transfer.setData('application/x-neutrino-sheet', JSON.stringify({ isCut, cells: entries, cfRules }));

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
    }, [dataRef, selectionAnchorRef, selectionActiveRef, spreadsheetId, activeSheetIndexRef, conditionalFormatsRef]);

    const handlePaste = useCallback((transfer?: DataTransfer) => {
        const anchor = selectionAnchorRef.current;
        if (!anchor) return;

        const m = anchor.match(/^([A-Z]+)(\d+)$/);
        if (!m) return;

        // Derive the paste origin from the top-left of the current selection so that
        // pasting into a range always fills from the top-left corner regardless of
        // the direction the selection was dragged.
        const active = selectionActiveRef.current ?? anchor;
        const am = active.match(/^([A-Z]+)(\d+)$/);
        const anchorRow = parseInt(m[2]), anchorCol = alphaToNum(m[1]);
        const activeRow = am ? parseInt(am[2]) : anchorRow;
        const activeCol = am ? alphaToNum(am[1]) : anchorCol;
        const pasteRow = Math.min(anchorRow, activeRow);
        const pasteCol = Math.min(anchorCol, activeCol);

        // When multiple cells are selected, tile the clipboard to fill the selection.
        const selRows = Math.abs(activeRow - anchorRow) + 1;
        const selCols = Math.abs(activeCol - anchorCol) + 1;
        const hasRange = selRows > 1 || selCols > 1;

        const allSheets = getAllSheets?.();

        // Prefer the rich custom format; fall back to in-memory ref, then plain text.
        if (transfer) {
            const rich = transfer.getData('application/x-neutrino-sheet');
            if (rich) {
                try { clipboardRef.current = JSON.parse(rich) as ClipboardData; } catch { /* ignore */ }
            }
        }

        // If still no internal clipboard, try Google Sheets formats.
        // Strategy:
        //   1. Compact-table JSON — preferred for structure (merge spans, formulas).
        //   2. text/html with data-sheets-* / inline CSS — ALWAYS parsed when present
        //      and used to enrich compact-table cells with any missing customFormat and
        //      visual styles.  Also used as the primary source when compact-table is
        //      unavailable (cross-origin paste in the browser).
        if (!clipboardRef.current && transfer) {
            let gsCells: ReturnType<typeof parseGoogleSpreadsheetCompactTableJson> | null = null;

            const gSheet = transfer.getData('application/x-vnd.google-spreadsheet-compact-table+json');
            console.log('[paste] gSheet present:', !!gSheet);
            if (gSheet) {
                try {
                    const parsed = parseGoogleSpreadsheetCompactTableJson(JSON.parse(gSheet));
                    if (parsed.length > 0) gsCells = parsed;
                    console.log('[paste] compact-table cells:', parsed.length);
                } catch (e) { console.error('[paste] compact-table error:', e); }
            }

            // Always parse HTML so we can enrich compact-table cells with format/style
            // info that the compact-table may omit (e.g. custom date format strings).
            const html = transfer.getData('text/html');
            console.log('[paste] html present:', !!html, 'includes data-sheets:', html?.includes('data-sheets-'));
            if (html) {
                try {
                    const htmlCells = parseGoogleSheetsHtml(html);
                    console.log('[paste] htmlCells:', htmlCells.length);
                    if (htmlCells.length > 0) {
                        if (!gsCells) {
                            gsCells = htmlCells;
                        } else {
                            // The compact-table RLE reader can progressively desync across
                            // merged regions, corrupting the coordinates, values and merge
                            // spans of cells to the right of a merge. The HTML clipboard is
                            // DOM-parsed, so its structure (coordinates, spans, values,
                            // styles) is reliable — make it the authority. We only borrow
                            // FORMULAS from the compact-table, since HTML carries a cell's
                            // computed value rather than its "=..." source, plus any number/
                            // date format string HTML may have omitted (filled via merge).
                            const compactByPos = new Map(gsCells.map(c => [`${c.row},${c.col}`, c]));
                            const before = gsCells.length;
                            gsCells = htmlCells.map(hc => {
                                const cc = compactByPos.get(`${hc.row},${hc.col}`);
                                const raw = cc?.raw && cc.raw.startsWith('=') ? cc.raw : hc.raw;
                                const merged = mergeCellStyles(cc?.cellStyle, hc.cellStyle);
                                return {
                                    ...hc,
                                    raw,
                                    cellStyle: Object.keys(merged).length > 0 ? (merged as CellStyle) : undefined,
                                };
                            });
                            console.log('[paste] gsCells from HTML base:', gsCells.length, '(compact was', before + ')');
                        }
                    }
                } catch (e) { console.error('[paste] html error:', e); }
            }
            console.log('[paste] final gsCells:', gsCells?.length ?? 'null');

            if (gsCells) {
                const cells = gsCells;
                let clipRows = 1, clipCols = 1;
                for (const cell of cells) {
                    const rowEnd = cell.row + (cell.rowSpan ?? 1);
                    const colEnd = cell.col + (cell.colSpan ?? 1);
                    if (rowEnd > clipRows) clipRows = rowEnd;
                    if (colEnd > clipCols) clipCols = colEnd;
                }
                const pasteAreaRows = hasRange ? selRows : clipRows;
                const pasteAreaCols = hasRange ? selCols : clipCols;
                const clipByPos = new Map<string, typeof cells[0]>();
                for (const cell of cells) clipByPos.set(`${cell.row},${cell.col}`, cell);

                console.log('[paste] clipRows:', clipRows, 'clipCols:', clipCols, 'pasteAreaRows:', pasteAreaRows, 'pasteAreaCols:', pasteAreaCols, 'pasteRow:', pasteRow, 'pasteCol:', pasteCol, 'anchor:', selectionAnchorRef.current);

                setData(prev => {
                    console.log('[paste] setData called, prev.size:', prev.size);
                    pushToUndo(new Map(prev));
                    const next = new Map(prev);
                    let cellsWritten = 0;
                    for (let dr = 0; dr < pasteAreaRows; dr++) {
                        for (let dc = 0; dc < pasteAreaCols; dc++) {
                            const cell = clipByPos.get(`${dr % clipRows},${dc % clipCols}`);
                            if (!cell) continue;
                            // Covered cells (part of a merge) are handled when the anchor is processed.
                            if (cell.mergeAnchor) continue;
                            const currentRow = pasteRow + dr;
                            const currentCol = pasteCol + dc;
                            const targetId = `${numToAlpha(currentCol)}${currentRow}`;
                            let raw = cell.raw ?? '';
                            const existing = next.get(targetId) ?? { id: targetId, value: '', raw, edit: false };
                            const oldDeps = existing.deps ?? [];
                            raw = fixRealtiveFormulas(raw, currentRow, currentCol);
                            const { value, deps: newDeps } = computeCell(raw, next, allSheets);
                            const rowSpan = (cell.rowSpan ?? 1) > 1 ? cell.rowSpan : undefined;
                            const colSpan = (cell.colSpan ?? 1) > 1 ? cell.colSpan : undefined;
                            console.log('[paste] writing', targetId, '← raw:', raw, 'rowSpan:', rowSpan, 'colSpan:', colSpan, 'bg:', cell.cellStyle?.backgroundColor, 'color:', cell.cellStyle?.color, 'fmt:', cell.cellStyle?.customFormat ?? cell.cellStyle?.numberFormat);
                            cellsWritten++;
                            next.set(targetId, { ...existing, id: targetId, raw, value, deps: newDeps, edit: false, cellStyle: cell.cellStyle, rowSpan, colSpan, mergeAnchor: undefined });
                            for (const depId of oldDeps.filter(d => !newDeps.includes(d))) {
                                const depCell = next.get(depId);
                                if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== targetId) });
                            }
                            for (const depId of newDeps.filter(d => !oldDeps.includes(d))) {
                                const depCell = next.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
                                next.set(depId, { ...depCell, dependents: [...(depCell.dependents ?? []), targetId] });
                            }
                            propagateDeps(targetId, next, new Set([targetId]), allSheets);
                            // Create covered-cell entries for every position spanned by this anchor.
                            // Google Sheets encodes covered cells as BLANK so they are absent from
                            // the parsed cells array; we must synthesise them here.
                            if (rowSpan || colSpan) {
                                const rs = rowSpan ?? 1;
                                const cs = colSpan ?? 1;
                                for (let rdr = 0; rdr < rs; rdr++) {
                                    for (let rdc = 0; rdc < cs; rdc++) {
                                        if (rdr === 0 && rdc === 0) continue;
                                        const coveredId = `${numToAlpha(currentCol + rdc)}${currentRow + rdr}`;
                                        const coveredExisting = next.get(coveredId) ?? { id: coveredId, value: '', raw: '', edit: false };
                                        next.set(coveredId, { ...coveredExisting, id: coveredId, raw: '', value: '', deps: [], edit: false, mergeAnchor: targetId, rowSpan: undefined, colSpan: undefined, cellStyle: undefined });
                                    }
                                }
                            }
                        }
                    }
                    console.log('[paste] setData done, cellsWritten:', cellsWritten, 'next.size:', next.size);
                    return next;
                });
                dirtyRef.current = true;
                return;
            }
        }

        // If still no internal clipboard but system clipboard text is available, paste as plain values.
        if (!clipboardRef.current && transfer) {
            const text = transfer.getData('text/plain');
            if (!text) return;
            const rows = text.split('\n').map(r => r.split('\t'));
            const clipRows = rows.length;
            const clipCols = rows.reduce((max, r) => Math.max(max, r.length), 1);
            const pasteAreaRows = hasRange ? selRows : clipRows;
            const pasteAreaCols = hasRange ? selCols : clipCols;
            setData(prev => {
                pushToUndo(new Map(prev));
                const next = new Map(prev);
                for (let dr = 0; dr < pasteAreaRows; dr++) {
                    for (let dc = 0; dc < pasteAreaCols; dc++) {
                        const srcRow = rows[dr % clipRows];
                        const raw = srcRow?.[dc % Math.max(srcRow?.length ?? 1, 1)] ?? '';
                        const targetId = `${numToAlpha(pasteCol + dc)}${pasteRow + dr}`;
                        const existing = next.get(targetId) ?? { id: targetId, value: '', raw: '', edit: false };
                        const oldDeps = existing.deps ?? [];
                        const { value, deps: newDeps } = computeCell(raw, next, allSheets);
                        next.set(targetId, { ...existing, id: targetId, raw, value, deps: newDeps, edit: false });
                        for (const depId of oldDeps.filter(d => !newDeps.includes(d))) {
                            const depCell = next.get(depId);
                            if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== targetId) });
                        }
                        for (const depId of newDeps.filter(d => !oldDeps.includes(d))) {
                            const depCell = next.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
                            next.set(depId, { ...depCell, dependents: [...(depCell.dependents ?? []), targetId] });
                        }
                        propagateDeps(targetId, next, new Set([targetId]), allSheets);
                    }
                }
                return next;
            });
            dirtyRef.current = true;
            return;
        }

        const clipboard = clipboardRef.current;
        if (!clipboard) return;

        // Clipboard dimensions for tiling.
        let clipRows = 1, clipCols = 1;
        for (const entry of clipboard.cells) {
            if (entry.relRow + 1 > clipRows) clipRows = entry.relRow + 1;
            if (entry.relCol + 1 > clipCols) clipCols = entry.relCol + 1;
        }
        const pasteAreaRows = hasRange ? selRows : clipRows;
        const pasteAreaCols = hasRange ? selCols : clipCols;
        const clipByPos = new Map<string, typeof clipboard.cells[0]>();
        for (const entry of clipboard.cells) clipByPos.set(`${entry.relRow},${entry.relCol}`, entry);

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
            for (let dr = 0; dr < pasteAreaRows; dr++) {
                for (let dc = 0; dc < pasteAreaCols; dc++) {
                    const entry = clipByPos.get(`${dr % clipRows},${dc % clipCols}`);
                    if (!entry) continue;
                    const targetRow = pasteRow + dr;
                    const targetCol = pasteCol + dc;
                    const targetId = `${numToAlpha(targetCol)}${targetRow}`;
                    const raw = decodeFormula(entry.raw, targetRow, targetCol);
                    const existing = next.get(targetId) ?? { id: targetId, value: '', raw: '', edit: false };
                    next.set(targetId, { ...existing, id: targetId, raw, value: existing.value, cellStyle: entry.cellStyle, edit: false });
                }
            }

            // Compute values in insertion order (top-left → bottom-right).
            for (let dr = 0; dr < pasteAreaRows; dr++) {
                for (let dc = 0; dc < pasteAreaCols; dc++) {
                    const entry = clipByPos.get(`${dr % clipRows},${dc % clipCols}`);
                    if (!entry) continue;
                    const targetRow = pasteRow + dr;
                    const targetCol = pasteCol + dc;
                    const targetId = `${numToAlpha(targetCol)}${targetRow}`;
                    const cell = next.get(targetId)!;
                    const oldDeps = cell.deps ?? [];
                    const { value, deps: newDeps } = computeCell(cell.raw ?? '', next, allSheets);
                    next.set(targetId, { ...cell, value, deps: newDeps });
                    for (const depId of oldDeps.filter(d => !newDeps.includes(d))) {
                        const depCell = next.get(depId);
                        if (depCell) next.set(depId, { ...depCell, dependents: (depCell.dependents ?? []).filter(d => d !== targetId) });
                    }
                    for (const depId of newDeps.filter(d => !oldDeps.includes(d))) {
                        const depCell = next.get(depId) ?? { id: depId, raw: '', value: '', edit: false };
                        next.set(depId, { ...depCell, dependents: [...(depCell.dependents ?? []), targetId] });
                    }
                    propagateDeps(targetId, next, new Set([targetId]), allSheets);
                }
            }

            return next;
        });
        dirtyRef.current = true;

        // Apply copied CF rules to the pasted destination range.
        if (clipboard.cfRules && clipboard.cfRules.length > 0 && updateConditionalFormats && conditionalFormatsRef) {
            // For a cut, drop existing rules that covered the source cells.
            let base = conditionalFormatsRef.current;
            if (clipboard.isCut) {
                base = base.filter(r => {
                    const rm = r.range.trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
                    if (!rm) return true;
                    const rMinR = Math.min(parseInt(rm[2]), rm[4] ? parseInt(rm[4]) : parseInt(rm[2]));
                    const rMaxR = Math.max(parseInt(rm[2]), rm[4] ? parseInt(rm[4]) : parseInt(rm[2]));
                    const rMinC = Math.min(alphaToNum(rm[1].toUpperCase()), rm[3] ? alphaToNum(rm[3].toUpperCase()) : alphaToNum(rm[1].toUpperCase()));
                    const rMaxC = Math.max(alphaToNum(rm[1].toUpperCase()), rm[3] ? alphaToNum(rm[3].toUpperCase()) : alphaToNum(rm[1].toUpperCase()));
                    for (const srcId of cutSourceRef.current) {
                        const sm = srcId.match(/^([A-Z]+)(\d+)$/);
                        if (!sm) continue;
                        const sc = alphaToNum(sm[1]), sr = parseInt(sm[2]);
                        if (sr >= rMinR && sr <= rMaxR && sc >= rMinC && sc <= rMaxC) return false;
                    }
                    return true;
                });
            }
            const newRules: CFRule[] = [...base];
            for (const cr of clipboard.cfRules) {
                const targetMinRow = pasteRow + cr.relRowMin;
                const targetMaxRow = pasteRow + cr.relRowMax;
                const targetMinCol = pasteCol + cr.relColMin;
                const targetMaxCol = pasteCol + cr.relColMax;
                const range = targetMinRow === targetMaxRow && targetMinCol === targetMaxCol
                    ? `${numToAlpha(targetMinCol)}${targetMinRow}`
                    : `${numToAlpha(targetMinCol)}${targetMinRow}:${numToAlpha(targetMaxCol)}${targetMaxRow}`;
                newRules.push({ id: `cf-${Date.now()}-${Math.random().toString(36).slice(2)}`, range, rule: cr.rule });
            }
            updateConditionalFormats(newRules);
        }

        if (clipboard.isCut) {
            clipboardRef.current = null;
            cutSourceRef.current = new Set();
            setCutCells(new Set());
        }
    }, [selectionAnchorRef, selectionActiveRef, pushToUndo, dirtyRef, setData, getAllSheets, conditionalFormatsRef, updateConditionalFormats]);

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
