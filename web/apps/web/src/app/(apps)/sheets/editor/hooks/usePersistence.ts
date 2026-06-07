'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CellProps, SheetFile, CFRule } from '../types';
import type { ChartDef } from '../charts/chartTypes';
import { sheetsApi, driveReadContent, driveCreateVersion, driveCreateEncryptedVersion, storageApi, type SheetResponse } from '@/lib/api';
import { decryptFile } from '@neutrino/e2e-crypto';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { computeCell, type SheetRef } from '../formula';

/**
 * First pass: build a CellProps map from saved cell records, carrying over the
 * pre-computed value so formula lookups have a baseline during evaluation.
 */
function buildRawSheetMap(sheetData: SheetFile['sheets'][0]): Map<string, CellProps> {
    return new Map(
        Object.values(sheetData.cells).map(c => [
            c.id,
            { id: c.id, raw: c.raw, value: c.value, edit: false, cellStyle: c.cellStyle,
                colSpan: c.colSpan, rowSpan: c.rowSpan, mergeAnchor: c.mergeAnchor },
        ])
    );
}

/**
 * Second pass: evaluate all formulas in a sheet with access to all sheets
 * (needed for cross-sheet references like =Beta!C4).
 * Mutates the map in-place so each cell sees freshly computed values from
 * cells evaluated earlier in iteration order, enabling formula chains to work.
 *
 * Also builds the reverse dependency graph: after evaluating every formula
 * the `dependents` array on each referenced cell is populated so that
 * propagateDeps can cascade recalculation when a cell value changes.
 */
function evaluateSheetMap(map: Map<string, CellProps>, allSheets: SheetRef[]): Map<string, CellProps> {
    // Pass 1: evaluate formulas and collect deps for every cell.
    for (const [id, cell] of map) {
        const { value, deps } = computeCell(cell.raw || '', map, allSheets);
        map.set(id, { ...cell, value, deps });
    }
    // Pass 2: build the reverse dependency graph (dependents).
    // For every formula cell, register it as a dependent on each cell it references.
    for (const [id, cell] of map) {
        if (!cell.deps?.length) continue;
        for (const depId of cell.deps) {
            const referenced = map.get(depId) ?? { id: depId, value: '', raw: '', edit: false };
            const existingDependents = referenced.dependents ?? [];
            if (!existingDependents.includes(id)) {
                map.set(depId, { ...referenced, dependents: [...existingDependents, id] });
            }
        }
    }
    return map;
}

