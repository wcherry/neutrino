'use client';

import { useEffect, useRef, useState } from 'react';
import type { CellProps, SheetFile } from '../types';
import type { ChartDef } from '../charts/chartTypes';
import { sheetsApi, driveReadContent, driveAutosaveContent, driveCreateVersion, driveAutosaveEncryptedContent, driveCreateEncryptedVersion, storageApi, type SheetResponse } from '@/lib/api';
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
}) {
    const sheetRef = useRef<SheetResponse | null>(null);
    const { dekRef, dekResolved } = useEncryptedDocumentContent({ id: sheetId, filename: 'sheet.json' });
    const [title, setTitle] = useState('Untitled');
    // loadCount increments every time load() completes successfully.
    // The autosave useEffect depends on it so it restarts (with cleanup) on each reload.
    const [loadCount, setLoadCount] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const serialize = (): string => {
        flushActiveSheet();
        flushActiveCharts?.();
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
            return {
                name: sheetNamesRef.current[i] ?? `Sheet ${i + 1}`,
                color,
                cells,
                colWidths: colWidthsObj,
                rowHeights: rowHeightsObj,
                charts: sheetCharts && sheetCharts.length > 0 ? sheetCharts : undefined,
            };
        });
        return JSON.stringify({ sheets: fileSheets } as SheetFile);
    };

    const save = async () => {
        if (!sheetRef.current) return;
        if (dekRef.current) {
            await driveAutosaveEncryptedContent(sheetId, serialize(), 'sheet.json', dekRef.current);
        } else {
            await driveAutosaveContent(sheetId, serialize(), 'sheet.json');
        }
    };

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
        await save();
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
    useEffect(() => {
        if (loadCount === 0) return;
        const flush = () => {
            if (!dirtyRef.current || !sheetRef.current) return;
            dirtyRef.current = false;
            save(); // fire and forget
        };
        const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', flush);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pagehide', flush);
            flush();
        };
    // save/dirtyRef/sheetRef are stable refs; re-register only after each load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadCount]);

    const load = async () => {
        if (!sheetId) return;

        // DEK resolution is handled by useEncryptedDocumentContent; dekRef is
        // already populated by the time the editor calls load().
        const sheet = await sheetsApi.getSheet(sheetId);
        sheetRef.current = sheet;
        setTitle(sheet.title);
        try {
            let raw: string;
            if (dekRef.current) {
                const blob = await storageApi.downloadFile(sheetId);
                const cipherBytes = new Uint8Array(await blob.arrayBuffer());
                const plainBytes = decryptFile(cipherBytes, dekRef.current);
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
                sheetsDataRef.current = allData;
                sheetsColWidthsRef.current = allColWidths;
                sheetsRowHeightsRef.current = allRowHeights;
                setSheetNames(names);
                setSheetColors(colors);
                setData(allData[0]);
                setColWidths(allColWidths[0]);
                setRowHeights(allRowHeights[0]);
                // Restore charts if the hook is wired up
                if (sheetsChartsRef && setCharts) {
                    sheetsChartsRef.current = rawSheets.map(s => s.charts ?? []);
                    setCharts(sheetsChartsRef.current[0] ?? []);
                }
            }
        } catch {
            // empty sheet, start fresh
        }
        // Signal the autosave useEffect to (re-)start the interval with a fresh closure.
        setLoadCount(c => c + 1);

        // Immediately save encrypted content to overwrite the server's plaintext initial
        // content (written by POST /api/v1/sheets on creation).  Without this, the server
        // would hold plaintext bytes until the first user edit triggers the 3-second timer.
        if (dekRef.current) {
            save();
        }
    };

    const updateTitle = async (event: React.FocusEvent<HTMLElement>) => {
        const newTitle = (event.currentTarget as HTMLElement).innerHTML;
        setTitle(newTitle);
        if (sheetRef.current && newTitle !== sheetRef.current.title) {
            await sheetsApi.saveSheet(sheetRef.current.id, { title: newTitle });
            sheetRef.current.title = newTitle;
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
