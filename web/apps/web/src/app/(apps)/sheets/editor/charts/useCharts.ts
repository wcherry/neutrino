'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { CellProps } from '../types';
import type { ChartDef } from './chartTypes';

export function useCharts({
    dataRef,
    dirtyRef,
    activeSheetIndexRef,
}: {
    dataRef: React.MutableRefObject<Map<string, CellProps>>;
    dirtyRef: React.MutableRefObject<boolean>;
    activeSheetIndexRef: React.MutableRefObject<number>;
}) {
    // Per-sheet charts arrays, mirroring the sheets pattern from useSheets.
    // Initialised with one empty array for Sheet 1.
    const sheetsChartsRef = useRef<ChartDef[][]>([[]]);

    const [charts, setCharts] = useState<ChartDef[]>([]);
    const chartsRef = useRef<ChartDef[]>([]);

    // Keep chartsRef in sync with state (same pattern as dataRef).
    useEffect(() => { chartsRef.current = charts; }, [charts]);

    // Flush the currently displayed charts back into the per-sheet array.
    // Must be called before switching sheets or serialising.
    const flushActiveCharts = useCallback(() => {
        sheetsChartsRef.current[activeSheetIndexRef.current] = chartsRef.current;
    }, [activeSheetIndexRef]);

    // Switch to a new sheet's charts, first flushing the current one.
    const switchSheetCharts = useCallback((newIndex: number) => {
        flushActiveCharts();
        // Ensure the target sheet has an array (may not exist yet for newly added sheets).
        while (sheetsChartsRef.current.length <= newIndex) {
            sheetsChartsRef.current.push([]);
        }
        const nextCharts = sheetsChartsRef.current[newIndex] ?? [];
        setCharts(nextCharts);
    }, [flushActiveCharts]);

    const addChart = useCallback((def: ChartDef) => {
        setCharts(prev => [...prev, def]);
        dirtyRef.current = true;
    }, [dirtyRef]);

    const removeChart = useCallback((id: string) => {
        setCharts(prev => prev.filter(c => c.id !== id));
        dirtyRef.current = true;
    }, [dirtyRef]);

    const updateChart = useCallback((id: string, patch: Partial<ChartDef>) => {
        setCharts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
        dirtyRef.current = true;
    }, [dirtyRef]);

    // Suppress the unused variable lint warning — dataRef is kept in the
    // signature so callers can pass it for future use (cell-change subscriptions).
    void dataRef;

    return {
        charts,
        chartsRef,
        sheetsChartsRef,
        addChart,
        removeChart,
        updateChart,
        flushActiveCharts,
        switchSheetCharts,
        setCharts,
    };
}