export function usePersistence({
    sheetId,
    dirtyRef,
    sheetsDataRef,
    sheetsColWidthsRef,
    sheetsRowHeightsRef,
    activeSheetIndexRef,
    sheetNamesRef,
    sheetColorsRef,
    flushActiveSheet,
    setData,
    setColWidths,
    setRowHeights,
    setSheetNames,
    setSheetColors,
    sheetsChartsRef,
    flushActiveCharts,
    setCharts,
    sheetsConditionalFormatsRef,
    flushActiveConditionalFormats,
    setConditionalFormats,
}: {
    sheetId: string;
    dirtyRef: React.MutableRefObject<boolean>;
    sheetsDataRef: React.MutableRefObject<Map<string, CellProps>[]>;
    sheetsColWidthsRef: React.MutableRefObject<Map<number, number>[]>;
    sheetsRowHeightsRef: React.MutableRefObject<Map<number, number>[]>;
    activeSheetIndexRef: React.MutableRefObject<number>;
    sheetNamesRef: React.MutableRefObject<string[]>;
    sheetColorsRef: React.MutableRefObject<(string | null)[]>;
    flushActiveSheet: () => void;
    setData: React.Dispatch<React.SetStateAction<Map<string, CellProps>>>;
    setColWidths: React.Dispatch<React.SetStateAction<Map<number, number>>>;
    setRowHeights: React.Dispatch<React.SetStateAction<Map<number, number>>>;
    setSheetNames: React.Dispatch<React.SetStateAction<string[]>>;
    setSheetColors: React.Dispatch<React.SetStateAction<(string | null)[]>>;
    // Optional chart persistence — omit if charting is not enabled
    sheetsChartsRef?: React.MutableRefObject<ChartDef[][]>;
    flushActiveCharts?: () => void;
    setCharts?: React.Dispatch<React.SetStateAction<ChartDef[]>>;
    // Optional conditional formatting persistence — omit if feature is disabled
    sheetsConditionalFormatsRef?: React.MutableRefObject<CFRule[][]>;
    flushActiveConditionalFormats?: () => void;
    setConditionalFormats?: React.Dispatch<React.SetStateAction<CFRule[]>>;
}) {
    const sheetRef = useRef<SheetResponse | null>(null);
    const { dekRef, dekResolved } = useEncryptedDocumentContent({ id: sheetId, filename: 'sheet.json' });
    const [title, setTitle] = useState('Untitled');
    // loadCount increments every time load() completes successfully.
    // The autosave useEffect depends on it so it restarts (with cleanup) on each reload.
    const [loadCount, setLoadCount] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Always points to the latest save function so the flush-on-unmount effect
    // (which uses empty deps) can call it without a stale closure.
    const saveRef = useRef<() => Promise<void>>(async () => {});

    const serialize = (): string => {
        flushActiveSheet();
        flushActiveCharts?.();
        flushActiveConditionalFormats?.();
        const fileSheets = sheetsDataRef.current.map((sheetData, i) => {
            const cells: SheetFile['sheets'][0]['cells'] = {};
            for (const [id, cell] of sheetData) {
                cells[id] = { id, raw: cell.raw, value: cell.value, cellStyle: cell.cellStyle,
                    colSpan: cell.colSpan, rowSpan: cell.rowSpan, mergeAnchor: cell.mergeAnchor };
            }
            const cw = sheetsColWidthsRef.current[i];
            const rh = sheetsRowHeightsRef.current[i];
            const colWidthsObj = cw && cw.size > 0
                ? Object.fromEntries([...cw].map(([k, v]) => [String(k), v]))
                : undefined;
            const rowHeightsObj = rh && rh.size > 0
                ? Object.fromEntries([...rh].map(([k, v]) => [String(k), v]))
                : undefined;
            const color = sheetColorsRef.current[i] ?? undefined;
            const sheetCharts = sheetsChartsRef?.current[i];
            const sheetCF = sheetsConditionalFormatsRef?.current[i];
            return {
                name: sheetNamesRef.current[i] ?? `Sheet ${i + 1}`,
                color,
                cells,
                colWidths: colWidthsObj,
                rowHeights: rowHeightsObj,
                charts: sheetCharts && sheetCharts.length > 0 ? sheetCharts : undefined,
                conditionalFormats: sheetCF && sheetCF.length > 0 ? sheetCF : undefined,
            };
        });
        return JSON.stringify({ sheets: fileSheets } as SheetFile);
    };

    const save = async () => {
        if (!sheetRef.current) return;
        const metadata = { title };
        if (dekRef.current) {
            await sheetsApi.autosaveEncryptedContent(sheetId, serialize(), 'sheet.json', dekRef.current, metadata);
        } else {
            await sheetsApi.autosaveContent(sheetId, serialize(), 'sheet.json', metadata);
        }
    };
    saveRef.current = save;

    const manualSave = async () => {
        if (!sheetRef.current) return;
        if (dekRef.current) {
            await driveCreateEncryptedVersion(sheetId, serialize(), 'sheet.json', dekRef.current);
        } else {
            await driveCreateVersion(sheetId, serialize(), 'sheet.json');
        }
    };

    const timedSave = async () => {
        if (!dirtyRef.current) return;
        dirtyRef.current = false;
        // Flush any pending React startTransition updates (e.g. from cell editing)
        // so dataRef.current reflects the latest committed state before serialising.
        // Wrapped in try-catch for the same reason as the unmount flush: flushSync can
        // throw "flushSync was called from inside a lifecycle method" in React 18
        // concurrent mode. The drive save must still fire even if the flush is skipped.
        try { flushSync(() => {}); } catch (_) {}
        await saveRef.current();
    };

    // Single autosave interval, restarted cleanly after every load().
    // loadCount === 0 means load() has never completed, so no interval is started yet.
    useEffect(() => {
        if (loadCount === 0) return;
        intervalRef.current = setInterval(() => { timedSave(); }, 3_000);
        return () => {
            if (intervalRef.current !== null) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    // timedSave captures refs (dirtyRef, sheetRef, dekRef) that never change identity,
    // so it is safe to omit it from the deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadCount]);

    // Flush dirty state when the user leaves: tab hidden, page unload, or SPA navigation.
    // Uses empty deps so the cleanup always runs on unmount regardless of load state.
    // saveRef.current always points to the latest save, avoiding stale closure issues.
    useEffect(() => {
        const flush = () => {
            if (!dirtyRef.current || !sheetRef.current) return;
            dirtyRef.current = false;
            // Flush any pending startTransition updates so dataRef.current reflects
            // the latest committed cell values before serialising (same as timedSave).
            // Wrapped in try-catch: calling flushSync during React 18 passive-effect
            // cleanup may throw "flushSync was called from inside a lifecycle method".
            // The save must still fire even if the flush is skipped.
            try { flushSync(() => {}); } catch (_) {}
            saveRef.current(); // fire and forget
        };
        const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', flush);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pagehide', flush);
            flush();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const load = async () => {
        if (!sheetId) return;

        // Reset dirty so a reload (e.g. version restore) doesn't trigger the
        // colWidths/rowHeights save-on-change effect with stale unsaved state.
        dirtyRef.current = false;

        // DEK resolution is handled by useEncryptedDocumentContent; dekRef is
        // already populated by the time the editor calls load().
        const sheet = await sheetsApi.getSheet(sheetId);
        sheetRef.current = sheet;
        setTitle(sheet.title);
        // True only when decryptFile throws, meaning the server still holds the
        // plaintext default content written at sheet creation time.
        let serverHasPlaintextContent = false;
        try {
            let raw: string;
            if (dekRef.current) {
                const blob = await storageApi.downloadFile(sheetId);
                const cipherBytes = new Uint8Array(await blob.arrayBuffer());
                let plainBytes: Uint8Array;
                try {
                    plainBytes = decryptFile(cipherBytes, dekRef.current);
                } catch {
                    serverHasPlaintextContent = true;
                    throw new Error('plaintext content detected');
                }
                raw = new TextDecoder().decode(plainBytes);
            } else {
                raw = await driveReadContent(sheet.contentUrl);
            }
            const file = JSON.parse(raw) as SheetFile;
            const rawSheets = file.sheets ?? [];
            if (rawSheets.length > 0) {
                const names = rawSheets.map((s, i) => s.name ?? `Sheet ${i + 1}`);
                // Pass 1: build raw maps (no formula evaluation yet)
                const rawMaps = rawSheets.map(buildRawSheetMap);
                // Pass 2: evaluate formulas with full cross-sheet context
                const allSheets: SheetRef[] = names.map((name, i) => ({ name, data: rawMaps[i] }));
                const allData = rawMaps.map(rawMap => evaluateSheetMap(rawMap, allSheets));
                const allColWidths = rawSheets.map(s => {
                    const m = new Map<number, number>();
                    for (const [k, v] of Object.entries(s.colWidths ?? {})) m.set(Number(k), v);
                    return m;
                });
                const allRowHeights = rawSheets.map(s => {
                    const m = new Map<number, number>();
                    for (const [k, v] of Object.entries(s.rowHeights ?? {})) m.set(Number(k), v);
                    return m;
                });
                const colors = rawSheets.map(s => s.color ?? null);
                // Preserve any sheets the user added while the content download
                // was still in progress — load() is async and the user may have
                // pushed new entries to the refs before we get here.
                const extraData = sheetsDataRef.current.slice(allData.length);
                const extraColWidths = sheetsColWidthsRef.current.slice(allData.length);
                const extraRowHeights = sheetsRowHeightsRef.current.slice(allData.length);
                sheetsDataRef.current = [...allData, ...extraData];
                sheetsColWidthsRef.current = [...allColWidths, ...extraColWidths];
                sheetsRowHeightsRef.current = [...allRowHeights, ...extraRowHeights];
                const extraNames = extraData.map((_, i) => `Sheet ${allData.length + i + 1}`);
                const extraColors = extraData.map(() => null as string | null);
                setSheetNames([...names, ...extraNames]);
                setSheetColors([...colors, ...extraColors]);
                setData(allData[0]);
                setColWidths(allColWidths[0]);
                setRowHeights(allRowHeights[0]);
                // Restore charts if the hook is wired up; preserve any charts
                // the user placed on sheets they added during the download.
                if (sheetsChartsRef && setCharts) {
                    const extraCharts = sheetsChartsRef.current.slice(allData.length);
                    sheetsChartsRef.current = [
                        ...rawSheets.map(s => s.charts ?? []),
                        ...extraCharts,
                    ];
                    setCharts(sheetsChartsRef.current[0] ?? []);
                }
                // Restore conditional formats if the hook is wired up.
                if (sheetsConditionalFormatsRef && setConditionalFormats) {
                    const extraCF = sheetsConditionalFormatsRef.current.slice(allData.length);
                    sheetsConditionalFormatsRef.current = [
                        ...rawSheets.map(s => s.conditionalFormats ?? []),
                        ...extraCF,
                    ];
                    setConditionalFormats(sheetsConditionalFormatsRef.current[0] ?? []);
                }
            }
        } catch {
            // empty sheet, start fresh
        }
        // Signal the autosave useEffect to (re-)start the interval with a fresh closure.
        setLoadCount(c => c + 1);

        // Overwrite the server's plaintext initial content with encrypted bytes.
        // Only needed for brand-new encrypted sheets whose content was written as
        // plaintext by POST /api/v1/sheets on creation; for existing encrypted sheets
        // decryptFile succeeds and serverHasPlaintextContent stays false.
        if (serverHasPlaintextContent) {
            save();
        }
    };

    const updateTitle = async (event: React.FocusEvent<HTMLElement>) => {
        const newTitle = (event.currentTarget as HTMLElement).innerHTML;
        setTitle(newTitle);
        if (sheetRef.current && newTitle !== sheetRef.current.title) {
            sheetRef.current.title = newTitle;
            // Save title together with current content in one combined call.
            const metadata = { title: newTitle };
            if (dekRef.current) {
                await sheetsApi.autosaveEncryptedContent(sheetId, serialize(), 'sheet.json', dekRef.current, metadata);
            } else {
                await sheetsApi.autosaveContent(sheetId, serialize(), 'sheet.json', metadata);
            }
        }
    };

    return {
        sheetRef,
        title,
        setTitle,
        load,
        save,
        manualSave,
        serialize,
        updateTitle,
        activeSheetIndexRef,
        /** True once the E2EE DEK resolution attempt has completed. */
        dekResolved,
    };
}
