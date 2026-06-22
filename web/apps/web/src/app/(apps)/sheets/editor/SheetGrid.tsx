'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Filter } from 'lucide-react';
import type { CellProps } from './types';
import { CELL_W, CELL_H, ROW_HDR_W, COL_HDR_H, MAX_ROWS, MAX_COLS, V_BUF, H_BUF } from './constants';
import { numToAlpha, alphaToNum } from './utils';
import { Cell } from './Cell';
import { evaluateConditionalFormats } from './conditionalFormatting';
import type { CFRule, CFVariable } from './types';
import styles from './page.module.css';

export type SheetGridProps = {
    data: Map<string, CellProps>;
    selectedCells: Set<string>;
    cutCells?: Set<string>;
    onCellActivate: (id: string) => void;
    onSelectionExtend: (id: string) => void;
    colWidths: Map<number, number>;
    rowHeights: Map<number, number>;
    onColResize: (colIndex: number, width: number) => void;
    onRowResize: (rowIndex: number, height: number) => void;
    onColHeaderClick?: (colIndex: number) => void;
    onRowHeaderClick?: (rowIndex: number) => void;
    highlightedCol?: number | null;
    highlightedRow?: number | null;
    // Formula pick mode
    formulaPickMode?: boolean;
    onFormulaPickMouseDown?: (cellId: string) => void;
    onFormulaPickMouseMove?: (cellId: string) => void;
    // The cells being highlighted during a formula pick drag
    formulaPickCells?: Set<string>;
    // Context menu
    onCellContextMenu?: (cellId: string, x: number, y: number) => void;
    onColHeaderContextMenu?: (colIndex: number, x: number, y: number) => void;
    onRowHeaderContextMenu?: (rowIndex: number, x: number, y: number) => void;
    // Active column filters — rows not matching are rendered at height 0 (hidden).
    columnFilters?: Map<number, Set<string>>;
    // Expose the scrollable body container ref so the parent can scroll cells into view.
    scrollBodyRef?: React.RefObject<HTMLDivElement | null>;
    // Rendered inside the scroll-content div so overlays (e.g. charts) scroll with the grid.
    overlay?: React.ReactNode;
    // Colored border overlays for each cell reference in the active formula.
    formulaRefHighlights?: Array<{ cells: Set<string>; color: string }>;
    // Conditional formatting rules for the active sheet.
    conditionalFormats?: CFRule[];
    // Named CF variable definitions (item 19).
    cfVariables?: CFVariable[];
    // Remote collaborators' selected cells — rendered as colored overlays.
    remotePresence?: Array<{ clientId: string; cellId: string; color: string; name: string }>;
};

// ── Prefix-sum helpers ────────────────────────────────────────────────────────
//
// buildPrefixSums returns an array where prefix[i] is the pixel offset of the
// LEFT/TOP edge of index i.  prefix[0] === 0 always.  The array is capped at
// `cap` entries so we only materialise the prefix sums for the range that
// actually has custom sizes — the rest uses the uniform default.
//
// Layout for columns (same logic applies to rows):
//   prefix[c] = sum of widths for columns 0 … c-1
//
// For indices beyond prefix.length-1 (all uniform default size) the formula is:
//   offset(i) = prefix[prefix.length-1] + (i - (prefix.length-1)) * defaultSize
//
// This keeps the array small even for MAX_COLS = 65 536.

function buildColPrefixSums(
    colWidths: Map<number, number>,
    dragCol: { index: number; width: number } | null,
): Float64Array {
    // Find the highest customised column index so we only build up to there.
    let maxIdx = -1;
    for (const k of colWidths.keys()) { if (k > maxIdx) maxIdx = k; }
    if (dragCol && dragCol.index > maxIdx) maxIdx = dragCol.index;
    if (maxIdx < 0) return new Float64Array(1); // prefix[0] = 0

    const len = maxIdx + 2; // +1 for the right edge of maxIdx
    const prefix = new Float64Array(len);
    prefix[0] = 0;
    for (let c = 0; c < len - 1; c++) {
        const w = dragCol?.index === c ? dragCol.width : (colWidths.get(c) ?? CELL_W);
        prefix[c + 1] = prefix[c] + w;
    }
    return prefix;
}

