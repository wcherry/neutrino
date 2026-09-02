'use client';

import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, useDeferredValue } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { VersionHistoryPanel } from '@/components/VersionHistoryPanel';
import {
    sheetsApi, filesystemApi, driveAutosaveEncryptedBytes,
    mintFileKey, canEncryptFor,
} from '@/lib/api';
import { withOoxmlExtension } from '@/lib/officeFormats';
import { useToast } from '@neutrino/ui';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import { useUser } from '@neutrino/auth';
import { useSheetPresence, type CellSyncItem } from '@/hooks/useSheetPresence';
import type { CellProps, ClipboardCFRule, CFRule, SheetFile, TableRegion } from './types';
import type { SheetTemplate } from './templates/sheetTemplates';
import { sheetFileToSheetsData } from './hooks/sheetFileUtils';
import { rangeAddress, numToAlpha, alphaToNum, navigateCell, parseCellId, getRangeCells, getCellBounds, type ArrowNavigationKey } from './utils';
import { useHistory } from './hooks/useHistory';
import { useClipboard } from './hooks/useClipboard';
import { useSheets } from './hooks/useSheets';
import { usePersistence } from './hooks/usePersistence';
import { useExport } from './hooks/useExport';
import { useCellEditing } from './hooks/useCellEditing';
import { useConditionalFormatting } from './hooks/useConditionalFormatting';
import { useTableRegions } from './hooks/useTableRegions';
import { computeStructuralShift } from './structuralShift';
import {
    selectHeader, extendHeaderSelection, headerRuns, headerSelectionLabel,
    headerSelectionCellBounds, headerSelectionCells,
    type HeaderAxis, type HeaderClickModifiers, type HeaderSelection,
} from './headerSelection';
import type { TableStyle } from './styles/tableStyles';
import { ConditionalFormattingDialog } from './ConditionalFormattingDialog';
import { useSpellCheck } from '@/hooks/useSpellCheck';
import { useNspell } from '@/hooks/useNspell';
import { computeCell, propagateDeps, type SheetRef } from './formula';
import type { CellStyle } from './types';

import { StyleToolbar } from './StyleToolbar';
import { SheetGrid } from './SheetGrid';
import { SheetContextMenu } from './SheetContextMenu';
import { HeaderContextMenu } from './HeaderContextMenu';
import { FilterDialog } from './FilterDialog';
import { FindReplaceDialog } from './FindReplaceDialog';
import { FormulaBar } from './components/FormulaBar';
import { HamburgerMenu } from './components/HamburgerMenu';
import { ExportDialogs } from './components/ExportDialogs';
import { SheetTabBar } from './components/SheetTabBar';
import { SheetZoomProvider } from './zoom';
import { ShareButton, ZoomSlider } from '@neutrino/ui';
import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import type { FileItem } from '@/lib/api';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { useCharts } from './charts/useCharts';
import { ChartLayer } from './charts/ChartLayer';
import { ChartCreationDialog } from './charts/ChartCreationDialog';
import { ChartEditorPanel } from './charts/ChartEditorPanel';
import styles from './page.module.css';
import { useAccessRevocation } from '@/hooks/useAccessRevocation';

type SheetKeyboardMode = 'movement' | 'formula';

// ── Import parsers ────────────────────────────────────────────────────────────

