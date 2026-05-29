'use client';

import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';
import { VersionHistoryPanel } from '@/components/VersionHistoryPanel';
import { sheetsApi, filesystemApi, driveAutosaveContent } from '@/lib/api';
import type { CellProps } from './types';
import { rangeAddress, numToAlpha, alphaToNum, navigateCell, type ArrowNavigationKey } from './utils';
import { MAX_ROWS, MAX_COLS } from './constants';
import { useHistory } from './hooks/useHistory';
import { useClipboard } from './hooks/useClipboard';
import { useSheets } from './hooks/useSheets';
import { usePersistence } from './hooks/usePersistence';
import { useExport } from './hooks/useExport';
import { useCellEditing } from './hooks/useCellEditing';
import { useSpellCheck } from '@/hooks/useSpellCheck';
import { useNspell } from '@/hooks/useNspell';
import { computeCell, propagateDeps, type SheetRef } from './formula';

import { StyleToolbar } from './StyleToolbar';
import { SheetGrid } from './SheetGrid';
import { SheetContextMenu } from './SheetContextMenu';
import { FormulaBar } from './components/FormulaBar';
import { HamburgerMenu } from './components/HamburgerMenu';
import { ExportDialogs } from './components/ExportDialogs';
import { SheetTabBar } from './components/SheetTabBar';
import styles from './page.module.css';

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
    const sheetId = searchParams.get('id') ?? '';
    // ── Core state & refs ────────────────────────────────────────────────────
    const [currentCell, setCurrentCell] = useState<CellProps | undefined>();
    const [selectionAnchor, setSelectionAnchor] = useState<string | undefined>(undefined);
    const [selectionActive, setSelectionActive] = useState<string | undefined>(undefined);
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

    const [headerSelectionLabel, setHeaderSelectionLabel] = useState<string | null>(null);
    const [highlightedCol, setHighlightedCol] = useState<number | null>(null);
    const [highlightedRow, setHighlightedRow] = useState<number | null>(null);

    const [hamburgerDialog, setHamburgerDialog] = useState<string | null>(null);
    const [hamburgerDeleteConfirm, setHamburgerDeleteConfirm] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const queryClient = useQueryClient();
    const suppressNextFormulaFocusModeRef = useRef(false);

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
    });

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
    // Wait for the E2EE DEK to be resolved before loading content so that
    // dekRef.current is populated before we attempt to decrypt the file.
    useEffect(() => {
        if (persist.dekResolved) { persist.load(); }
    // persist.load is stable (defined inside usePersistence, not recreated on
    // render), and persist.dekResolved is the only reactive value we need here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persist.dekResolved]);

    // Save immediately when column/row sizes change so resizes persist without
    // waiting for the 3-second timer. dirtyRef guards against spurious saves on load.
    useEffect(() => {
        if (!dirtyRef.current || !persist.sheetRef.current) return;
        persist.save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [colWidths, rowHeights]);

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
        setSelectionAnchor(`${colLetter}1`);
        setSelectionActive(`${colLetter}${MAX_ROWS}`);
        setCurrentCell(undefined);
        setHeaderSelectionLabel(colLetter);
        setHighlightedCol(c);
        setHighlightedRow(null);
    }, [setSelectionAnchor, setSelectionActive]);

    const handleRowHeaderClick = useCallback((r: number) => {
        setKeyboardMode('movement');
        setSelectionAnchor(`A${r + 1}`);
        setSelectionActive(`${numToAlpha(MAX_COLS)}${r + 1}`);
        setCurrentCell(undefined);
        setHeaderSelectionLabel(`${r + 1}`);
        setHighlightedRow(r);
        setHighlightedCol(null);
    }, [setSelectionAnchor, setSelectionActive]);

    // Wrap cell-activate and selection-extend to clear any header selection.
    const handleCellActivate = useCallback((id: string) => {
        setKeyboardMode('movement');
        clearHeaderSelection();
        stableOnCellActivate(id);
    }, [clearHeaderSelection, stableOnCellActivate]);

    const handleSelectionExtend = useCallback((id: string) => {
        setKeyboardMode('movement');
        clearHeaderSelection();
        stableOnSelectionExtend(id);
    }, [clearHeaderSelection, stableOnSelectionExtend]);

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
        setColWidths(prev => { const next = new Map(prev); next.set(colIndex, width); return next; });
        dirtyRef.current = true;
    };

    const handleRowResize = (rowIndex: number, height: number) => {
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
                />
                <button className={styles.backBtn} aria-label="Sheets" onClick={async () => { await persist.save(); router.push('/drive'); }}>
                    <ArrowLeft size={16} />
                </button>
                <div className={styles.titleArea}>
                    <div
                        data-testid="worksheet.name"
                        className={styles.titleInput}
                        contentEditable={true}
                        suppressContentEditableWarning={true}
                        spellCheck={spellCheck}
                        dangerouslySetInnerHTML={{ __html: persist.title }}
                        onBlur={persist.updateTitle}
                    />
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
            />

            <StyleToolbar
                cellStyle={editing.selectedCellStyle}
                onStyleChange={editing.applyStyle}
                disabled={!selectionAnchor}
                onUndo={history.undo}
                onRedo={history.redo}
                canUndo={history.historyLen.undo > 0}
                canRedo={history.historyLen.redo > 0}
                onMergeCells={editing.mergeCells}
                isMerged={editing.isMerged}
            />

            <div className={styles.mainArea}>
                <div className={styles.editorScrollArea}>
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
                        onCellContextMenu={handleCellContextMenu}
                        scrollBodyRef={scrollBodyRef}
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
            </div>

            <SheetTabBar
                sheetNames={sheets.sheetNames}
                sheetColors={sheets.sheetColors}
                setSheetColors={sheets.setSheetColors}
                activeSheetIndex={sheets.activeSheetIndex}
                dirtyRef={dirtyRef}
                onSwitchSheet={sheets.switchSheet}
                onAddSheet={sheets.addSheet}
                onDeleteSheet={sheets.deleteSheet}
                onDuplicateSheet={sheets.duplicateSheet}
                onMoveSheet={sheets.moveSheet}
                onCommitRename={sheets.commitRename}
            />

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
        </div>
    );
}