function buildRowPrefixSums(
    rowHeights: Map<number, number>,
    dragRow: { index: number; height: number } | null,
): Float64Array {
    let maxIdx = -1;
    for (const k of rowHeights.keys()) { if (k > maxIdx) maxIdx = k; }
    if (dragRow && dragRow.index > maxIdx) maxIdx = dragRow.index;
    if (maxIdx < 0) return new Float64Array(1);

    const len = maxIdx + 2;
    const prefix = new Float64Array(len);
    prefix[0] = 0;
    for (let r = 0; r < len - 1; r++) {
        const h = dragRow?.index === r ? dragRow.height : (rowHeights.get(r) ?? CELL_H);
        prefix[r + 1] = prefix[r] + h;
    }
    return prefix;
}

// Returns the pixel offset of the left/top edge of index `i`.
function indexToOffset(prefix: Float64Array, i: number, defaultSize: number): number {
    const n = prefix.length; // prefix[n-1] is the right edge of index n-2
    if (i <= 0) return 0;
    if (i < n) return prefix[i];
    // Beyond the prefix array: all remaining cells use defaultSize.
    return prefix[n - 1] + (i - (n - 1)) * defaultSize;
}

// Binary search: returns the first index whose LEFT edge is >= pixel.
// Used to find the first visible column/row for a given scroll position.
function lowerBound(prefix: Float64Array, pixel: number, total: number, defaultSize: number): number {
    // Fast path: within the prefix array
    let lo = 0, hi = prefix.length - 1;
    // We want the largest index i such that prefix[i] <= pixel  →  then i is the
    // first column whose left edge is at or before `pixel`, meaning it is in view.
    // We actually want: first index whose right edge > pixel, i.e. first c where
    // prefix[c+1] > pixel, which means prefix[c] <= pixel < prefix[c+1].
    // Binary search for the largest prefix[i] <= pixel within the array.
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (prefix[mid] <= pixel) lo = mid;
        else hi = mid - 1;
    }
    // lo is now the index whose left edge is <= pixel (or 0).
    // Check if this is beyond the array.
    const n = prefix.length;
    if (lo < n - 1 || prefix[n - 1] <= pixel) {
        // Might need to go further into the uniform region.
        if (lo === n - 1 && prefix[n - 1] <= pixel) {
            // Into the uniform tail.
            const tail = pixel - prefix[n - 1];
            const extra = Math.floor(tail / defaultSize);
            return Math.min(total, n - 1 + extra);
        }
        return lo;
    }
    return lo;
}

// Compute the pixel offset of the left edge of index i using prefix sums.
// Equivalent to the old linear scan but O(1).
function colOffset(prefix: Float64Array, i: number): number {
    return indexToOffset(prefix, i, CELL_W);
}
function rowOffset(prefix: Float64Array, i: number): number {
    return indexToOffset(prefix, i, CELL_H);
}

function computeViewport(
    scrollTop: number, scrollLeft: number, clientHeight: number, clientWidth: number,
    colPrefix: Float64Array, rowPrefix: Float64Array,
) {
    // Columns
    const sc0 = lowerBound(colPrefix, scrollLeft, MAX_COLS, CELL_W);
    const sc = Math.max(0, sc0 - H_BUF);
    const ec0 = lowerBound(colPrefix, scrollLeft + clientWidth, MAX_COLS, CELL_W);
    const ec = Math.min(MAX_COLS, ec0 + 1 + H_BUF);

    // Rows
    const sr0 = lowerBound(rowPrefix, scrollTop, MAX_ROWS, CELL_H);
    const sr = Math.max(0, sr0 - V_BUF);
    const er0 = lowerBound(rowPrefix, scrollTop + clientHeight, MAX_ROWS, CELL_H);
    const er = Math.min(MAX_ROWS, er0 + 1 + V_BUF);

    return { sr, er, sc, ec };
}