function parseCsvRow(row: string): string[] {
    const cols: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        if (row[i] === '"') {
            if (inQuotes && i + 1 < row.length && row[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (row[i] === ',' && !inQuotes) {
            cols.push(current); current = '';
        } else {
            current += row[i];
        }
    }
    cols.push(current);
    return cols;
}

function parseCsvToMap(text: string): Map<string, CellProps> {
    const map = new Map<string, CellProps>();
    text.split(/\r?\n/).forEach((line, rowIndex) => {
        if (!line.trim()) return;
        parseCsvRow(line).forEach((val, colIndex) => {
            const id = `${numToAlpha(colIndex + 1)}${rowIndex + 1}`;
            if (val !== '') map.set(id, { id, raw: val, edit: false });
        });
    });
    return map;
}

/**
 * An uploaded `.xlsx` as tabs of cells.
 *
 * Through `readXlsx`, the same reader that opens a stored spreadsheet — so a
 * workbook dropped in here arrives with its formulas, number formats, fills,
 * borders and merges, not just its values. This used to be its own pass of
 * SheetJS at the defaults, reading `cell.w`: a percentage came in as the text
 * `15%` and a formula did not come in at all.
 */
async function parseXlsxToSheets(
    buffer: ArrayBuffer,
): Promise<{ name: string; data: Map<string, CellProps> }[]> {
    const { readXlsx } = await import('@/lib/ooxml/xlsx/read');
    const file = await readXlsx(new Uint8Array(buffer));
    return file.sheets.map(sheet => ({
        name: sheet.name ?? 'Sheet',
        data: new Map(Object.entries(sheet.cells).map(([id, cell]) => [id, { ...cell, edit: false }])),
    }));
}

async function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

export function SheetEditor() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const flags = useFeatureFlags();
    const sheetId = searchParams.get('id') ?? '';
    useAccessRevocation(sheetId);

    const currentUser = useUser();
    const toast = useToast();
    const [authToken, setAuthToken] = useState<string | null>(null);
    useEffect(() => {
        setAuthToken(localStorage.getItem('access_token'));
    }, []);

    // ── Core state & refs ────────────────────────────────────────────────────
    const [currentCell, setCurrentCell] = useState<CellProps | undefined>();
    const [selectionAnchor, setSelectionAnchor] = useState<string | undefined>(undefined);
    const [selectionActive, setSelectionActive] = useState<string | undefined>(undefined);

    const onRemoteCellsRef = useRef<((sheetIndex: number, cells: CellSyncItem[]) => void) | null>(null);
    const isApplyingRemoteRef = useRef(false);
    const prevDataForBroadcastRef = useRef<Map<string, CellProps> | null>(null);
    const broadcastCellsRef = useRef<(sheetIndex: number, cells: CellSyncItem[]) => void>(() => {});
    const isViewerRef = useRef(false);

    // Presence is keyed on the Drive file id and carries the editor's own cell
    // model, so it does not care which format the file is stored in. It used to
    // be skipped for `.xlsx` files back when those were only ever uploads
    // (issue #43); leaving it that way now would mean no spreadsheet created
    // from this point on could be co-edited.
    const { remoteUsers, broadcastCells } = useSheetPresence({
        sheetId,
        userName: currentUser?.name ?? 'Anonymous',
        authToken,
        enabled: !!sheetId,
        selectedCellId: selectionAnchor ?? null,
        onRemoteCellsRef,
    });
    useEffect(() => { broadcastCellsRef.current = broadcastCells; }, [broadcastCells]);
    const [keyboardMode, setKeyboardMode] = useState<SheetKeyboardMode>('movement');
    const [data, setData] = useState<Map<string, CellProps>>(new Map());
    const dataRef = useRef<Map<string, CellProps>>(data);
    // Tracks the most-recently eagerly committed data (from activateCell's eager block).
    // useLayoutEffect overwrites dataRef with the pre-transition React state after
    // urgent updates; this ref is immune to that and lets flushActiveSheet use the
    // correct data during flush-on-unmount (SPA navigation immediately after editing).
    const eagerDataRef = useRef<Map<string, CellProps> | null>(null);
    const [colWidths, setColWidths] = useState<Map<number, number>>(new Map());
    const colWidthsRef = useRef<Map<number, number>>(new Map());
    const [rowHeights, setRowHeights] = useState<Map<number, number>>(new Map());
    const rowHeightsRef = useRef<Map<number, number>>(new Map());

    // Stable refs so clipboard/keyboard handlers always see current selection.
    const selectionAnchorRef = useRef<string | undefined>(undefined);
    const selectionActiveRef = useRef<string | undefined>(undefined);

    // Marks unsaved changes; read by the timed-save interval and size-change effect.
    const dirtyRef = useRef(false);

    // Always holds the latest currentCell so flush-on-unmount / timer saves can
    // read it from outside the React render cycle (refs are not affected by stale
    // closures the way state is).
    const currentCellRef = useRef<CellProps | undefined>(undefined);

    // Declared here (before flushActiveSheetForPersist and useCellEditing) so
    // flushActiveSheetForPersist can reference it without a forward reference to
    // `editing`. Passed into useCellEditing so both share the same ref object.
    const formulaInputRef = useRef<HTMLInputElement>(null);

    // Ref to the scrollable body container inside SheetGrid, used to scroll
    // newly selected cells into view after arrow-key navigation.
    const scrollBodyRef = useRef<HTMLDivElement | null>(null);

    // Ref for the title contentEditable; kept separate from dangerouslySetInnerHTML
    // so React never overwrites user-typed content during re-renders.
    const titleInputRef = useRef<HTMLDivElement | null>(null);

    // The selected row / column headers, or null when the selection is cell-based.
    const [headerSelection, setHeaderSelection] = useState<HeaderSelection | null>(null);
    // Read by the header mouse handlers, which are called back-to-back during a
    // drag and must each see the selection the previous one produced.
    const headerSelectionRef = useRef<HeaderSelection | null>(null);
    headerSelectionRef.current = headerSelection;

    const [hamburgerDialog, setHamburgerDialog] = useState<string | null>(null);
    const [hamburgerDeleteConfirm, setHamburgerDeleteConfirm] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [findReplaceMode, setFindReplaceMode] = useState<'find' | 'replace' | null>(null);
    const [showShareDialog, setShowShareDialog] = useState(false);

    // ── Grid zoom ────────────────────────────────────────────────────────────
    // A view setting, like it is in docs, slides and drawing: held for the
    // session and never written into the file.
    const [zoom, setZoom] = useState(100);

    // ── Conditional formatting state (feature-flagged) ───────────────────────
    const [showCFDialog, setShowCFDialog] = useState(false);
    const [cfVariables, setCfVariables] = useState(() => {
        try { return JSON.parse(localStorage.getItem('neutrino:sheets:cf-variables') ?? '[]'); } catch { return []; }
    });

    // ── Chart state (feature-flagged) ────────────────────────────────────────
    const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
    const [showChartDialog, setShowChartDialog] = useState(false);
    const queryClient = useQueryClient();
    const suppressNextFormulaFocusModeRef = useRef(false);

    // ── Format Painter state ─────────────────────────────────────────────────
    const [formatPainterSource, setFormatPainterSource] = useState<{
        anchor: string;
        active: string | undefined;
    } | null>(null);
    const formatPainterSourceRef = useRef<{ anchor: string; active: string | undefined } | null>(null);
    const applyFormatPaintRef = useRef<(destAnchor: string, destActive: string | undefined) => void>(() => {});
    const didApplyPaintRef = useRef(false);

    // Keep currentCellRef always current. Assigned in render (not in a useEffect)
    // so timer callbacks and unmount cleanup always see the latest committed value
    // without waiting for a subsequent effect flush.
    currentCellRef.current = currentCell;

    // Sync state → refs so event handlers always see current values.
    // useLayoutEffect for dataRef ensures it's updated synchronously after every
    // commit (before paint), so activateCell's startTransition always reads a
    // current map — preventing stale data from overwriting in-flight state like
    // colSpan/rowSpan set by a preceding mergeCells call.
    useLayoutEffect(() => {
        dataRef.current = data;
        // dataRef is now current; any pending eager data is superseded.
        eagerDataRef.current = null;
    }, [data]);
    useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);
    useEffect(() => { rowHeightsRef.current = rowHeights; }, [rowHeights]);
    useLayoutEffect(() => { selectionAnchorRef.current = selectionAnchor; }, [selectionAnchor]);
    useLayoutEffect(() => { selectionActiveRef.current = selectionActive; }, [selectionActive]);
    useLayoutEffect(() => { formatPainterSourceRef.current = formatPainterSource; }, [formatPainterSource]);


    // ── Hooks ────────────────────────────────────────────────────────────────
    const history = useHistory({
        dataRef, setData,
        setCurrentCell,
        setSelectionAnchor, setSelectionActive,
    });

    const sheets = useSheets({
        dataRef, colWidthsRef, rowHeightsRef,
        setData, setColWidths, setRowHeights,
        dirtyRef,
        resetHistoryAndSelection: history.resetHistoryAndSelection,
    });

    const charts = useCharts({
        dataRef,
        dirtyRef,
        activeSheetIndexRef: sheets.activeSheetIndexRef,
    });

    const cf = useConditionalFormatting({
        dirtyRef,
        activeSheetIndexRef: sheets.activeSheetIndexRef,
    });

    const tableRegions = useTableRegions({
        dirtyRef,
        activeSheetIndexRef: sheets.activeSheetIndexRef,
    });

    // Wrapped flushActiveSheet for usePersistence: ensures in-flight edits are
    // captured before serialization, whether they reached the eager-commit stage
    // (activateCell ran) or are still only in the formula bar DOM (user typed but
    // hasn't pressed Enter yet, so startTransition hasn't committed to dataRef).
    const flushActiveSheetForPersist = useCallback(() => {
        if (eagerDataRef.current !== null) {
            // activateCell already eagerly committed the cell — use that snapshot.
            dataRef.current = eagerDataRef.current;
        } else {
            // startTransition from handleTextChange may not have committed yet
            // (e.g. the 3-second timer fired between fill() and Enter). Read the
            // formula bar DOM directly as the ground truth for the cell being typed.
            const formulaInput = formulaInputRef.current;
            const cc = currentCellRef.current;
            if (formulaInput && cc?.edit && cc.id) {
                const raw = formulaInput.value;
                const eagerMap = new Map(dataRef.current);
                const prevCell = eagerMap.get(cc.id) ?? { id: cc.id, value: '', raw: '', edit: false };
                eagerMap.set(cc.id, { ...prevCell, raw, edit: false });
                dataRef.current = eagerMap;
            }
        }
        sheets.flushActiveSheet();
    // dataRef, eagerDataRef, formulaInputRef, and currentCellRef are all stable
    // ref objects — safe to use without listing as deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sheets]);

    const persist = usePersistence({
        sheetId, dirtyRef,
        sheetsDataRef: sheets.sheetsDataRef,
        sheetsColWidthsRef: sheets.sheetsColWidthsRef,
        sheetsRowHeightsRef: sheets.sheetsRowHeightsRef,
        activeSheetIndexRef: sheets.activeSheetIndexRef,
        sheetNamesRef: sheets.sheetNamesRef,
        sheetColorsRef: sheets.sheetColorsRef,
        flushActiveSheet: flushActiveSheetForPersist,
        setData, setColWidths, setRowHeights,
        setSheetNames: sheets.setSheetNames,
        setSheetColors: sheets.setSheetColors,
        sheetsChartsRef: flags.sheetsCharts ? charts.sheetsChartsRef : undefined,
        flushActiveCharts: flags.sheetsCharts ? charts.flushActiveCharts : undefined,
        setCharts: flags.sheetsCharts ? charts.setCharts : undefined,
        sheetsConditionalFormatsRef: flags.sheetsConditionalFormatting ? cf.sheetsConditionalFormatsRef : undefined,
        flushActiveConditionalFormats: flags.sheetsConditionalFormatting ? cf.flushActiveConditionalFormats : undefined,
        setConditionalFormats: flags.sheetsConditionalFormatting ? cf.setConditionalFormats : undefined,
        sheetsTableRegionsRef: tableRegions.sheetsTableRegionsRef,
        flushActiveTableRegions: tableRegions.flushActiveTableRegions,
        setTableRegions: tableRegions.setTableRegions,
    });

    const isViewer = persist.yourRole === 'viewer';
    useEffect(() => { isViewerRef.current = isViewer; }, [isViewer]);

    // ── Cross-sheet reference helper ─────────────────────────────────────────
    // Builds the SheetRef[] array needed by computeCell / propagateDeps so that
    // formulas like =Beta!C4 can resolve values from other sheets.
    // Must be called after flushActiveSheet() to ensure the active sheet's latest
    // data is in sheetsDataRef before being included in the list.
    const getAllSheets = useCallback((): SheetRef[] => {
        sheets.flushActiveSheet();
        return sheets.sheetNamesRef.current.map((name, i) => ({
            name,
            data: sheets.sheetsDataRef.current[i] ?? new Map(),
        }));
    }, [sheets]);

    // Populate after getAllSheets is available — called by useSheetPresence when a
    // type-2 (cell update) message arrives from a remote peer.
    onRemoteCellsRef.current = (sheetIndex: number, cells: CellSyncItem[]) => {
        if (sheetIndex !== sheets.activeSheetIndexRef.current) return;
        isApplyingRemoteRef.current = true;
        const allSheets = getAllSheets();
        setData(prev => {
            const next = new Map(prev);
            const changedIds = new Set<string>();
            for (const item of cells) {
                changedIds.add(item.id);
                if (!item.raw) {
                    next.delete(item.id);
                } else {
                    const existing = next.get(item.id) ?? { id: item.id, edit: false };
                    const { value, deps } = computeCell(item.raw, next, allSheets);
                    next.set(item.id, {
                        ...existing,
                        raw: item.raw,
                        value,
                        deps,
                        edit: false,
                        cellStyle: item.cellStyle as CellStyle | undefined,
                        colSpan: item.colSpan,
                        rowSpan: item.rowSpan,
                        mergeAnchor: item.mergeAnchor,
                    });
                }
            }
            for (const id of changedIds) {
                if (next.has(id)) propagateDeps(id, next, changedIds, allSheets);
            }
            return next;
        });
    };

    // Broadcast local data changes to remote peers. Runs after every commit that
    // changes `data`. Remote-applied updates set isApplyingRemoteRef to prevent
    // echoing changes back.
    useLayoutEffect(() => {
        console.log('[sheets-sync] data changed, isRemote=', isApplyingRemoteRef.current, 'prevIsNull=', prevDataForBroadcastRef.current === null, 'dataSize=', data.size);
        if (isApplyingRemoteRef.current) {
            isApplyingRemoteRef.current = false;
            prevDataForBroadcastRef.current = data;
            return;
        }
        const prev = prevDataForBroadcastRef.current;
        prevDataForBroadcastRef.current = data;
        if (prev === null) return; // initial mount — capture baseline, don't broadcast

        const changed: CellSyncItem[] = [];
        for (const [id, cell] of data) {
            if (cell.edit) continue;
            const prevCell = prev.get(id);
            // prevCell.edit means the cell just committed (typing set edit: true on every
            // keystroke so prev captured the typed raw — raw equality alone won't catch it)
            if (!prevCell
                || prevCell.raw !== cell.raw
                || prevCell.edit
                || prevCell.colSpan !== cell.colSpan
                || prevCell.rowSpan !== cell.rowSpan
                || prevCell.mergeAnchor !== cell.mergeAnchor
                || JSON.stringify(prevCell.cellStyle) !== JSON.stringify(cell.cellStyle)) {
                changed.push({
                    id,
                    raw: cell.raw ?? '',
                    cellStyle: cell.cellStyle as Record<string, unknown> | undefined,
                    colSpan: cell.colSpan,
                    rowSpan: cell.rowSpan,
                    mergeAnchor: cell.mergeAnchor,
                });
            }
        }
        for (const id of prev.keys()) {
            if (!data.has(id)) changed.push({ id, raw: '' });
        }
        if (changed.length > 0) {
            broadcastCellsRef.current(sheets.activeSheetIndexRef.current, changed);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const editing = useCellEditing({
        data, setData, dataRef,
        currentCell, setCurrentCell,
        selectionAnchor, selectionActive,
        setSelectionAnchor, setSelectionActive,
        dirtyRef,
        pushToUndo: history.pushToUndo,
        pushPatchToUndo: history.pushPatchToUndo,
        snapshotBeforeEditRef: history.snapshotBeforeEditRef,
        getAllSheets,
        eagerDataRef,
        formulaInputRef,
    });

    // ── Selected cells ───────────────────────────────────────────────────────
    // A header selection is not a rectangle (Cmd+click can leave gaps), so it
    // cannot be expressed as the anchor/active pair `editing.selectedCells` is
    // built from. Everything downstream — clear, styling, the table gallery —
    // reads this instead, so it acts on exactly the highlighted cells.
    //
    // Deferred, because materialising it is the one expensive part of a header
    // selection — a column is MAX_ROWS cell ids — and dragging across headers
    // produces a new selection on every mousemove. The highlight is painted from
    // the header indices instead (see `gridHeaderSelection`), so nothing on
    // screen waits for this; React discards the intermediate drag steps and only
    // builds the set once the drag settles, well before any menu or toolbar
    // click can read it.
    // Deferring only applies while a header selection stands: clearing one must
    // take effect at once, or the deferred value would keep the departed columns
    // in the set for a frame after a cell has been clicked.
    const deferredHeaderSelection = useDeferredValue(headerSelection);
    const settledHeaderSelection = headerSelection ? deferredHeaderSelection : null;
    const selectedCells = useMemo(
        () => settledHeaderSelection ? headerSelectionCells(settledHeaderSelection) : editing.selectedCells,
        [settledHeaderSelection, editing.selectedCells],
    );

    // What SheetGrid needs to paint the header selection: O(1) membership for
    // the highlight and one box per contiguous block for the outline.
    const gridHeaderSelection = useMemo(
        () => headerSelection
            ? {
                axis: headerSelection.axis,
                indices: new Set(headerSelection.indices),
                runs: headerRuns(headerSelection.indices),
            }
            : null,
        [headerSelection],
    );

    // The two exact readers of the selection. They go through the live ref
    // rather than the deferred `selectedCells` above, so an operation always
    // acts on what is highlighted right now.
    const getSelectedCells = useCallback(() => {
        const selection = headerSelectionRef.current;
        return selection ? headerSelectionCells(selection) : editing.selectedCells;
    }, [editing.selectedCells]);

    const isCellSelected = useCallback((cellId: string) => {
        const selection = headerSelectionRef.current;
        if (!selection) return editing.selectedCells.has(cellId);
        const parsed = parseCellId(cellId);
        if (!parsed) return false;
        return selection.indices.includes((selection.axis === 'col' ? parsed.col : parsed.row) - 1);
    }, [editing.selectedCells]);

    // `editing.applyStyle` derives its target from the anchor/active rectangle,
    // which over-covers a non-contiguous header selection — route those through
    // the per-cell path so the gaps are left alone.
    const applyStyleToSelection = useCallback((style: Partial<CellStyle>) => {
        if (!headerSelectionRef.current) {
            editing.applyStyle(style);
            return;
        }
        const patches = new Map<string, Partial<CellStyle>>();
        for (const id of getSelectedCells()) patches.set(id, style);
        editing.applyStyleMap(patches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing.applyStyle, editing.applyStyleMap, getSelectedCells]);

    // Stable refs for document-level keyboard handler; updated every render so
    // the effect with empty deps always reads the latest values without re-registering.
    const applyStyleRef = useRef(applyStyleToSelection);
    applyStyleRef.current = applyStyleToSelection;
    const selectedCellStyleRef = useRef(editing.selectedCellStyle);
    selectedCellStyleRef.current = editing.selectedCellStyle;

    // Document-level Ctrl/Cmd+B and +I shortcuts for cell formatting.
    // Using document.addEventListener (not onKeyDown on the wrapper div) ensures
    // the handler fires regardless of which child element has focus.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (isViewerRef.current) return;
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
            if ((document.activeElement as HTMLElement | null)?.isContentEditable) return;
            if (e.key.toLowerCase() === 'b') {
                e.preventDefault();
                applyStyleRef.current({ fontWeight: selectedCellStyleRef.current?.fontWeight === 'bold' ? 'normal' : 'bold' });
            } else if (e.key.toLowerCase() === 'i') {
                e.preventDefault();
                applyStyleRef.current({ fontStyle: selectedCellStyleRef.current?.fontStyle === 'italic' ? 'normal' : 'italic' });
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []); // empty deps — handler reads from refs, never stale

    // Ctrl/Cmd+F = Find, Ctrl/Cmd+H = Find & Replace
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
            if (e.key === 'f') {
                e.preventDefault();
                setFindReplaceMode('find');
            } else if (e.key === 'h') {
                e.preventDefault();
                setFindReplaceMode('replace');
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []); // empty deps — setFindReplaceMode is a stable setter

    // Stable refs for arrow-key navigation; updated every render so the effect
    // with empty deps always reads the latest values without re-registering.
    const selectionAnchorNavRef = useRef(selectionAnchor);
    selectionAnchorNavRef.current = selectionAnchor;
    const selectionActiveNavRef = useRef(selectionActive);
    selectionActiveNavRef.current = selectionActive;
    const keyboardModeNavRef = useRef(keyboardMode);
    keyboardModeNavRef.current = keyboardMode;
    const dataNavRef = useRef(data);
    dataNavRef.current = data;
    const formulaInputNavRef = useRef(editing.formulaInputRef);
    formulaInputNavRef.current = editing.formulaInputRef;
    const stableOnCellActivateNavRef = useRef(editing.stableOnCellActivate);
    stableOnCellActivateNavRef.current = editing.stableOnCellActivate;
    const stableOnSelectionExtendNavRef = useRef(editing.stableOnSelectionExtend);
    stableOnSelectionExtendNavRef.current = editing.stableOnSelectionExtend;
    const beginTypingInFormulaBarNavRef = useRef(editing.beginTypingInFormulaBar);
    beginTypingInFormulaBarNavRef.current = editing.beginTypingInFormulaBar;
    // Initialized with a no-op; updated after clearHeaderSelection is defined below.
    const clearHeaderSelectionNavRef = useRef<() => void>(() => {});
    // Initialized with a no-op; updated after handleClearCells is defined below.
    const handleClearCellsNavRef = useRef<() => void>(() => {});

    // Document-level arrow-key handler for cell navigation.
    // Only fires when a cell is selected and the user is NOT actively editing
    // (i.e. the formula bar input or another text input is not focused).
    useEffect(() => {
        const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
        const handler = (e: KeyboardEvent) => {
            if (!ARROW_KEYS.has(e.key)) return;
            if (keyboardModeNavRef.current !== 'movement') return;
            if (e.metaKey || e.altKey) return;
            const active = document.activeElement as HTMLElement | null;
            const isFormulaInput = active === formulaInputNavRef.current.current;
            // Skip other inputs, textareas, and contenteditables. When the
            // formula input is focused while still in Movement Mode, arrows
            // continue to navigate the grid.
            if (active && !isFormulaInput && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
            const anchor = selectionAnchorNavRef.current;
            if (!anchor) return;
            const activeCell = selectionActiveNavRef.current ?? anchor;

            e.preventDefault();
            const nextId = navigateCell(activeCell, e.key as ArrowNavigationKey, {
                ctrlKey: e.ctrlKey,
                data: dataNavRef.current,
            });
            if (nextId === activeCell) return; // already at boundary or populated edge

            clearHeaderSelectionNavRef.current();
            if (e.shiftKey) {
                stableOnSelectionExtendNavRef.current(nextId);
            } else {
                stableOnCellActivateNavRef.current(nextId);
            }

            // Scroll the newly selected cell into view if it's off-screen.
            // The cell elements are plain divs with id={cellId} inside the
            // scrollable bodyRef container in SheetGrid.
            requestAnimationFrame(() => {
                const el = document.getElementById(nextId);
                if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []); // empty deps — handler reads only from stable refs

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;

            const active = document.activeElement as HTMLElement | null;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

            const anchor = selectionAnchorNavRef.current;
            if (!anchor) return;

            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                setKeyboardMode('movement');
                const direction = e.key === 'Enter' ? 'ArrowDown' : 'ArrowRight';
                const activeCell = selectionActiveNavRef.current ?? anchor;
                const nextId = navigateCell(activeCell, direction);
                clearHeaderSelectionNavRef.current();
                stableOnCellActivateNavRef.current(nextId);
                requestAnimationFrame(() => {
                    const el = document.getElementById(nextId);
                    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                });
                return;
            }

            if (isViewerRef.current) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                clearHeaderSelectionNavRef.current();
                handleClearCellsNavRef.current();
                return;
            }

            if (e.key.length !== 1) return;

            e.preventDefault();
            clearHeaderSelectionNavRef.current();
            suppressNextFormulaFocusModeRef.current = true;
            beginTypingInFormulaBarNavRef.current(e.key);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    const clipboard = useClipboard({
        dataRef,
        selectionAnchorRef,
        selectionActiveRef,
        formulaInputRef: editing.formulaInputRef,
        pushToUndo: history.pushToUndo,
        dirtyRef,
        setData,
        spreadsheetId: sheetId,
        activeSheetIndexRef: sheets.activeSheetIndexRef,
        getAllSheets,
        conditionalFormatsRef: cf.conditionalFormatsRef,
        updateConditionalFormats: cf.updateConditionalFormats,
    });

    const exports = useExport({
        title: persist.title,
        sheetsDataRef: sheets.sheetsDataRef,
        sheetsColWidthsRef: sheets.sheetsColWidthsRef,
        sheetsRowHeightsRef: sheets.sheetsRowHeightsRef,
        activeSheetIndexRef: sheets.activeSheetIndexRef,
        sheetNamesRef: sheets.sheetNamesRef,
        selectionAnchorRef,
        selectionActiveRef,
        flushActiveSheet: sheets.flushActiveSheet,
        sheetNames: sheets.sheetNames,
        setHamburgerDialog,
    });

    // ── Spell check & nspell ─────────────────────────────────────────────────
    const { spellCheck } = useSpellCheck();
    const nspell = useNspell();

    // ── Context menu state ───────────────────────────────────────────────────
    const [contextMenu, setContextMenu] = useState<{ cellId: string; x: number; y: number } | null>(null);
    const [spellWord, setSpellWord] = useState<string | undefined>(undefined);
    const [spellSuggestions, setSpellSuggestions] = useState<string[] | undefined>(undefined);

    // ── Header context menu & sort/filter state ──────────────────────────────
    const [headerContextMenu, setHeaderContextMenu] = useState<{
        type: 'col' | 'row';
        index: number;
        x: number;
        y: number;
    } | null>(null);
    const [columnFilters, setColumnFilters] = useState<Map<number, Set<string>>>(new Map());
    const [filterDialogCol, setFilterDialogCol] = useState<number | null>(null);

    // nspell only handles single words — extract the first misspelled word from
    // a cell's raw value so multi-word cells work correctly.
    function firstMisspelled(raw: string, spell: NonNullable<typeof nspell>): string | null {
        const words = raw.match(/[a-zA-Z']+/g) ?? [];
        return words.find(w => !spell.check(w)) ?? null;
    }

    // When nspell finishes loading while the context menu is open, find the first
    // misspelled word in the stored raw value and compute suggestions for it.
    useEffect(() => {
        if (!nspell || !spellWord || spellSuggestions !== undefined) return;
        const misspelled = firstMisspelled(spellWord, nspell);
        if (misspelled) {
            setSpellWord(misspelled);
            setSpellSuggestions(nspell.suggest(misspelled).slice(0, 5));
        } else {
            // No misspelled word found — close the spell section silently.
            setSpellWord(undefined);
        }
    }, [nspell, spellWord, spellSuggestions]);

    const handleCellContextMenu = useCallback((cellId: string, x: number, y: number) => {
        if (isViewer) return;
        if (!isCellSelected(cellId)) {
            editing.stableOnCellActivate(cellId);
        }

        setSpellWord(undefined);
        setSpellSuggestions(undefined);

        if (spellCheck) {
            const cell = dataRef.current.get(cellId);
            const raw = cell?.raw ?? '';
            if (raw.length > 0 && !raw.startsWith('=')) {
                if (nspell) {
                    const misspelled = firstMisspelled(raw, nspell);
                    if (misspelled) {
                        setSpellWord(misspelled);
                        setSpellSuggestions(nspell.suggest(misspelled).slice(0, 5));
                    }
                } else {
                    // nspell still loading — store the raw so the useEffect can
                    // extract the misspelled word once the dictionary arrives.
                    setSpellWord(raw);
                }
            }
        }

        setContextMenu({ cellId, x, y });
    }, [isCellSelected, editing.stableOnCellActivate, spellCheck, nspell, dataRef]);

    const handleApplySuggestion = useCallback((word: string) => {
        if (!contextMenu || !spellWord) return;
        const { cellId } = contextMenu;
        const allSheets = getAllSheets();
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);
            const existing = next.get(cellId) ?? { id: cellId, value: '', raw: '', edit: false };
            // Replace only the misspelled word within the cell, preserving surrounding text.
            const newRaw = (existing.raw ?? '').replace(spellWord, word);
            const { value, deps } = computeCell(newRaw, next, allSheets);
            next.set(cellId, { ...existing, raw: newRaw, value, deps, edit: false });
            propagateDeps(cellId, next, new Set([cellId]), allSheets);
            return next;
        });
        dirtyRef.current = true;
    }, [contextMenu, spellWord, setData, history, dirtyRef, getAllSheets]);

    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
        setSpellWord(undefined);
        setSpellSuggestions(undefined);
    }, []);

    // ── Sort helpers ─────────────────────────────────────────────────────────
    function compareValues(a: string, b: string, asc: boolean): number {
        // Blank cells always sort to the end, regardless of sort direction — this
        // matters because activateCell adds a phantom blank entry for the cursor's
        // next row/column, which must never be reordered ahead of real data.
        if (a === '' && b !== '') return 1;
        if (b === '' && a !== '') return -1;
        const an = parseFloat(a);
        const bn = parseFloat(b);
        const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : a.localeCompare(b, undefined, { sensitivity: 'base' });
        return asc ? cmp : -cmp;
    }

    const handleSortByCol = useCallback((colIndex: number, asc: boolean) => {
        setData(prev => {
            history.pushToUndo(new Map(prev));
            let maxRow = 0;
            for (const id of prev.keys()) {
                const m = id.match(/^[A-Z]+(\d+)$/);
                if (m) maxRow = Math.max(maxRow, parseInt(m[1]));
            }
            if (maxRow === 0) return prev;

            const rowCells: Array<Map<string, CellProps>> = Array.from({ length: maxRow }, () => new Map());
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) continue;
                const rowNum = parseInt(m[2]);
                if (rowNum >= 1 && rowNum <= maxRow) rowCells[rowNum - 1].set(m[1], cell);
            }

            const colLetter = numToAlpha(colIndex + 1);
            rowCells.sort((a, b) => {
                const ac = a.get(colLetter);
                const bc = b.get(colLetter);
                return compareValues(String(ac?.value ?? ac?.raw ?? ''), String(bc?.value ?? bc?.raw ?? ''), asc);
            });

            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                if (!id.match(/^[A-Z]+\d+$/)) next.set(id, cell);
            }
            rowCells.forEach((rowData, newIdx) => {
                const newRow = newIdx + 1;
                for (const [col, cell] of rowData) {
                    const newId = `${col}${newRow}`;
                    next.set(newId, { ...cell, id: newId });
                }
            });
            dirtyRef.current = true;
            return next;
        });
    }, [history, setData, dirtyRef]);

    const handleSortByRow = useCallback((rowIndex: number, asc: boolean) => {
        setData(prev => {
            history.pushToUndo(new Map(prev));
            let maxCol = 0;
            for (const id of prev.keys()) {
                const m = id.match(/^([A-Z]+)\d+$/);
                if (m) maxCol = Math.max(maxCol, alphaToNum(m[1]));
            }
            if (maxCol === 0) return prev;

            const colCells: Array<Map<number, CellProps>> = Array.from({ length: maxCol }, () => new Map());
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) continue;
                const colNum = alphaToNum(m[1]);
                const rowNum = parseInt(m[2]);
                if (colNum >= 1 && colNum <= maxCol) colCells[colNum - 1].set(rowNum, cell);
            }

            const targetRow = rowIndex + 1;
            colCells.sort((a, b) => {
                const ac = a.get(targetRow);
                const bc = b.get(targetRow);
                return compareValues(String(ac?.value ?? ac?.raw ?? ''), String(bc?.value ?? bc?.raw ?? ''), asc);
            });

            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                if (!id.match(/^[A-Z]+\d+$/)) next.set(id, cell);
            }
            colCells.forEach((colData, newIdx) => {
                const newColLetter = numToAlpha(newIdx + 1);
                for (const [rowNum, cell] of colData) {
                    const newId = `${newColLetter}${rowNum}`;
                    next.set(newId, { ...cell, id: newId });
                }
            });
            dirtyRef.current = true;
            return next;
        });
    }, [history, setData, dirtyRef]);

    // ── Filter handlers ──────────────────────────────────────────────────────
    const handleApplyFilter = useCallback((colIndex: number, values: Set<string> | null) => {
        setColumnFilters(prev => {
            const next = new Map(prev);
            if (values === null) next.delete(colIndex);
            else next.set(colIndex, values);
            return next;
        });
    }, []);

    // ── Insert / delete rows and columns ─────────────────────────────────────
    // Parse the right-clicked cell id to get its 1-based row and col numbers.
    const parseContextCellId = useCallback((cellId: string) => {
        const m = cellId.match(/^([A-Z]+)(\d+)$/);
        if (!m) return null;
        return { col: alphaToNum(m[1]), row: parseInt(m[2]) };
    }, []);

    // Shared structural insert/delete: shifts the cell map, then recomputes
    // colWidths/rowHeights/conditionalFormats/tableRegions (and, via
    // computeStructuralShift, table-style recoloring for any surviving
    // TableRegion) in one atomic undo step. colWidths/rowHeights/CF/table
    // regions are applied outside undo tracking, matching how they already
    // behave today.
    //
    // Deliberately NOT computed inside a `setData(prev => ...)` updater: React
    // may invoke updater functions more than once for the same state update
    // (StrictMode dev double-invoke is the common case, but the rule holds in
    // general — updaters must be pure). computeStructuralShift's result is fed
    // into tableRegions.updateTableRegions/cf.updateConditionalFormats, which
    // mutate refs as a side effect; a second invocation would then shift an
    // already-shifted region a second time. Reading the current cells from
    // `dataRef` (kept in sync via useLayoutEffect, same pattern used elsewhere
    // in this file, e.g. handleTextChange/contextMenu) and calling setData with
    // a plain value instead sidesteps that entirely — everything here runs
    // exactly once per click.
    // Applies one shift per entry in `indices` (1-based), chaining each result
    // into the next so a multi-header operation lands as a single undo step.
    // Callers pass the indices in whatever order keeps them valid across the
    // chain: descending for delete, so removing one doesn't renumber the rest.
    const runStructuralShifts = useCallback((axis: 'row' | 'col', op: 'insert' | 'delete', indices: number[]) => {
        if (indices.length === 0) return;
        const prev = dataRef.current;
        history.pushToUndo(new Map(prev));
        let result = {
            cells: prev,
            colWidths: colWidthsRef.current,
            rowHeights: rowHeightsRef.current,
            conditionalFormats: cf.conditionalFormatsRef.current,
            tableRegions: tableRegions.tableRegionsRef.current,
        };
        for (const index of indices) {
            result = computeStructuralShift({ ...result, axis, op, index });
        }
        setData(result.cells);
        setColWidths(result.colWidths);
        setRowHeights(result.rowHeights);
        cf.updateConditionalFormats(result.conditionalFormats);
        tableRegions.updateTableRegions(result.tableRegions);
        dirtyRef.current = true;
    }, [dataRef, setData, history, cf, tableRegions, setColWidths, setRowHeights, dirtyRef]);

    const runStructuralShift = useCallback((axis: 'row' | 'col', op: 'insert' | 'delete', index: number) => {
        runStructuralShifts(axis, op, [index]);
    }, [runStructuralShifts]);

    const handleInsertRowAbove = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        runStructuralShift('row', 'insert', pos.row);
    }, [contextMenu, parseContextCellId, runStructuralShift]);

    const handleInsertRowBelow = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        runStructuralShift('row', 'insert', pos.row + 1);
    }, [contextMenu, parseContextCellId, runStructuralShift]);

    const handleInsertColLeft = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        runStructuralShift('col', 'insert', pos.col);
    }, [contextMenu, parseContextCellId, runStructuralShift]);

    const handleInsertColRight = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        runStructuralShift('col', 'insert', pos.col + 1);
    }, [contextMenu, parseContextCellId, runStructuralShift]);

    const handleDeleteRow = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        runStructuralShift('row', 'delete', pos.row);
    }, [contextMenu, parseContextCellId, runStructuralShift]);

    const handleDeleteCol = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        runStructuralShift('col', 'delete', pos.col);
    }, [contextMenu, parseContextCellId, runStructuralShift]);

    const handleClearCells = useCallback(() => {
        const cells = getSelectedCells();
        if (cells.size === 0) return;
        const allSheets = getAllSheets();
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);
            for (const cellId of cells) {
                const existing = next.get(cellId);
                if (existing) {
                    const { value, deps } = computeCell('', next, allSheets);
                    next.set(cellId, { ...existing, raw: '', value, deps, edit: false });
                    propagateDeps(cellId, next, new Set([cellId]), allSheets);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [getSelectedCells, setData, history, dirtyRef, getAllSheets]);

    // Keep the delete-key ref up-to-date with the latest version of handleClearCells.
    handleClearCellsNavRef.current = handleClearCells;

    // ── Format Painter ───────────────────────────────────────────────────────
    const applyFormatPaint = useCallback((destAnchor: string, destActive: string | undefined) => {
        const src = formatPainterSourceRef.current;
        if (!src) return;

        const srcCells = getRangeCells(src.anchor, src.active ?? src.anchor);
        const srcCoords = Array.from(srcCells).map(id => parseCellId(id)!).filter(Boolean);
        const srcMinRow = Math.min(...srcCoords.map(c => c.row));
        const srcMinCol = Math.min(...srcCoords.map(c => c.col));
        const srcRows = Math.max(...srcCoords.map(c => c.row)) - srcMinRow + 1;
        const srcCols = Math.max(...srcCoords.map(c => c.col)) - srcMinCol + 1;

        const isSrcSingle = !src.active || src.anchor === src.active;

        // Determine actual dest range
        let actualDestActive = destActive;
        if (!isSrcSingle && (!destActive || destAnchor === destActive)) {
            // Source is range, dest is single cell — expand dest to source range size
            const dc = parseCellId(destAnchor);
            if (dc) {
                actualDestActive = `${numToAlpha(dc.col + srcCols - 1)}${dc.row + srcRows - 1}`;
            }
        }

        const destCells = getRangeCells(destAnchor, actualDestActive ?? destAnchor);
        const destCoordsArr = Array.from(destCells).map(id => parseCellId(id)!).filter(Boolean);
        const destMinRow = Math.min(...destCoordsArr.map(c => c.row));
        const destMinCol = Math.min(...destCoordsArr.map(c => c.col));

        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);

            for (const destId of destCells) {
                const dc = parseCellId(destId);
                if (!dc) continue;
                let srcStyle: import('./types').CellStyle | undefined;
                if (isSrcSingle) {
                    srcStyle = prev.get(src.anchor)?.cellStyle;
                } else {
                    const relRow = (dc.row - destMinRow) % srcRows;
                    const relCol = (dc.col - destMinCol) % srcCols;
                    const mappedSrcId = `${numToAlpha(srcMinCol + relCol)}${srcMinRow + relRow}`;
                    srcStyle = prev.get(mappedSrcId)?.cellStyle;
                }
                const existing = next.get(destId) ?? { id: destId, edit: false };
                next.set(destId, { ...existing, cellStyle: srcStyle });
            }

            return next;
        });
        dirtyRef.current = true;

        // Copy CF rules from source range to dest range (only when CF feature flag is on)
        if (flags.sheetsConditionalFormatting && cf.conditionalFormatsRef.current.length > 0) {
            const srcMinR = srcMinRow;
            const srcMaxR = srcMinRow + srcRows - 1;
            const srcMinC = srcMinCol;
            const srcMaxC = srcMinCol + srcCols - 1;

            const destAnchorCoords = parseCellId(destAnchor);
            if (destAnchorCoords) {
                const pasteRow = destAnchorCoords.row;
                const pasteCol = destAnchorCoords.col;

                const clippedRules: ClipboardCFRule[] = [];
                for (const cfRule of cf.conditionalFormatsRef.current) {
                    const rm = cfRule.range.trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
                    if (!rm) continue;
                    const rc1 = alphaToNum(rm[1].toUpperCase()), rr1 = parseInt(rm[2]);
                    const rc2 = rm[3] ? alphaToNum(rm[3].toUpperCase()) : rc1;
                    const rr2 = rm[4] ? parseInt(rm[4]) : rr1;
                    const rMinR = Math.min(rr1, rr2), rMaxR = Math.max(rr1, rr2);
                    const rMinC = Math.min(rc1, rc2), rMaxC = Math.max(rc1, rc2);
                    const intMinR = Math.max(rMinR, srcMinR), intMaxR = Math.min(rMaxR, srcMaxR);
                    const intMinC = Math.max(rMinC, srcMinC), intMaxC = Math.min(rMaxC, srcMaxC);
                    if (intMinR > intMaxR || intMinC > intMaxC) continue;
                    clippedRules.push({
                        relRowMin: intMinR - srcMinR,
                        relColMin: intMinC - srcMinC,
                        relRowMax: intMaxR - srcMinR,
                        relColMax: intMaxC - srcMinC,
                        rule: cfRule.rule,
                    });
                }

                if (clippedRules.length > 0) {
                    const newRules: CFRule[] = [...cf.conditionalFormatsRef.current];
                    for (const cr of clippedRules) {
                        const targetMinRow = pasteRow + cr.relRowMin;
                        const targetMaxRow = pasteRow + cr.relRowMax;
                        const targetMinCol = pasteCol + cr.relColMin;
                        const targetMaxCol = pasteCol + cr.relColMax;
                        const range = targetMinRow === targetMaxRow && targetMinCol === targetMaxCol
                            ? `${numToAlpha(targetMinCol)}${targetMinRow}`
                            : `${numToAlpha(targetMinCol)}${targetMinRow}:${numToAlpha(targetMaxCol)}${targetMaxRow}`;
                        newRules.push({
                            id: `cf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                            range,
                            rule: cr.rule,
                        });
                    }
                    cf.updateConditionalFormats(newRules);
                }
            }
        }

        setFormatPainterSource(null);
    }, [flags.sheetsConditionalFormatting, cf, history, dirtyRef, setData]);

    // Keep the applyFormatPaintRef up-to-date so the onMouseUp handler always
    // calls the latest version without a stale closure.
    applyFormatPaintRef.current = applyFormatPaint;

    const handleFormatPainterClick = useCallback(() => {
        if (formatPainterSource) {
            setFormatPainterSource(null);
        } else if (selectionAnchor) {
            setFormatPainterSource({ anchor: selectionAnchor, active: selectionActive });
        }
    }, [formatPainterSource, selectionAnchor, selectionActive]);

    // Records the applied region so structural inserts/deletes can recolor it
    // later (the actual bug fix — table styles are otherwise a one-time paint
    // with no memory of "this range is a table").
    const handleRegisterTableStyle = useCallback((style: TableStyle, cells: Set<string>) => {
        const bounds = getCellBounds(cells);
        tableRegions.registerRegion({
            id: `table-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            styleId: style.id,
            minR: bounds.minRow,
            maxR: bounds.maxRow,
            minC: bounds.minCol,
            maxC: bounds.maxCol,
        });
    }, [tableRegions]);

    // Companion to handleRegisterTableStyle for the "Blank" table style: clears
    // table-region tracking for the current selection without registering a
    // new region in its place.
    const handleClearTableRegionsForSelection = useCallback((cells: Set<string>) => {
        const bounds = getCellBounds(cells);
        tableRegions.removeOverlapping({
            minR: bounds.minRow,
            maxR: bounds.maxRow,
            minC: bounds.minCol,
            maxC: bounds.maxCol,
        });
    }, [tableRegions]);

    // ── Header context menu operations ───────────────────────────────────────
    // Each of these acts on every selected header, which is what the menu's
    // pluralised labels ("Delete 3 columns") promise. The right-clicked header
    // alone is the target when it sits outside the current selection — the
    // same rule `openHeaderContextMenu` applies to the selection itself.
    const headerContextTarget = useCallback((): { axis: HeaderAxis; indices: number[] } | null => {
        if (!headerContextMenu) return null;
        const axis = headerContextMenu.type;
        const selection = headerSelectionRef.current;
        const indices = selection && selection.axis === axis && selection.indices.includes(headerContextMenu.index)
            ? selection.indices
            : [headerContextMenu.index];
        return { axis, indices };
    }, [headerContextMenu]);

    const handleHeaderInsertBefore = useCallback(() => {
        const target = headerContextTarget();
        if (!target) return;
        // Repeating the same 1-based index inserts the whole block in front of
        // the first selected header, matching "Insert N columns left".
        const at = target.indices[0] + 1;
        runStructuralShifts(target.axis, 'insert', target.indices.map(() => at));
    }, [headerContextTarget, runStructuralShifts]);

    const handleHeaderInsertAfter = useCallback(() => {
        const target = headerContextTarget();
        if (!target) return;
        const at = target.indices[target.indices.length - 1] + 2;
        runStructuralShifts(target.axis, 'insert', target.indices.map(() => at));
    }, [headerContextTarget, runStructuralShifts]);

    const handleHeaderDelete = useCallback(() => {
        const target = headerContextTarget();
        if (!target) return;
        // Descending, so removing one header never renumbers those still to go.
        const indices = [...target.indices].sort((a, b) => b - a).map(i => i + 1);
        runStructuralShifts(target.axis, 'delete', indices);
    }, [headerContextTarget, runStructuralShifts]);

    const handleHeaderClear = useCallback(() => {
        const target = headerContextTarget();
        if (!target) return;
        const cleared = new Set(target.indices.map(i => i + 1));
        const allSheets = getAllSheets();
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);
            const toClear: string[] = [];
            for (const id of prev.keys()) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) continue;
                const coord = target.axis === 'col' ? alphaToNum(m[1]) : parseInt(m[2]);
                if (cleared.has(coord)) toClear.push(id);
            }
            for (const id of toClear) {
                const cell = next.get(id)!;
                const { value, deps } = computeCell('', next, allSheets);
                next.set(id, { ...cell, raw: '', value, deps, edit: false });
            }
            for (const id of toClear) {
                propagateDeps(id, next, new Set([id]), allSheets);
            }
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextTarget, setData, history, dirtyRef, getAllSheets]);

    const handleHeaderHide = useCallback(() => {
        const target = headerContextTarget();
        if (!target) return;
        const setSizes = target.axis === 'col' ? setColWidths : setRowHeights;
        setSizes(prev => {
            const next = new Map(prev);
            for (const i of target.indices) next.set(i, 0);
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextTarget, setColWidths, setRowHeights, dirtyRef]);

    // ── Find & Replace handlers ──────────────────────────────────────────────
    const handleFindReplaceOne = useCallback((cellId: string, newRaw: string) => {
        const allSheets = getAllSheets();
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);
            const existing = next.get(cellId) ?? { id: cellId, edit: false };
            const { value, deps } = computeCell(newRaw, next, allSheets);
            next.set(cellId, { ...existing, raw: newRaw, value, deps, edit: false });
            propagateDeps(cellId, next, new Set([cellId]), allSheets);
            return next;
        });
        dirtyRef.current = true;
    }, [getAllSheets, setData, history, dirtyRef]);

    const handleFindReplaceAll = useCallback((replacements: Map<string, string>) => {
        if (replacements.size === 0) return;
        const allSheets = getAllSheets();
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);
            for (const [cellId, newRaw] of replacements) {
                const existing = next.get(cellId) ?? { id: cellId, edit: false };
                const { value, deps } = computeCell(newRaw, next, allSheets);
                next.set(cellId, { ...existing, raw: newRaw, value, deps, edit: false });
            }
            for (const cellId of replacements.keys()) {
                propagateDeps(cellId, next, new Set([cellId]), allSheets);
            }
            return next;
        });
        dirtyRef.current = true;
    }, [getAllSheets, setData, history, dirtyRef]);

    // ── Clipboard wrappers for context menu ──────────────────────────────────
    // The native clipboard handlers in useClipboard fire on document copy/cut/paste
    // events. To trigger them from the context menu we synthesise clipboard events.
    const handleContextMenuCut = useCallback(() => {
        document.execCommand('cut');
    }, []);

    const handleContextMenuCopy = useCallback(() => {
        document.execCommand('copy');
    }, []);

    const handleContextMenuPaste = useCallback(() => {
        document.execCommand('paste');
    }, []);

    // ── Manual save / version creation ──────────────────────────────────────
    const handleManualSave = useCallback(async () => {
        await persist.manualSave();
        queryClient.invalidateQueries({ queryKey: ['versions', sheetId] });
    }, [persist, queryClient, sheetId]);

    const handleBack = useCallback(async () => {
        try { flushSync(() => {}); } catch (_) {}
        try { await persist.save(); } finally { router.push('/drive'); }
    }, [persist, router]);

    /**
     * Save before following a link out of the editor — what `handleBack` does
     * for the editor's own back button, extended to every other way out: the
     * sidebar, the topbar, a breadcrumb.
     *
     * The flush-on-unmount effect is not enough on its own. It runs while the
     * page is being torn down, and a request started that late is at the mercy
     * of the browser: the outgoing document's connections are already busy
     * fetching the next page, and one that has not been handed a socket by the
     * time the renderer goes away is simply dropped — taking the user's last
     * edit with it. Saving first turns that race into an ordinary save, and
     * costs nothing when there is nothing pending.
     */
    useEffect(() => {
        function onClickCapture(event: MouseEvent) {
            if (!dirtyRef.current || event.defaultPrevented) return;
            // Anything but a plain left click is the browser's to handle —
            // modified clicks open tabs and windows rather than navigating here.
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

            const url = new URL(anchor.href, window.location.href);
            if (url.origin !== window.location.origin) return;
            // Same page (or a fragment on it) — nothing is unmounting.
            if (url.pathname === window.location.pathname) return;

            event.preventDefault();
            event.stopPropagation();
            try { flushSync(() => {}); } catch (_) {}
            // `finally`, not `then`: a save that fails must not strand the user
            // in an editor they asked to leave.
            void Promise.resolve(persist.save()).finally(() => {
                router.push(`${url.pathname}${url.search}`);
            });
        }
        document.addEventListener('click', onClickCapture, true);
        return () => document.removeEventListener('click', onClickCapture, true);
    }, [persist, router, dirtyRef]);

    // ── New / Duplicate / Delete ─────────────────────────────────────────────
    const handleNew = useCallback(async (newTitle: string) => {
        const newSheet = await sheetsApi.createSheet({ title: newTitle });
        router.push(`/sheets/editor?id=${newSheet.id}`);
    }, [router]);

    const handleNewFromTemplate = useCallback(async (template: SheetTemplate, newTitle: string) => {
        const newSheet = await sheetsApi.createSheet({ title: newTitle });
        try {
            sessionStorage.setItem(`neutrino:sheet-template:${newSheet.id}`, JSON.stringify(template.build()));
        } catch {
            // sessionStorage unavailable — sheet still opens, just blank
        }
        // Hard navigation (not router.push): the hamburger menu's "New" action is
        // invoked from within an already-mounted SheetEditor instance, and
        // navigating to the same pathname (/sheets/editor) with only a different
        // ?id= query param is a Next.js App Router "soft navigation" — this
        // component instance would NOT remount, so the dekResolved-gated
        // persist.load() effect (which is what applies the pending sessionStorage
        // template) would never re-run for the new sheet id. A full navigation
        // guarantees a fresh mount.
        window.location.href = `/sheets/editor?id=${newSheet.id}`;
    }, []);

    const handleDuplicate = useCallback(async (newTitle: string) => {
        // The copy is a new Drive row with no key of its own. This wrote the
        // copy in the clear unconditionally — every "Make a copy" produced a
        // spreadsheet that could never be encrypted (issue #95). Checked before
        // the sheet is created so a locked vault leaves no empty copy behind.
        if (!(await canEncryptFor(currentUser?.id))) {
            toast.warning(ENCRYPTION_WARNING_MESSAGE);
            return;
        }
        // The copy is stored the way every spreadsheet is stored — as a real
        // workbook. This wrote the bespoke JSON body under an `.xlsx` mime type,
        // which is the copy that opened as its own source code across row 1
        // (issue #169).
        const { writeXlsx } = await import('@/lib/ooxml/xlsx/write');
        const bytes = await writeXlsx(persist.serializeModel());
        const newSheet = await sheetsApi.createSheet({ title: newTitle });
        const dek = await mintFileKey(currentUser?.id, newSheet.id);
        await driveAutosaveEncryptedBytes(newSheet.id, bytes, withOoxmlExtension(newTitle, 'sheets'), dek);
        router.push(`/sheets/editor?id=${newSheet.id}`);
    }, [persist, router, currentUser?.id, toast]);

    const handleDelete = useCallback(async () => {
        await filesystemApi.bulkDelete({ fileIds: [sheetId], folderIds: [] });
        router.push('/drive');
    }, [sheetId, router]);

    // ── Import ───────────────────────────────────────────────────────────────
    const handleImportSheet = useCallback(async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        let parsed: { name: string; data: Map<string, CellProps> }[];
        if (ext === 'csv') {
            const text = await readFileAsText(file);
            parsed = [{ name: file.name.replace(/\.csv$/i, ''), data: parseCsvToMap(text) }];
        } else {
            const buf = await readFileAsArrayBuffer(file);
            parsed = await parseXlsxToSheets(buf);
        }
        sheets.replaceAllSheets(parsed);
        persist.save();
    }, [sheets, persist]);

    const handleImportTab = useCallback(async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'csv') {
            const text = await readFileAsText(file);
            const name = file.name.replace(/\.csv$/i, '');
            sheets.addSheetWithData(name, parseCsvToMap(text));
        } else {
            const buf = await readFileAsArrayBuffer(file);
            const parsed = await parseXlsxToSheets(buf);
            for (const { name, data } of parsed) {
                sheets.addSheetWithData(name, data);
            }
        }
        persist.save();
    }, [sheets, persist]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleManualSave();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [handleManualSave]);


    // ── Effects ──────────────────────────────────────────────────────────────
    // Sync the title div's innerHTML when persist.title changes, but only while
    // the element is not focused — prevents overwriting content the user is
    // actively typing if load() completes mid-edit.
    useEffect(() => {
        const el = titleInputRef.current;
        if (el && document.activeElement !== el) {
            el.innerHTML = persist.title;
        }
    }, [persist.title]);

    // Wait for the E2EE DEK to be resolved before loading content so that
    // dekRef.current is populated before we attempt to decrypt the file.
    useEffect(() => {
        if (!persist.dekResolved) return;
        (async () => {
            await persist.load();
            if (!sheetId) return;
            const key = `neutrino:sheet-template:${sheetId}`;
            let raw: string | null = null;
            try { raw = sessionStorage.getItem(key); } catch { /* ignore */ }
            if (!raw) return;
            try { sessionStorage.removeItem(key); } catch { /* ignore */ }
            try {
                const file = JSON.parse(raw) as SheetFile;
                const parsed = sheetFileToSheetsData(file);
                if (parsed.length > 0) {
                    sheets.replaceAllSheets(parsed);
                    persist.save();
                }
            } catch {
                // malformed payload — leave the sheet as loaded (blank)
            }
        })();
    // persist.load is stable (defined inside usePersistence, not recreated on
    // render), and persist.dekResolved is the only reactive value we need here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persist.dekResolved]);

    // ── Header click handlers ────────────────────────────────────────────────
    const clearHeaderSelection = useCallback(() => {
        headerSelectionRef.current = null;
        setHeaderSelection(null);
    }, []);
    // Keep the arrow-nav ref up-to-date with the stable version of this callback.
    clearHeaderSelectionNavRef.current = clearHeaderSelection;
    const {
        stableOnCellActivate,
        stableOnSelectionExtend,
        handleFormulaBarKeyDown: onFormulaBarKeyDown,
        handleFormulaBarFocus: onFormulaBarFocus,
    } = editing;

    // Commits a header selection: the anchor/active pair follows its bounding
    // range so the name box, presence and arrow-key navigation stay meaningful,
    // while `selectedCells` (above) carries the exact set.
    const commitHeaderSelection = useCallback((next: HeaderSelection) => {
        setKeyboardMode('movement');
        headerSelectionRef.current = next;
        setHeaderSelection(next);
        const { anchor, active } = headerSelectionCellBounds(next);
        selectionAnchorRef.current = anchor;
        selectionActiveRef.current = active;
        setSelectionAnchor(anchor);
        setSelectionActive(active);
        setCurrentCell(undefined);
    }, [setSelectionAnchor, setSelectionActive]);

    // Anything that moves the selection without going through the header
    // handlers — undo/redo, Select all, Find — leaves the headers no longer
    // describing what is selected, so the header selection drops away.
    // `commitHeaderSelection` sets both in one batch, so its own writes match.
    useEffect(() => {
        const selection = headerSelectionRef.current;
        if (!selection) return;
        const bounds = headerSelectionCellBounds(selection);
        if (selectionAnchor !== bounds.anchor || selectionActive !== bounds.active) {
            clearHeaderSelection();
        }
    }, [selectionAnchor, selectionActive, clearHeaderSelection]);

    const handleHeaderSelect = useCallback((axis: HeaderAxis, index: number, mods: HeaderClickModifiers) => {
        commitHeaderSelection(selectHeader(headerSelectionRef.current, axis, index, mods));
    }, [commitHeaderSelection]);

    const handleColHeaderSelect = useCallback(
        (c: number, mods: HeaderClickModifiers) => handleHeaderSelect('col', c, mods),
        [handleHeaderSelect]);

    const handleRowHeaderSelect = useCallback(
        (r: number, mods: HeaderClickModifiers) => handleHeaderSelect('row', r, mods),
        [handleHeaderSelect]);

    // Fired for every mousemove a header drag makes. Re-committing an unchanged
    // selection would rebuild the (large) selected-cell set on each one, so a
    // move that stays within the same header is dropped.
    const handleHeaderExtendTo = useCallback((axis: HeaderAxis, index: number) => {
        const current = headerSelectionRef.current;
        if (!current || current.axis !== axis) return;
        const next = extendHeaderSelection(current, index);
        if (next.indices.length === current.indices.length
            && next.indices.every((v, i) => v === current.indices[i])) return;
        commitHeaderSelection(next);
    }, [commitHeaderSelection]);

    const handleColHeaderExtendTo = useCallback((c: number) => handleHeaderExtendTo('col', c), [handleHeaderExtendTo]);
    const handleRowHeaderExtendTo = useCallback((r: number) => handleHeaderExtendTo('row', r), [handleHeaderExtendTo]);

    // ── Header context menu handlers ─────────────────────────────────────────
    // Right-clicking inside an existing multi-header selection keeps it, so the
    // menu acts on every selected row/column; right-clicking outside selects
    // just the header under the cursor first.
    const openHeaderContextMenu = useCallback((axis: HeaderAxis, index: number, x: number, y: number) => {
        if (isViewer) return;
        const current = headerSelectionRef.current;
        if (!current || current.axis !== axis || !current.indices.includes(index)) {
            handleHeaderSelect(axis, index, {});
        }
        setHeaderContextMenu({ type: axis, index, x, y });
    }, [isViewer, handleHeaderSelect]);

    const handleColHeaderContextMenu = useCallback(
        (colIndex: number, x: number, y: number) => openHeaderContextMenu('col', colIndex, x, y),
        [openHeaderContextMenu]);

    const handleRowHeaderContextMenu = useCallback(
        (rowIndex: number, x: number, y: number) => openHeaderContextMenu('row', rowIndex, x, y),
        [openHeaderContextMenu]);

    const closeHeaderContextMenu = useCallback(() => setHeaderContextMenu(null), []);

    // Wrap cell-activate and selection-extend to clear any header selection.
    const handleCellActivate = useCallback((id: string) => {
        setKeyboardMode('movement');
        clearHeaderSelection();
        selectionAnchorRef.current = id;
        selectionActiveRef.current = id;

        // If format painter is active, apply format to the clicked cell then deactivate.
        if (formatPainterSourceRef.current) {
            didApplyPaintRef.current = true;
            applyFormatPaintRef.current(id, undefined);
        }

        stableOnCellActivate(id);
        setSelectedChartId(null);
    }, [clearHeaderSelection, stableOnCellActivate]);

    const handleSelectionExtend = useCallback((id: string) => {
        setKeyboardMode('movement');
        clearHeaderSelection();
        selectionActiveRef.current = id;
        stableOnSelectionExtend(id);
    }, [clearHeaderSelection, stableOnSelectionExtend]);

    const handleFindNavigateTo = useCallback((cellId: string) => {
        handleCellActivate(cellId);
        requestAnimationFrame(() => {
            const el = document.getElementById(cellId);
            if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    }, [handleCellActivate]);

    const handleFormulaBarKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === 'Tab') {
            setKeyboardMode('movement');
        }
        onFormulaBarKeyDown(event);
    }, [onFormulaBarKeyDown]);

    const handleFormulaBarFocus = useCallback(() => {
        if (suppressNextFormulaFocusModeRef.current) {
            suppressNextFormulaFocusModeRef.current = false;
            onFormulaBarFocus();
            return;
        }
        setKeyboardMode('formula');
        onFormulaBarFocus();
    }, [onFormulaBarFocus]);

    const handleFormulaBarMouseDown = useCallback(() => {
        suppressNextFormulaFocusModeRef.current = false;
        setKeyboardMode('formula');
    }, []);

    // ── Resize handlers ──────────────────────────────────────────────────────
    const handleColResize = (colIndex: number, width: number) => {
        if (isViewer) return;
        setColWidths(prev => { const next = new Map(prev); next.set(colIndex, width); return next; });
        dirtyRef.current = true;
    };

    const handleRowResize = (rowIndex: number, height: number) => {
        if (isViewer) return;
        setRowHeights(prev => { const next = new Map(prev); next.set(rowIndex, height); return next; });
        dirtyRef.current = true;
    };

    // ── Derived display ──────────────────────────────────────────────────────
    const addressDisplay = (headerSelection ? headerSelectionLabel(headerSelection) : null)
        ?? (selectionAnchor
            ? rangeAddress(selectionAnchor, selectionActive ?? selectionAnchor)
            : (currentCell?.id ?? ''));

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div
            className={styles.editorWrapper}
        >
            <div className={styles.topBar}>
                <HamburgerMenu
                    onOpenCsvExport={exports.openCsvExportDialog}
                    onOpenXlsxExport={exports.openXlsxExportDialog}
                    onOpenHtmlExport={exports.openHtmlExportDialog}
                    onOpenPrint={exports.openPrintDialog}
                    onSave={handleManualSave}
                    onToggleHistory={() => setShowHistory(v => !v)}
                    setHamburgerDialog={setHamburgerDialog}
                    setHamburgerDeleteConfirm={setHamburgerDeleteConfirm}
                    isViewer={isViewer}
                    onUndo={history.undo}
                    onRedo={history.redo}
                    canUndo={history.historyLen.undo > 0}
                    canRedo={history.historyLen.redo > 0}
                    onCut={handleContextMenuCut}
                    onCopy={handleContextMenuCopy}
                    onPaste={handleContextMenuPaste}
                    onSelectAll={history.selectAll}
                    onOpenFindReplace={() => setFindReplaceMode('replace')}
                    cellStyle={editing.selectedCellStyle}
                    onStyleChange={applyStyleToSelection}
                    formatDisabled={!selectionAnchor || isViewer}
                    isMerged={editing.isMerged}
                    onMergeCells={editing.mergeCells}
                    onInsertChart={flags.sheetsCharts ? () => setShowChartDialog(true) : undefined}
                />
                <button className={styles.backBtn} aria-label="Sheets" onClick={handleBack}>
                    <ArrowLeft size={16} />
                </button>
                <div className={styles.titleArea}>
                    <div
                        ref={titleInputRef}
                        data-testid="worksheet.name"
                        className={styles.titleInput}
                        contentEditable={!isViewer}
                        suppressContentEditableWarning={true}
                        spellCheck={spellCheck}
                        onKeyDown={isViewer ? undefined : e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                        onBlur={isViewer ? undefined : persist.updateTitle}
                    />
                </div>
                <div style={{ marginLeft: 'auto' }}>
                    <ShareButton users={remoteUsers} onShare={() => setShowShareDialog(true)} />
                </div>
            </div>

            <ExportDialogs
                hamburgerDialog={hamburgerDialog}
                setHamburgerDialog={setHamburgerDialog}
                hamburgerDeleteConfirm={hamburgerDeleteConfirm}
                setHamburgerDeleteConfirm={setHamburgerDeleteConfirm}
                sheetId={sheetId}
                title={persist.title}
                sheetNames={sheets.sheetNames}
                csvExportOptions={exports.csvExportOptions}
                setCsvExportOptions={exports.setCsvExportOptions}
                doExportCsv={exports.doExportCsv}
                xlsxExportOptions={exports.xlsxExportOptions}
                setXlsxExportOptions={exports.setXlsxExportOptions}
                doExportXlsx={exports.doExportXlsx}
                printOptions={exports.printOptions}
                setPrintOptions={exports.setPrintOptions}
                doPrint={exports.doPrint}
                htmlExportOptions={exports.htmlExportOptions}
                setHtmlExportOptions={exports.setHtmlExportOptions}
                doExportHtml={exports.doExportHtml}
                onCreateNew={handleNew}
                onCreateFromTemplate={handleNewFromTemplate}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onImportSheet={handleImportSheet}
                onImportTab={handleImportTab}
            />

            <FormulaBar
                addressDisplay={addressDisplay}
                currentCell={currentCell}
                showFunctions={editing.showFunctions}
                showAllFunctions={editing.showAllFunctions}
                formulaPickMode={editing.formulaPickMode}
                formulaInputRef={editing.formulaInputRef}
                onTextChange={editing.handleTextChange}
                onKeyDown={handleFormulaBarKeyDown}
                onFocus={handleFormulaBarFocus}
                onMouseDown={handleFormulaBarMouseDown}
                onBlur={editing.handleFormulaBarBlur}
                onToggleAllFunctions={editing.toggleAllFunctions}
                onFunctionSelect={editing.handleFunctionSelect}
                spellCheck={false}
                readOnly={isViewer}
            />

            <StyleToolbar
                cellStyle={editing.selectedCellStyle}
                onStyleChange={applyStyleToSelection}
                disabled={!selectionAnchor || isViewer}
                onUndo={history.undo}
                onRedo={history.redo}
                canUndo={history.historyLen.undo > 0}
                canRedo={history.historyLen.redo > 0}
                onMergeCells={editing.mergeCells}
                isMerged={editing.isMerged}
                onInsertChart={flags.sheetsCharts ? () => setShowChartDialog(true) : undefined}
                onFindReplace={() => setFindReplaceMode('replace')}
                onConditionalFormat={flags.sheetsConditionalFormatting ? () => setShowCFDialog(v => !v) : undefined}
                isFormatPainterActive={!!formatPainterSource}
                onFormatPainterClick={handleFormatPainterClick}
                selectedCells={selectedCells}
                onApplyStyleMap={editing.applyStyleMap}
                onRegisterTableRegion={handleRegisterTableStyle}
                onApplyStyle={applyStyleToSelection}
                onClearTableRegions={handleClearTableRegionsForSelection}
            />

            <div className={styles.mainArea}>
                <div
                    className={styles.editorScrollArea}
                    // CSS zoom relayouts, so zooming out shows more cells rather
                    // than painting the same ones smaller, and every pixel the
                    // grid computes stays in its own unzoomed space.
                    style={{
                        zoom: `${zoom}%`,
                        ...(formatPainterSource ? { cursor: 'crosshair' } : {}),
                    }}
                    onMouseUp={() => {
                        if (didApplyPaintRef.current) {
                            // Already applied in handleCellActivate (single-cell click)
                            didApplyPaintRef.current = false;
                            return;
                        }
                        if (formatPainterSourceRef.current && selectionAnchorRef.current) {
                            const anchor = selectionAnchorRef.current;
                            const active = selectionActiveRef.current;
                            if (active && active !== anchor) {
                                applyFormatPaintRef.current(anchor, active);
                            }
                        }
                    }}
                >
                    <SheetZoomProvider scale={zoom / 100}>
                        <SheetGrid
                            data={data}
                            selectedCells={selectedCells}
                            cutCells={clipboard.cutCells}
                            onCellActivate={handleCellActivate}
                            onSelectionExtend={handleSelectionExtend}
                            colWidths={colWidths}
                            rowHeights={rowHeights}
                            onColResize={handleColResize}
                            onRowResize={handleRowResize}
                            onColHeaderSelect={handleColHeaderSelect}
                            onRowHeaderSelect={handleRowHeaderSelect}
                            onColHeaderExtendTo={handleColHeaderExtendTo}
                            onRowHeaderExtendTo={handleRowHeaderExtendTo}
                            headerSelection={gridHeaderSelection}
                            formulaPickMode={editing.formulaPickMode}
                            onFormulaPickMouseDown={editing.handleFormulaPickMouseDown}
                            onFormulaPickMouseMove={editing.handleFormulaPickMouseMove}
                            formulaPickCells={editing.formulaPickMode ? selectedCells : undefined}
                            formulaRefHighlights={editing.formulaRefHighlights}
                            onCellContextMenu={handleCellContextMenu}
                            onColHeaderContextMenu={handleColHeaderContextMenu}
                            onRowHeaderContextMenu={handleRowHeaderContextMenu}
                            columnFilters={columnFilters.size > 0 ? columnFilters : undefined}
                            scrollBodyRef={scrollBodyRef}
                            conditionalFormats={flags.sheetsConditionalFormatting ? cf.conditionalFormats : undefined}
                            cfVariables={flags.sheetsConditionalFormatting ? cfVariables : undefined}
                            remotePresence={remoteUsers.filter(u => u.cellId != null).map(u => ({ clientId: u.clientId, cellId: u.cellId!, color: u.color, name: u.name }))}
                            overlay={flags.sheetsCharts ? (
                                <ChartLayer
                                    charts={charts.charts}
                                    data={data}
                                    selectedChartId={selectedChartId}
                                    onSelectChart={setSelectedChartId}
                                    onUpdateChart={(id, patch) => { charts.updateChart(id, patch); dirtyRef.current = true; }}
                                    onDeleteChart={(id) => { charts.removeChart(id); setSelectedChartId(null); dirtyRef.current = true; }}
                                    containerRef={scrollBodyRef}
                                />
                            ) : null}
                        />
                    </SheetZoomProvider>
                </div>
                {showHistory && (
                    <VersionHistoryPanel
                        fileId={sheetId}
                        onRestore={() => {
                            persist.load();
                            setShowHistory(false);
                        }}
                        onClose={() => setShowHistory(false)}
                    />
                )}
                {flags.sheetsCharts && selectedChartId && (() => {
                    const def = charts.charts.find(c => c.id === selectedChartId);
                    return def ? (
                        <ChartEditorPanel
                            def={def}
                            data={data}
                            onUpdate={(patch) => { charts.updateChart(selectedChartId, patch); dirtyRef.current = true; }}
                            onDelete={() => { charts.removeChart(selectedChartId); setSelectedChartId(null); dirtyRef.current = true; }}
                            onClose={() => setSelectedChartId(null)}
                        />
                    ) : null;
                })()}
            </div>

            <div className={styles.bottomBar}>
                <SheetTabBar
                    sheetNames={sheets.sheetNames}
                    sheetColors={sheets.sheetColors}
                    setSheetColors={sheets.setSheetColors}
                    activeSheetIndex={sheets.activeSheetIndex}
                    dirtyRef={dirtyRef}
                    readOnly={isViewer}
                    onSwitchSheet={(idx) => {
                        if (flags.sheetsCharts) {
                            // Flush before switchSheet updates activeSheetIndexRef, so
                            // the current sheet's charts land in the correct slot.
                            charts.flushActiveCharts();
                        }
                        if (flags.sheetsConditionalFormatting) {
                            cf.flushActiveConditionalFormats();
                        }
                        tableRegions.flushActiveTableRegions();
                        sheets.switchSheet(idx);
                        if (flags.sheetsCharts) {
                            charts.switchSheetCharts(idx);
                            setSelectedChartId(null);
                        }
                        if (flags.sheetsConditionalFormatting) {
                            cf.switchSheetConditionalFormats(idx);
                        }
                        tableRegions.switchSheetTableRegions(idx);
                    }}
                    onAddSheet={() => {
                        if (flags.sheetsCharts) {
                            charts.flushActiveCharts();
                        }
                        if (flags.sheetsConditionalFormatting) {
                            cf.flushActiveConditionalFormats();
                        }
                        tableRegions.flushActiveTableRegions();
                        sheets.addSheet();
                        if (flags.sheetsCharts) {
                            charts.switchSheetCharts(sheets.activeSheetIndexRef.current);
                            setSelectedChartId(null);
                        }
                        if (flags.sheetsConditionalFormatting) {
                            cf.switchSheetConditionalFormats(sheets.activeSheetIndexRef.current);
                        }
                        tableRegions.switchSheetTableRegions(sheets.activeSheetIndexRef.current);
                    }}
                    onDeleteSheet={sheets.deleteSheet}
                    onDuplicateSheet={sheets.duplicateSheet}
                    onMoveSheet={sheets.moveSheet}
                    onCommitRename={sheets.commitRename}
                />
                <div className={styles.zoomArea}>
                    <ZoomSlider value={zoom} onChange={setZoom} min={50} max={200} step={25} />
                </div>
            </div>

            {flags.sheetsCharts && showChartDialog && (
                <ChartCreationDialog
                    initialRange={
                        selectionAnchor && selectionActive
                            ? `${selectionAnchor}:${selectionActive}`
                            : selectionAnchor ?? 'A1:D10'
                    }
                    data={data}
                    onConfirm={(def) => {
                        charts.addChart(def);
                        dirtyRef.current = true;
                        setShowChartDialog(false);
                    }}
                    onClose={() => setShowChartDialog(false)}
                />
            )}

            {contextMenu && (
                <SheetContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    cellId={contextMenu.cellId}
                    selectedCells={selectedCells}
                    cellValue={dataRef.current.get(contextMenu.cellId)?.raw ?? ''}
                    spellWord={spellWord}
                    spellSuggestions={spellSuggestions}
                    onApplySuggestion={handleApplySuggestion}
                    onCut={handleContextMenuCut}
                    onCopy={handleContextMenuCopy}
                    onPaste={handleContextMenuPaste}
                    onInsertRowAbove={handleInsertRowAbove}
                    onInsertRowBelow={handleInsertRowBelow}
                    onInsertColLeft={handleInsertColLeft}
                    onInsertColRight={handleInsertColRight}
                    onDeleteRow={handleDeleteRow}
                    onDeleteCol={handleDeleteCol}
                    onClearCells={handleClearCells}
                    onClose={closeContextMenu}
                />
            )}

            {headerContextMenu && (
                <HeaderContextMenu
                    x={headerContextMenu.x}
                    y={headerContextMenu.y}
                    type={headerContextMenu.type}
                    count={headerSelection?.axis === headerContextMenu.type
                        && headerSelection.indices.includes(headerContextMenu.index)
                        ? headerSelection.indices.length
                        : 1}
                    hasFilter={headerContextMenu.type === 'col' && columnFilters.has(headerContextMenu.index)}
                    onSortAsc={() => {
                        if (headerContextMenu.type === 'col') handleSortByCol(headerContextMenu.index, true);
                        else handleSortByRow(headerContextMenu.index, true);
                    }}
                    onSortDesc={() => {
                        if (headerContextMenu.type === 'col') handleSortByCol(headerContextMenu.index, false);
                        else handleSortByRow(headerContextMenu.index, false);
                    }}
                    onFilter={headerContextMenu.type === 'col' ? () => setFilterDialogCol(headerContextMenu.index) : undefined}
                    onClearFilter={headerContextMenu.type === 'col' ? () => handleApplyFilter(headerContextMenu.index, null) : undefined}
                    onInsertBefore={handleHeaderInsertBefore}
                    onInsertAfter={handleHeaderInsertAfter}
                    onDelete={handleHeaderDelete}
                    onClear={handleHeaderClear}
                    onHide={handleHeaderHide}
                    onClose={closeHeaderContextMenu}
                />
            )}

            {filterDialogCol !== null && (
                <FilterDialog
                    colIndex={filterDialogCol}
                    data={data}
                    currentFilter={columnFilters.get(filterDialogCol)}
                    onApply={handleApplyFilter}
                    onClose={() => setFilterDialogCol(null)}
                />
            )}

            {findReplaceMode !== null && (
                <FindReplaceDialog
                    data={data}
                    initialMode={findReplaceMode}
                    onNavigateTo={handleFindNavigateTo}
                    onReplaceOne={handleFindReplaceOne}
                    onReplaceAll={handleFindReplaceAll}
                    onClose={() => setFindReplaceMode(null)}
                />
            )}

            {showShareDialog && persist.sheetRef.current && (
                <ShareDialog
                    resource={{ ...persist.sheetRef.current, name: persist.sheetRef.current.title } as unknown as FileItem}
                    resourceType="file"
                    onClose={() => setShowShareDialog(false)}
                />
            )}

            {flags.sheetsConditionalFormatting && showCFDialog && (
                <ConditionalFormattingDialog
                    rules={cf.conditionalFormats}
                    selectionRange={
                        selectionAnchor && selectionActive
                            ? `${selectionAnchor}:${selectionActive}`
                            : selectionAnchor ?? undefined
                    }
                    data={data}
                    onUpdate={cf.updateConditionalFormats}
                    onClose={() => {
                        setShowCFDialog(false);
                        try {
                            setCfVariables(JSON.parse(localStorage.getItem('neutrino:sheets:cf-variables') ?? '[]'));
                        } catch { /* ignore */ }
                    }}
                />
            )}
        </div>
    );
}
