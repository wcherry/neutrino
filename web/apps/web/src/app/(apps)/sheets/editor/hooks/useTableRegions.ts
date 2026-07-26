'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { TableRegion } from '../types';

// Standard 2D rectangle-overlap test (bounds are 1-based, inclusive).
function regionsOverlap(a: TableRegion, b: TableRegion): boolean {
    return !(a.maxC < b.minC || b.maxC < a.minC || a.maxR < b.minR || b.maxR < a.minR);
}

export function useTableRegions({
    dirtyRef,
    activeSheetIndexRef,
}: {
    dirtyRef: React.MutableRefObject<boolean>;
    activeSheetIndexRef: React.MutableRefObject<number>;
}) {
    const sheetsTableRegionsRef = useRef<TableRegion[][]>([[]]);

    const [tableRegions, setTableRegions] = useState<TableRegion[]>([]);
    const tableRegionsRef = useRef<TableRegion[]>([]);

    useEffect(() => { tableRegionsRef.current = tableRegions; }, [tableRegions]);

    const flushActiveTableRegions = useCallback(() => {
        sheetsTableRegionsRef.current[activeSheetIndexRef.current] = tableRegionsRef.current;
    }, [activeSheetIndexRef]);

    const switchSheetTableRegions = useCallback((newIndex: number) => {
        while (sheetsTableRegionsRef.current.length <= newIndex) {
            sheetsTableRegionsRef.current.push([]);
        }
        setTableRegions(sheetsTableRegionsRef.current[newIndex] ?? []);
    }, []);

    const updateTableRegions = useCallback((regions: TableRegion[]) => {
        tableRegionsRef.current = regions;
        setTableRegions(regions);
        dirtyRef.current = true;
    }, [dirtyRef]);

    // Drops any existing region whose bounds overlap the new one, then appends
    // it. Intentionally simple replace-on-overlap — not real region-merge
    // semantics.
    const registerRegion = useCallback((region: TableRegion) => {
        const next = tableRegionsRef.current.filter(r => !regionsOverlap(r, region));
        next.push(region);
        updateTableRegions(next);
    }, [updateTableRegions]);

    // Pure removal (no add-back), used e.g. by the "Blank" table style to
    // clear table-region tracking for a selection without registering a new
    // region in its place.
    const removeOverlapping = useCallback((bounds: { minR: number; maxR: number; minC: number; maxC: number }) => {
        const probe: TableRegion = { id: '__probe__', styleId: '', ...bounds };
        const next = tableRegionsRef.current.filter(r => !regionsOverlap(r, probe));
        updateTableRegions(next);
    }, [updateTableRegions]);

    return {
        tableRegions,
        tableRegionsRef,
        sheetsTableRegionsRef,
        setTableRegions,
        updateTableRegions,
        flushActiveTableRegions,
        switchSheetTableRegions,
        registerRegion,
        removeOverlapping,
    };
}