export const SheetGrid = React.memo(function SheetGrid({
    data, selectedCells, cutCells, onCellActivate, onSelectionExtend,
    colWidths, rowHeights, onColResize, onRowResize,
    onColHeaderClick, onRowHeaderClick, highlightedCol, highlightedRow,
    formulaPickMode, onFormulaPickMouseDown, onFormulaPickMouseMove, formulaPickCells,
    onCellContextMenu, onColHeaderContextMenu, onRowHeaderContextMenu,
    columnFilters, scrollBodyRef, overlay, formulaRefHighlights, conditionalFormats, cfVariables,
    remotePresence,
}: SheetGridProps) {
    const bodyRef = useRef<HTMLDivElement>(null);

    // Sync the internal bodyRef to the optional external ref so callers can
    // imperatively scroll cells into view after arrow-key navigation.
    useEffect(() => {
        if (scrollBodyRef) {
            (scrollBodyRef as React.MutableRefObject<HTMLDivElement | null>).current = bodyRef.current;
        }
    });
    const colHdrTrackRef = useRef<HTMLDivElement>(null);
    const rowHdrTrackRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ sr: 0, er: 50, sc: 0, ec: 15 });
    const isDraggingRef = useRef(false);

    const [dragCol, setDragCol] = useState<{ index: number; width: number } | null>(null);
    const [dragRow, setDragRow] = useState<{ index: number; height: number } | null>(null);

    // ── Filter-derived hidden rows ────────────────────────────────────────────
    // Rows that don't match the active column filters get height 0 so they are
    // invisible in the virtualized grid without being deleted from the data map.
    const hiddenRows = useMemo(() => {
        if (!columnFilters || columnFilters.size === 0) return new Set<number>();
        const hidden = new Set<number>();
        let maxRow = 0;
        for (const id of data.keys()) {
            const m = id.match(/^[A-Z]+(\d+)$/);
            if (m) maxRow = Math.max(maxRow, parseInt(m[1]));
        }
        for (let r = 0; r < maxRow; r++) {
            for (const [colIdx, allowedValues] of columnFilters) {
                const cellId = `${numToAlpha(colIdx + 1)}${r + 1}`;
                const raw = data.get(cellId)?.raw ?? '';
                if (!allowedValues.has(raw)) {
                    hidden.add(r);
                    break;
                }
            }
        }
        return hidden;
    }, [columnFilters, data]);

    const effectiveRowHeights = useMemo(() => {
        if (hiddenRows.size === 0) return rowHeights;
        const m = new Map(rowHeights);
        for (const r of hiddenRows) m.set(r, 0);
        return m;
    }, [rowHeights, hiddenRows]);

    // ── Conditional formatting ────────────────────────────────────────────────
    const cfMap = useMemo(
        () => conditionalFormats && conditionalFormats.length > 0
            ? evaluateConditionalFormats(data, conditionalFormats, cfVariables, hiddenRows)
            : null,
        [data, conditionalFormats, cfVariables, hiddenRows],
    );

    // ── Cached prefix-sum arrays ──────────────────────────────────────────────
    // Recomputed only when colWidths/rowHeights maps or the active drag change.
    // All offset and visible-range lookups use these arrays instead of linear scans.
    const colPrefix = useMemo(
        () => buildColPrefixSums(colWidths, dragCol),
        [colWidths, dragCol],
    );
    const rowPrefix = useMemo(
        () => buildRowPrefixSums(effectiveRowHeights, dragRow),
        [effectiveRowHeights, dragRow],
    );

    // Stable refs for colPrefix/rowPrefix used in the scroll handler so the
    // scroll callback never needs to be re-created.
    const colPrefixRef = useRef(colPrefix);
    const rowPrefixRef = useRef(rowPrefix);
    useEffect(() => {
        colPrefixRef.current = colPrefix;
        rowPrefixRef.current = rowPrefix;
        const el = bodyRef.current;
        if (!el) return;
        const { scrollTop, scrollLeft, clientHeight, clientWidth } = el;
        setViewport(computeViewport(scrollTop, scrollLeft, clientHeight, clientWidth, colPrefix, rowPrefix));
    }, [colPrefix, rowPrefix]);

    const onScroll = useCallback(() => {
        const el = bodyRef.current;
        if (!el) return;
        const { scrollTop, scrollLeft, clientHeight, clientWidth } = el;
        if (colHdrTrackRef.current) colHdrTrackRef.current.style.transform = `translateX(-${scrollLeft}px)`;
        if (rowHdrTrackRef.current) rowHdrTrackRef.current.style.transform = `translateY(-${scrollTop}px)`;
        setViewport(computeViewport(scrollTop, scrollLeft, clientHeight, clientWidth, colPrefixRef.current, rowPrefixRef.current));
    }, []);

    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        onScroll();
        const ro = new ResizeObserver(onScroll);
        ro.observe(el);
        return () => ro.disconnect();
    }, [onScroll]);

    const getColWidth = useCallback((c: number) => {
        if (dragCol?.index === c) return dragCol.width;
        return colWidths.get(c) ?? CELL_W;
    }, [colWidths, dragCol]);

    const getRowHeight = useCallback((r: number) => {
        if (dragRow?.index === r) return dragRow.height;
        return effectiveRowHeights.get(r) ?? CELL_H;
    }, [effectiveRowHeights, dragRow]);

    const { sr, er, sc, ec } = viewport;

    // Pixel offset of the first visible column/row — O(1) via prefix sums.
    const scOffset = useMemo(() => colOffset(colPrefix, sc), [colPrefix, sc]);
    const srOffset = useMemo(() => rowOffset(rowPrefix, sr), [rowPrefix, sr]);

    const colLeftArr = useMemo(() => {
        const result: number[] = [];
        let x = scOffset;
        for (let c = sc; c < ec; c++) { result.push(x); x += getColWidth(c); }
        return result;
    }, [sc, ec, scOffset, getColWidth]);

    const rowTopArr = useMemo(() => {
        const result: number[] = [];
        let y = srOffset;
        for (let r = sr; r < er; r++) { result.push(y); y += getRowHeight(r); }
        return result;
    }, [sr, er, srOffset, getRowHeight]);

    const totalWidth = useMemo(() => {
        let w = MAX_COLS * CELL_W;
        for (const [, width] of colWidths) w += width - CELL_W;
        if (dragCol) w += dragCol.width - (colWidths.get(dragCol.index) ?? CELL_W);
        return w;
    }, [colWidths, dragCol]);

    const totalHeight = useMemo(() => {
        let h = MAX_ROWS * CELL_H;
        for (const [, height] of effectiveRowHeights) h += height - CELL_H;
        if (dragRow) h += dragRow.height - (effectiveRowHeights.get(dragRow.index) ?? CELL_H);
        return h;
    }, [effectiveRowHeights, dragRow]);

    const handleColResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = colWidths.get(colIndex) ?? CELL_W;
        setDragCol({ index: colIndex, width: startWidth });
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (ev: MouseEvent) => {
            setDragCol({ index: colIndex, width: Math.max(20, startWidth + ev.clientX - startX) });
        };
        const onMouseUp = (ev: MouseEvent) => {
            const newWidth = Math.max(20, startWidth + ev.clientX - startX);
            onColResize(colIndex, newWidth);
            setDragCol(null);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [colWidths, onColResize]);

    const handleRowResizeStart = useCallback((e: React.MouseEvent, rowIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startHeight = rowHeights.get(rowIndex) ?? CELL_H;
        setDragRow({ index: rowIndex, height: startHeight });
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (ev: MouseEvent) => {
            setDragRow({ index: rowIndex, height: Math.max(12, startHeight + ev.clientY - startY) });
        };
        const onMouseUp = (ev: MouseEvent) => {
            const newHeight = Math.max(12, startHeight + ev.clientY - startY);
            onRowResize(rowIndex, newHeight);
            setDragRow(null);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [rowHeights, onRowResize]);

    const cellFromEvent = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const el = (e.target as HTMLElement).closest('[data-type="cell"]') as HTMLElement | null;
        return el?.id ?? null;
    }, []);

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const id = cellFromEvent(e);
        if (!id) return;

        // Formula pick mode: insert cell reference into formula bar.
        if (formulaPickMode && onFormulaPickMouseDown) {
            e.preventDefault(); // prevent formula bar from losing focus
            isDraggingRef.current = true;
            onFormulaPickMouseDown(id);
            return;
        }

        e.preventDefault();
        if (e.shiftKey) {
            onSelectionExtend(id);
        } else {
            isDraggingRef.current = true;
            onCellActivate(id);
        }
    }, [cellFromEvent, onCellActivate, onSelectionExtend, formulaPickMode, onFormulaPickMouseDown]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDraggingRef.current || e.buttons === 0) return;
        const id = cellFromEvent(e);
        if (!id) return;

        // Formula pick mode: update the range reference as the drag moves.
        if (formulaPickMode && onFormulaPickMouseMove) {
            onFormulaPickMouseMove(id);
            return;
        }

        onSelectionExtend(id);
    }, [cellFromEvent, onSelectionExtend, formulaPickMode, onFormulaPickMouseMove]);

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const id = cellFromEvent(e);
        if (!id || !onCellContextMenu) return;
        e.preventDefault();
        onCellContextMenu(id, e.clientX, e.clientY);
    }, [cellFromEvent, onCellContextMenu]);

    const computeRangeBox = useCallback((cells: Set<string>) => {
        if (cells.size === 0) return null;
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const id of cells) {
            const match = id.match(/^([A-Z]+)(\d+)$/);
            if (match) {
                const c = alphaToNum(match[1]) - 1;
                const r = parseInt(match[2]) - 1;
                if (r < minR) minR = r;
                if (c < minC) minC = c;
                const cell = data.get(id);
                const cellMaxC = c + (cell?.colSpan ?? 1) - 1;
                const cellMaxR = r + (cell?.rowSpan ?? 1) - 1;
                if (cellMaxC > maxC) maxC = cellMaxC;
                if (cellMaxR > maxR) maxR = cellMaxR;
            }
        }
        if (minR === Infinity) return null;
        // Use prefix-sum arrays for O(1) offset lookups instead of linear scans.
        const left = colOffset(colPrefix, minC);
        const top = rowOffset(rowPrefix, minR);
        const right = colOffset(colPrefix, maxC + 1);
        const bottom = rowOffset(rowPrefix, maxR + 1);
        return { top, left, width: right - left, height: bottom - top };
    }, [data, colPrefix, rowPrefix]);

    const selectionOverlay = useMemo(() => {
        const box = computeRangeBox(selectedCells);
        if (!box) return null;
        return (
            <div style={{
                position: 'absolute', ...box,
                border: '2px solid var(--color-accent, #1a73e8)', pointerEvents: 'none', zIndex: 1,
            }} />
        );
    }, [selectedCells, computeRangeBox]);

    const cutOverlay = useMemo(() => {
        if (!cutCells || cutCells.size === 0) return null;
        const box = computeRangeBox(cutCells);
        if (!box) return null;
        return (
            <div style={{
                position: 'absolute', ...box,
                border: '2px dashed var(--color-accent, #1a73e8)', pointerEvents: 'none', zIndex: 1,
            }} />
        );
    }, [cutCells, computeRangeBox]);

    // Formula pick overlay — rendered on top of the normal selection overlay
    // using a distinct green dashed border so users can clearly see the range
    // they are picking for the formula.
    const formulaPickOverlay = useMemo(() => {
        if (!formulaPickMode || !formulaPickCells || formulaPickCells.size === 0) return null;
        const box = computeRangeBox(formulaPickCells);
        if (!box) return null;
        return (
            <div style={{
                position: 'absolute', ...box,
                border: '2px dashed #0f9d58',
                background: 'rgba(15, 157, 88, 0.08)',
                pointerEvents: 'none', zIndex: 3,
            }} />
        );
    }, [formulaPickMode, formulaPickCells, computeRangeBox]);

    // Remote presence overlays — one colored border + name label per connected peer.
    const remotePresenceOverlays = useMemo(() => {
        if (!remotePresence || remotePresence.length === 0) return null;
        return remotePresence.map(({ clientId, cellId, color, name }) => {
            const box = computeRangeBox(new Set([cellId]));
            if (!box) return null;
            return (
                <div
                    key={`presence-${clientId}`}
                    style={{
                        position: 'absolute', ...box,
                        border: `2px solid ${color}`,
                        pointerEvents: 'none', zIndex: 2,
                    }}
                >
                    <div style={{
                        position: 'absolute',
                        top: -18,
                        left: -1,
                        background: color,
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: '3px 3px 3px 0',
                        whiteSpace: 'nowrap',
                        lineHeight: '16px',
                        userSelect: 'none',
                    }}>
                        {name}
                    </div>
                </div>
            );
        });
    }, [remotePresence, computeRangeBox]);

    // Formula reference overlays — one colored border per unique cell ref/range
    // in the formula being typed. Mirrors the behavior in Excel / Google Sheets.
    const formulaRefOverlays = useMemo(() => {
        if (!formulaRefHighlights || formulaRefHighlights.length === 0) return null;
        return formulaRefHighlights.map(({ cells, color }, i) => {
            const box = computeRangeBox(cells);
            if (!box) return null;
            return (
                <div
                    key={`formula-ref-${i}`}
                    style={{
                        position: 'absolute', ...box,
                        border: `2px solid ${color}`,
                        pointerEvents: 'none', zIndex: 2,
                    }}
                />
            );
        });
    }, [formulaRefHighlights, computeRangeBox]);

    const colHeaders: React.ReactNode[] = [];
    for (let c = sc; c < ec; c++) {
        const left = colLeftArr[c - sc];
        const width = getColWidth(c);
        const isColHighlighted = highlightedCol === c;
        const isFiltered = columnFilters?.has(c) ?? false;
        colHeaders.push(
            <div
                key={c}
                className={`${styles.headerRowCell}${isColHighlighted ? ` ${styles.headerRowCellSelected}` : ''}`}
                style={{ position: 'absolute', left, top: 0, width, height: COL_HDR_H, minWidth: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => onColHeaderClick?.(c)}
                onContextMenu={e => { e.preventDefault(); onColHeaderContextMenu?.(c, e.clientX, e.clientY); }}
            >
                <span className={styles.center} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {numToAlpha(c + 1)}
                    {isFiltered && <Filter size={9} style={{ color: '#0064ff', flexShrink: 0 }} />}
                </span>
                <div className={styles.colResizeHandle} onMouseDown={e => handleColResizeStart(e, c)} onClick={e => e.stopPropagation()} />
            </div>
        );
    }

    const rowHeaders: React.ReactNode[] = [];
    for (let r = sr; r < er; r++) {
        const top = rowTopArr[r - sr];
        const height = getRowHeight(r);
        if (height === 0) continue;
        const isRowHighlighted = highlightedRow === r;
        rowHeaders.push(
            <div
                key={r}
                className={`${styles.headerColumnCell}${isRowHighlighted ? ` ${styles.headerColumnCellSelected}` : ''}`}
                style={{ position: 'absolute', top, left: 0, width: ROW_HDR_W, height, minWidth: 'unset', maxHeight: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => onRowHeaderClick?.(r)}
                onContextMenu={e => { e.preventDefault(); onRowHeaderContextMenu?.(r, e.clientX, e.clientY); }}
            >
                <span className={styles.center}>{r + 1}</span>
                <div className={styles.rowResizeHandle} onMouseDown={e => handleRowResizeStart(e, r)} onClick={e => e.stopPropagation()} />
            </div>
        );
    }

    const cells: React.ReactNode[] = [];
    for (let r = sr; r < er; r++) {
        for (let c = sc; c < ec; c++) {
            const id = `${numToAlpha(c + 1)}${r + 1}`;
            const cell = data.get(id) || { id, value: '', raw: '', edit: false };
            if (cell.mergeAnchor) continue;
            const colSpan = cell.colSpan ?? 1;
            const rowSpan = cell.rowSpan ?? 1;
            let cellWidth = 0;
            for (let cs = 0; cs < colSpan; cs++) cellWidth += getColWidth(c + cs);
            let cellHeight = 0;
            for (let rs = 0; rs < rowSpan; rs++) cellHeight += getRowHeight(r + rs);

            // Empty cells (no content, no explicit background, no CF) are made
            // transparent so that overflow text from the left neighbour shows
            // through. Later-in-DOM siblings with content paint over the overflow
            // naturally, clipping it at the correct column boundary.
            const hasContent = !!(cell.raw?.trim() || cell.value?.toString().trim());
            const hasBackground = !!(cell.cellStyle?.backgroundColor || cfMap?.get(id));
            const transparentBg = !hasContent && !hasBackground;

            cells.push(
                <Cell
                    key={id}
                    id={id}
                    value={cell.edit ? cell.raw : cell.value}
                    raw={cell.raw}
                    edit={false}
                    selected={selectedCells.has(id)}
                    cellStyle={cell.cellStyle}
                    cfResult={cfMap?.get(id)}
                    style={{ position: 'absolute', top: rowTopArr[r - sr], left: colLeftArr[c - sc], width: cellWidth, height: cellHeight, minWidth: 'unset', maxWidth: 'unset', zIndex: colSpan > 1 || rowSpan > 1 ? 1 : undefined, ...(transparentBg ? { backgroundColor: 'transparent' } : {}) }}
                />
            );
        }
    }

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div className={styles.headerCorner} style={{ position: 'absolute', top: 0, left: 0, width: ROW_HDR_W, height: COL_HDR_H, zIndex: 3 }} />
            <div style={{ position: 'absolute', top: 0, left: ROW_HDR_W, right: 0, height: COL_HDR_H, overflow: 'hidden', zIndex: 2 }}>
                <div ref={colHdrTrackRef} style={{ position: 'relative', width: totalWidth, height: '100%' }}>
                    {colHeaders}
                </div>
            </div>
            <div style={{ position: 'absolute', top: COL_HDR_H, left: 0, width: ROW_HDR_W, bottom: 0, overflow: 'hidden', zIndex: 2 }}>
                <div ref={rowHdrTrackRef} style={{ position: 'relative', width: '100%', height: totalHeight }}>
                    {rowHeaders}
                </div>
            </div>
            <div
                ref={bodyRef}
                style={{ position: 'absolute', top: COL_HDR_H, left: ROW_HDR_W, right: 0, bottom: 0, overflow: 'scroll' }}
                onScroll={onScroll}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={handleContextMenu}
            >
                <div style={{ position: 'relative', width: totalWidth, height: totalHeight, backgroundColor: '#ffffff' }}>
                    {cells}
                    {selectionOverlay}
                    {cutOverlay}
                    {formulaRefOverlays}
                    {formulaPickOverlay}
                    {remotePresenceOverlays}
                    {overlay}
                </div>
            </div>
        </div>
    );
});
