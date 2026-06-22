'use client';

import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';
import { VersionHistoryPanel } from '@/components/VersionHistoryPanel';
import { sheetsApi, filesystemApi, driveAutosaveContent } from '@/lib/api';
import { useUser } from '@neutrino/auth';
import { useSheetPresence, type CellSyncItem } from '@/hooks/useSheetPresence';
import type { CellProps, ClipboardCFRule, CFRule } from './types';
import { rangeAddress, numToAlpha, alphaToNum, navigateCell, parseCellId, getRangeCells, type ArrowNavigationKey } from './utils';
import { MAX_ROWS, MAX_COLS } from './constants';
import { useHistory } from './hooks/useHistory';
import { useClipboard } from './hooks/useClipboard';
import { useSheets } from './hooks/useSheets';
import { usePersistence } from './hooks/usePersistence';
import { useExport } from './hooks/useExport';
import { useCellEditing } from './hooks/useCellEditing';
import { useConditionalFormatting } from './hooks/useConditionalFormatting';
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
import { ShareButton } from '@neutrino/ui';
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

function parseXlsxToSheets(buffer: ArrayBuffer): { name: string; data: Map<string, CellProps> }[] {
    const wb = XLSX.read(new Uint8Array(buffer));
    return wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        const map = new Map<string, CellProps>();
        const ref = ws['!ref'];
        if (ref) {
            const range = XLSX.utils.decode_range(ref);
            for (let r = range.s.r; r <= range.e.r; r++) {
                for (let c = range.s.c; c <= range.e.c; c++) {
                    const cell = ws[XLSX.utils.encode_cell({ r, c })];
                    if (!cell || cell.v == null) continue;
                    const id = `${numToAlpha(c + 1)}${r + 1}`;
                    const val = cell.w ?? String(cell.v);
                    if (val !== '') map.set(id, { id, raw: val, edit: false });
                }
            }
        }
        return { name, data: map };
    });
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
    const [colWidths, setColWidths] = useState<Map<number, number>>(new Map());
    const colWidthsRef = useRef<Map<number, number>>(new Map());
    const [rowHeights, setRowHeights] = useState<Map<number, number>>(new Map());
    const rowHeightsRef = useRef<Map<number, number>>(new Map());

    // Stable refs so clipboard/keyboard handlers always see current selection.
    const selectionAnchorRef = useRef<string | undefined>(undefined);
    const selectionActiveRef = useRef<string | undefined>(undefined);

    // Marks unsaved changes; read by the timed-save interval and size-change effect.
    const dirtyRef = useRef(false);

    // Ref to the scrollable body container inside SheetGrid, used to scroll
    // newly selected cells into view after arrow-key navigation.
    const scrollBodyRef = useRef<HTMLDivElement | null>(null);

    // Ref for the title contentEditable; kept separate from dangerouslySetInnerHTML
    // so React never overwrites user-typed content during re-renders.
    const titleInputRef = useRef<HTMLDivElement | null>(null);

    const [headerSelectionLabel, setHeaderSelectionLabel] = useState<string | null>(null);
    const [highlightedCol, setHighlightedCol] = useState<number | null>(null);
    const [highlightedRow, setHighlightedRow] = useState<number | null>(null);

    const [hamburgerDialog, setHamburgerDialog] = useState<string | null>(null);
    const [hamburgerDeleteConfirm, setHamburgerDeleteConfirm] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [findReplaceMode, setFindReplaceMode] = useState<'find' | 'replace' | null>(null);
    const [showShareDialog, setShowShareDialog] = useState(false);

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

    // Sync state → refs so event handlers always see current values.
    // useLayoutEffect for dataRef ensures it's updated synchronously after every
    // commit (before paint), so activateCell's startTransition always reads a
    // current map — preventing stale data from overwriting in-flight state like
    // colSpan/rowSpan set by a preceding mergeCells call.
    useLayoutEffect(() => { dataRef.current = data; }, [data]);
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

    const persist = usePersistence({
        sheetId, dirtyRef,
        sheetsDataRef: sheets.sheetsDataRef,
        sheetsColWidthsRef: sheets.sheetsColWidthsRef,
        sheetsRowHeightsRef: sheets.sheetsRowHeightsRef,
        activeSheetIndexRef: sheets.activeSheetIndexRef,
        sheetNamesRef: sheets.sheetNamesRef,
        sheetColorsRef: sheets.sheetColorsRef,
        flushActiveSheet: sheets.flushActiveSheet,
        setData, setColWidths, setRowHeights,
        setSheetNames: sheets.setSheetNames,
        setSheetColors: sheets.setSheetColors,
        sheetsChartsRef: flags.sheetsCharts ? charts.sheetsChartsRef : undefined,
        flushActiveCharts: flags.sheetsCharts ? charts.flushActiveCharts : undefined,
        setCharts: flags.sheetsCharts ? charts.setCharts : undefined,
        sheetsConditionalFormatsRef: flags.sheetsConditionalFormatting ? cf.sheetsConditionalFormatsRef : undefined,
        flushActiveConditionalFormats: flags.sheetsConditionalFormatting ? cf.flushActiveConditionalFormats : undefined,
        setConditionalFormats: flags.sheetsConditionalFormatting ? cf.setConditionalFormats : undefined,
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
    });

    // Stable refs for document-level keyboard handler; updated every render so
    // the effect with empty deps always reads the latest values without re-registering.
    const applyStyleRef = useRef(editing.applyStyle);
    applyStyleRef.current = editing.applyStyle;
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
        if (!editing.selectedCells.has(cellId)) {
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
    }, [editing.selectedCells, editing.stableOnCellActivate, spellCheck, nspell, dataRef]);

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
        if (a === '' && b !== '') return asc ? 1 : -1;
        if (b === '' && a !== '') return asc ? -1 : 1;
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

    const handleInsertRowAbove = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        const rowN = pos.row;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const r = parseInt(m[2]);
                if (r >= rowN) {
                    const newId = `${m[1]}${r + 1}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [contextMenu, parseContextCellId, setData, history, dirtyRef]);

    const handleInsertRowBelow = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        const rowN = pos.row;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const r = parseInt(m[2]);
                if (r >= rowN + 1) {
                    const newId = `${m[1]}${r + 1}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [contextMenu, parseContextCellId, setData, history, dirtyRef]);

    const handleInsertColLeft = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        const colN = pos.col;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const c = alphaToNum(m[1]);
                if (c >= colN) {
                    const newId = `${numToAlpha(c + 1)}${m[2]}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [contextMenu, parseContextCellId, setData, history, dirtyRef]);

    const handleInsertColRight = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        const colN = pos.col;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const c = alphaToNum(m[1]);
                if (c >= colN + 1) {
                    const newId = `${numToAlpha(c + 1)}${m[2]}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [contextMenu, parseContextCellId, setData, history, dirtyRef]);

    const handleDeleteRow = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        const rowN = pos.row;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const r = parseInt(m[2]);
                if (r === rowN) continue; // remove this row
                if (r > rowN) {
                    const newId = `${m[1]}${r - 1}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [contextMenu, parseContextCellId, setData, history, dirtyRef]);

    const handleDeleteCol = useCallback(() => {
        if (!contextMenu) return;
        const pos = parseContextCellId(contextMenu.cellId);
        if (!pos) return;
        const colN = pos.col;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const c = alphaToNum(m[1]);
                if (c === colN) continue; // remove this column
                if (c > colN) {
                    const newId = `${numToAlpha(c - 1)}${m[2]}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [contextMenu, parseContextCellId, setData, history, dirtyRef]);

    const handleClearCells = useCallback(() => {
        const cells = editing.selectedCells;
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
    }, [editing.selectedCells, setData, history, dirtyRef, getAllSheets]);

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

    // ── Header context menu: row operations ──────────────────────────────────
    const handleHeaderInsertRowAbove = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'row') return;
        const rowN = headerContextMenu.index + 1;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const r = parseInt(m[2]);
                if (r >= rowN) {
                    const newId = `${m[1]}${r + 1}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextMenu, setData, history, dirtyRef]);

    const handleHeaderInsertRowBelow = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'row') return;
        const rowN = headerContextMenu.index + 1;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const r = parseInt(m[2]);
                if (r > rowN) {
                    const newId = `${m[1]}${r + 1}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextMenu, setData, history, dirtyRef]);

    const handleHeaderDeleteRow = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'row') return;
        const rowN = headerContextMenu.index + 1;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const r = parseInt(m[2]);
                if (r === rowN) continue;
                if (r > rowN) {
                    const newId = `${m[1]}${r - 1}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextMenu, setData, history, dirtyRef]);

    const handleHeaderClearRow = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'row') return;
        const rowN = headerContextMenu.index + 1;
        const allSheets = getAllSheets();
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);
            const toClear: string[] = [];
            for (const id of prev.keys()) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (m && parseInt(m[2]) === rowN) toClear.push(id);
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
    }, [headerContextMenu, setData, history, dirtyRef, getAllSheets]);

    const handleHeaderHideRow = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'row') return;
        const idx = headerContextMenu.index;
        setRowHeights(prev => { const next = new Map(prev); next.set(idx, 0); return next; });
        dirtyRef.current = true;
    }, [headerContextMenu, setRowHeights, dirtyRef]);

    // ── Header context menu: column operations ───────────────────────────────
    const handleHeaderInsertColLeft = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'col') return;
        const colN = headerContextMenu.index + 1;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const c = alphaToNum(m[1]);
                if (c >= colN) {
                    const newId = `${numToAlpha(c + 1)}${m[2]}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextMenu, setData, history, dirtyRef]);

    const handleHeaderInsertColRight = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'col') return;
        const colN = headerContextMenu.index + 1;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const c = alphaToNum(m[1]);
                if (c > colN) {
                    const newId = `${numToAlpha(c + 1)}${m[2]}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextMenu, setData, history, dirtyRef]);

    const handleHeaderDeleteCol = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'col') return;
        const colN = headerContextMenu.index + 1;
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map<string, CellProps>();
            for (const [id, cell] of prev) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) { next.set(id, cell); continue; }
                const c = alphaToNum(m[1]);
                if (c === colN) continue;
                if (c > colN) {
                    const newId = `${numToAlpha(c - 1)}${m[2]}`;
                    next.set(newId, { ...cell, id: newId });
                } else {
                    next.set(id, cell);
                }
            }
            return next;
        });
        dirtyRef.current = true;
    }, [headerContextMenu, setData, history, dirtyRef]);

    const handleHeaderClearCol = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'col') return;
        const colN = headerContextMenu.index + 1;
        const allSheets = getAllSheets();
        setData(prev => {
            history.pushToUndo(new Map(prev));
            const next = new Map(prev);
            const toClear: string[] = [];
            for (const id of prev.keys()) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (m && alphaToNum(m[1]) === colN) toClear.push(id);
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
    }, [headerContextMenu, setData, history, dirtyRef, getAllSheets]);

    const handleHeaderHideCol = useCallback(() => {
        if (!headerContextMenu || headerContextMenu.type !== 'col') return;
        const idx = headerContextMenu.index;
        setColWidths(prev => { const next = new Map(prev); next.set(idx, 0); return next; });
        dirtyRef.current = true;
    }, [headerContextMenu, setColWidths, dirtyRef]);

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

    // ── New / Duplicate / Delete ─────────────────────────────────────────────
    const handleNew = useCallback(async (newTitle: string) => {
        const newSheet = await sheetsApi.createSheet({ title: newTitle });
        router.push(`/sheets/editor?id=${newSheet.id}`);
    }, [router]);

    const handleDuplicate = useCallback(async (newTitle: string) => {
        const serialized = persist.serialize();
        const newSheet = await sheetsApi.createSheet({ title: newTitle });
        await driveAutosaveContent(newSheet.id, serialized, 'sheet.json');
        router.push(`/sheets/editor?id=${newSheet.id}`);
    }, [persist, router]);

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
            parsed = parseXlsxToSheets(buf);
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
            const parsed = parseXlsxToSheets(buf);
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
        if (persist.dekResolved) { persist.load(); }
    // persist.load is stable (defined inside usePersistence, not recreated on
    // render), and persist.dekResolved is the only reactive value we need here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persist.dekResolved]);

    // ── Header click handlers ────────────────────────────────────────────────
    const clearHeaderSelection = useCallback(() => {
        setHeaderSelectionLabel(null);
        setHighlightedCol(null);
        setHighlightedRow(null);
    }, []);
    // Keep the arrow-nav ref up-to-date with the stable version of this callback.
    clearHeaderSelectionNavRef.current = clearHeaderSelection;
    const {
        stableOnCellActivate,
        stableOnSelectionExtend,
        handleFormulaBarKeyDown: onFormulaBarKeyDown,
        handleFormulaBarFocus: onFormulaBarFocus,
    } = editing;

    const handleColHeaderClick = useCallback((c: number) => {
        setKeyboardMode('movement');
        const colLetter = numToAlpha(c + 1);
        const anchor = `${colLetter}1`;
        const active = `${colLetter}${MAX_ROWS}`;
        selectionAnchorRef.current = anchor;
        selectionActiveRef.current = active;
        setSelectionAnchor(anchor);
        setSelectionActive(active);
        setCurrentCell(undefined);
        setHeaderSelectionLabel(colLetter);
        setHighlightedCol(c);
        setHighlightedRow(null);
    }, [setSelectionAnchor, setSelectionActive]);

    const handleRowHeaderClick = useCallback((r: number) => {
        setKeyboardMode('movement');
        const anchor = `A${r + 1}`;
        const active = `${numToAlpha(MAX_COLS)}${r + 1}`;
        selectionAnchorRef.current = anchor;
        selectionActiveRef.current = active;
        setSelectionAnchor(anchor);
        setSelectionActive(active);
        setCurrentCell(undefined);
        setHeaderSelectionLabel(`${r + 1}`);
        setHighlightedRow(r);
        setHighlightedCol(null);
    }, [setSelectionAnchor, setSelectionActive]);

    // ── Header context menu handlers ─────────────────────────────────────────
    const handleColHeaderContextMenu = useCallback((colIndex: number, x: number, y: number) => {
        if (isViewer) return;
        handleColHeaderClick(colIndex);
        setHeaderContextMenu({ type: 'col', index: colIndex, x, y });
    }, [isViewer, handleColHeaderClick]);

    const handleRowHeaderContextMenu = useCallback((rowIndex: number, x: number, y: number) => {
        if (isViewer) return;
        handleRowHeaderClick(rowIndex);
        setHeaderContextMenu({ type: 'row', index: rowIndex, x, y });
    }, [isViewer, handleRowHeaderClick]);

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
    const addressDisplay = headerSelectionLabel
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
                onStyleChange={editing.applyStyle}
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
            />

            <div className={styles.mainArea}>
                <div
                    className={styles.editorScrollArea}
                    style={formatPainterSource ? { cursor: 'crosshair' } : undefined}
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
                    <SheetGrid
                        data={data}
                        selectedCells={editing.selectedCells}
                        cutCells={clipboard.cutCells}
                        onCellActivate={handleCellActivate}
                        onSelectionExtend={handleSelectionExtend}
                        colWidths={colWidths}
                        rowHeights={rowHeights}
                        onColResize={handleColResize}
                        onRowResize={handleRowResize}
                        onColHeaderClick={handleColHeaderClick}
                        onRowHeaderClick={handleRowHeaderClick}
                        highlightedCol={highlightedCol}
                        highlightedRow={highlightedRow}
                        formulaPickMode={editing.formulaPickMode}
                        onFormulaPickMouseDown={editing.handleFormulaPickMouseDown}
                        onFormulaPickMouseMove={editing.handleFormulaPickMouseMove}
                        formulaPickCells={editing.formulaPickMode ? editing.selectedCells : undefined}
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
                    sheets.switchSheet(idx);
                    if (flags.sheetsCharts) {
                        charts.switchSheetCharts(idx);
                        setSelectedChartId(null);
                    }
                    if (flags.sheetsConditionalFormatting) {
                        cf.switchSheetConditionalFormats(idx);
                    }
                }}
                onAddSheet={() => {
                    if (flags.sheetsCharts) {
                        charts.flushActiveCharts();
                    }
                    if (flags.sheetsConditionalFormatting) {
                        cf.flushActiveConditionalFormats();
                    }
                    sheets.addSheet();
                    if (flags.sheetsCharts) {
                        charts.switchSheetCharts(sheets.activeSheetIndexRef.current);
                        setSelectedChartId(null);
                    }
                    if (flags.sheetsConditionalFormatting) {
                        cf.switchSheetConditionalFormats(sheets.activeSheetIndexRef.current);
                    }
                }}
                onDeleteSheet={sheets.deleteSheet}
                onDuplicateSheet={sheets.duplicateSheet}
                onMoveSheet={sheets.moveSheet}
                onCommitRename={sheets.commitRename}
            />

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
                    selectedCells={editing.selectedCells}
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
                    onInsertBefore={headerContextMenu.type === 'col' ? handleHeaderInsertColLeft : handleHeaderInsertRowAbove}
                    onInsertAfter={headerContextMenu.type === 'col' ? handleHeaderInsertColRight : handleHeaderInsertRowBelow}
                    onDelete={headerContextMenu.type === 'col' ? handleHeaderDeleteCol : handleHeaderDeleteRow}
                    onClear={headerContextMenu.type === 'col' ? handleHeaderClearCol : handleHeaderClearRow}
                    onHide={headerContextMenu.type === 'col' ? handleHeaderHideCol : handleHeaderHideRow}
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
