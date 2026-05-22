'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { CellProps } from '../types';

export function useSheets({
    dataRef,
    colWidthsRef,
    rowHeightsRef,
    setData,
    setColWidths,
    setRowHeights,
    dirtyRef,
    resetHistoryAndSelection,
}: {
    dataRef: React.MutableRefObject<Map<string, CellProps>>;
    colWidthsRef: React.MutableRefObject<Map<number, number>>;
    rowHeightsRef: React.MutableRefObject<Map<number, number>>;
    setData: React.Dispatch<React.SetStateAction<Map<string, CellProps>>>;
    setColWidths: React.Dispatch<React.SetStateAction<Map<number, number>>>;
    setRowHeights: React.Dispatch<React.SetStateAction<Map<number, number>>>;
    dirtyRef: React.MutableRefObject<boolean>;
    resetHistoryAndSelection: () => void;
}) {
    const sheetsDataRef = useRef<Map<string, CellProps>[]>([new Map()]);
    const sheetsColWidthsRef = useRef<Map<number, number>[]>([new Map()]);
    const sheetsRowHeightsRef = useRef<Map<number, number>[]>([new Map()]);

    const [sheetNames, setSheetNames] = useState<string[]>(['Sheet 1']);
    const sheetNamesRef = useRef<string[]>(['Sheet 1']);
    const [sheetColors, setSheetColors] = useState<(string | null)[]>([null]);
    const sheetColorsRef = useRef<(string | null)[]>([null]);
    const [activeSheetIndex, setActiveSheetIndex] = useState(0);
    const activeSheetIndexRef = useRef(0);

    useEffect(() => { sheetNamesRef.current = sheetNames; }, [sheetNames]);
    useEffect(() => { sheetColorsRef.current = sheetColors; }, [sheetColors]);

    // Syncs the currently active sheet's live data back into the per-sheet arrays.
    // Must be called before reading from sheetsDataRef in any operation that
    // switches the active sheet or serialises all sheets (save, export, print).
    const flushActiveSheet = useCallback(() => {
        sheetsDataRef.current[activeSheetIndexRef.current] = dataRef.current;
        sheetsColWidthsRef.current[activeSheetIndexRef.current] = colWidthsRef.current;
        sheetsRowHeightsRef.current[activeSheetIndexRef.current] = rowHeightsRef.current;
    }, [dataRef, colWidthsRef, rowHeightsRef]);

    const switchSheet = useCallback((newIndex: number) => {
        flushActiveSheet();
        activeSheetIndexRef.current = newIndex;
        setActiveSheetIndex(newIndex);
        setData(sheetsDataRef.current[newIndex]);
        setColWidths(sheetsColWidthsRef.current[newIndex] ?? new Map());
        setRowHeights(sheetsRowHeightsRef.current[newIndex] ?? new Map());
        resetHistoryAndSelection();
    }, [flushActiveSheet, setData, setColWidths, setRowHeights, resetHistoryAndSelection]);

    const addSheet = useCallback(() => {
        const newIndex = sheetsDataRef.current.length;
        sheetsDataRef.current.push(new Map());
        sheetsColWidthsRef.current.push(new Map());
        sheetsRowHeightsRef.current.push(new Map());
        setSheetNames(prev => [...prev, `Sheet ${newIndex + 1}`]);
        setSheetColors(prev => [...prev, null]);
        dirtyRef.current = true;
        switchSheet(newIndex);
    }, [dirtyRef, switchSheet]);

    const commitRename = useCallback((index: number, value: string) => {
        setSheetNames(prev => prev.map((n, i) => (i === index ? value.trim() || n : n)));
        dirtyRef.current = true;
    }, [dirtyRef]);

    const deleteSheet = useCallback((index: number) => {
        // Use ref so the callback never captures stale state length.
        if (sheetsDataRef.current.length <= 1) return;
        flushActiveSheet();
        sheetsDataRef.current.splice(index, 1);
        sheetsColWidthsRef.current.splice(index, 1);
        sheetsRowHeightsRef.current.splice(index, 1);
        const wasActive = activeSheetIndexRef.current === index;
        let newActiveIndex = activeSheetIndexRef.current;
        if (wasActive) {
            newActiveIndex = index > 0 ? index - 1 : 0;
        } else if (activeSheetIndexRef.current > index) {
            newActiveIndex = activeSheetIndexRef.current - 1;
        }
        setSheetNames(prev => prev.filter((_, i) => i !== index));
        setSheetColors(prev => prev.filter((_, i) => i !== index));
        dirtyRef.current = true;
        activeSheetIndexRef.current = newActiveIndex;
        setActiveSheetIndex(newActiveIndex);
        if (wasActive) {
            setData(sheetsDataRef.current[newActiveIndex]);
            setColWidths(sheetsColWidthsRef.current[newActiveIndex] ?? new Map());
            setRowHeights(sheetsRowHeightsRef.current[newActiveIndex] ?? new Map());
            resetHistoryAndSelection();
        }
    }, [dirtyRef, flushActiveSheet, setData, setColWidths, setRowHeights, resetHistoryAndSelection]);

    const duplicateSheet = useCallback((index: number) => {
        flushActiveSheet();
        const newIndex = sheetsDataRef.current.length;
        sheetsDataRef.current.push(new Map(sheetsDataRef.current[index]));
        sheetsColWidthsRef.current.push(new Map(sheetsColWidthsRef.current[index]));
        sheetsRowHeightsRef.current.push(new Map(sheetsRowHeightsRef.current[index]));
        setSheetNames(prev => [...prev, `${prev[index]} (copy)`]);
        setSheetColors(prev => [...prev, prev[index] ?? null]);
        dirtyRef.current = true;
        switchSheet(newIndex);
    }, [dirtyRef, flushActiveSheet, switchSheet]);

    const addSheetWithData = useCallback((name: string, data: Map<string, CellProps>) => {
        flushActiveSheet();
        const newIndex = sheetsDataRef.current.length;
        sheetsDataRef.current.push(new Map(data));
        sheetsColWidthsRef.current.push(new Map());
        sheetsRowHeightsRef.current.push(new Map());
        setSheetNames(prev => [...prev, name]);
        setSheetColors(prev => [...prev, null]);
        dirtyRef.current = true;
        switchSheet(newIndex);
    }, [dirtyRef, flushActiveSheet, switchSheet]);

    const replaceAllSheets = useCallback((newSheets: { name: string; data: Map<string, CellProps> }[]) => {
        if (newSheets.length === 0) return;
        sheetsDataRef.current = newSheets.map(s => new Map(s.data));
        sheetsColWidthsRef.current = newSheets.map(() => new Map());
        sheetsRowHeightsRef.current = newSheets.map(() => new Map());
        setSheetNames(newSheets.map(s => s.name));
        setSheetColors(newSheets.map(() => null));
        dirtyRef.current = true;
        activeSheetIndexRef.current = 0;
        setActiveSheetIndex(0);
        setData(sheetsDataRef.current[0]);
        setColWidths(new Map());
        setRowHeights(new Map());
        resetHistoryAndSelection();
    }, [setData, setColWidths, setRowHeights, resetHistoryAndSelection]);

    const moveSheet = useCallback((index: number, direction: 'left' | 'right') => {
        const target = direction === 'left' ? index - 1 : index + 1;
        if (target < 0 || target >= sheetsDataRef.current.length) return;
        flushActiveSheet();
        [sheetsDataRef.current[index], sheetsDataRef.current[target]] =
            [sheetsDataRef.current[target], sheetsDataRef.current[index]];
        [sheetsColWidthsRef.current[index], sheetsColWidthsRef.current[target]] =
            [sheetsColWidthsRef.current[target], sheetsColWidthsRef.current[index]];
        [sheetsRowHeightsRef.current[index], sheetsRowHeightsRef.current[target]] =
            [sheetsRowHeightsRef.current[target], sheetsRowHeightsRef.current[index]];
        setSheetNames(prev => { const n = [...prev]; [n[index], n[target]] = [n[target], n[index]]; return n; });
        setSheetColors(prev => { const c = [...prev]; [c[index], c[target]] = [c[target], c[index]]; return c; });
        dirtyRef.current = true;
        if (activeSheetIndexRef.current === index) {
            activeSheetIndexRef.current = target;
            setActiveSheetIndex(target);
        } else if (activeSheetIndexRef.current === target) {
            activeSheetIndexRef.current = index;
            setActiveSheetIndex(index);
        }
    }, [dirtyRef, flushActiveSheet]);

    return {
        sheetsDataRef,
        sheetsColWidthsRef,
        sheetsRowHeightsRef,
        sheetNames,
        setSheetNames,
        sheetNamesRef,
        sheetColors,
        setSheetColors,
        sheetColorsRef,
        activeSheetIndex,
        activeSheetIndexRef,
        flushActiveSheet,
        switchSheet,
        addSheet,
        addSheetWithData,
        replaceAllSheets,
        commitRename,
        deleteSheet,
        duplicateSheet,
        moveSheet,
    };
}
