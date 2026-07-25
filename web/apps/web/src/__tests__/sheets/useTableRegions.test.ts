/**
 * Unit tests for the `useTableRegions` hook (TDD red phase — hook does not
 * exist yet; expected to fail with a module-resolution error until a
 * specialist implements `editor/hooks/useTableRegions.ts`).
 *
 * Per the plan
 * (/Users/williamcherry/neutrino/agent_docs/plans/fix-sheets-structural-shift.md),
 * this hook mirrors `useConditionalFormatting.ts`'s shape exactly:
 *   - `sheetsTableRegionsRef`: per-sheet array of TableRegion[]
 *   - `tableRegions` / `tableRegionsRef`: active-sheet state + ref
 *   - `flushActiveTableRegions()`: writes the active sheet's current state
 *     into `sheetsTableRegionsRef.current[activeSheetIndexRef.current]`
 *   - `switchSheetTableRegions(newIndex)`: loads
 *     `sheetsTableRegionsRef.current[newIndex]` into `tableRegions` state,
 *     growing the per-sheet array with empty arrays as needed
 *   - `updateTableRegions(regions)`: sets ref + state + marks dirty
 * PLUS a new method not present on useConditionalFormatting:
 *   - `registerRegion(region: TableRegion)`: drops any existing region whose
 *     bounds overlap the new one's bounds, then appends the new region.
 *
 * The `dirtyRef`/`activeSheetIndexRef` params are plain refs supplied by the
 * caller (SheetEditor owns them) — tests create local refs the same way.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useTableRegions } from '../../app/(apps)/sheets/editor/hooks/useTableRegions';
import type { TableRegion } from '../../app/(apps)/sheets/editor/types';

function region(id: string, minR: number, maxR: number, minC: number, maxC: number, styleId = 'blue-banded'): TableRegion {
    return { id, styleId, minR, maxR, minC, maxC };
}

// Renders the hook the way SheetEditor would: dirtyRef/activeSheetIndexRef are
// owned by the caller and passed in as stable refs.
function setup() {
    return renderHook(() => {
        const dirtyRef = useRef(false);
        const activeSheetIndexRef = useRef(0);
        const hook = useTableRegions({ dirtyRef, activeSheetIndexRef });
        return { ...hook, dirtyRef, activeSheetIndexRef };
    });
}

describe('useTableRegions', () => {
    it('starts with an empty tableRegions array', () => {
        const { result } = setup();
        expect(result.current.tableRegions).toEqual([]);
    });

    it('registerRegion adds a new region', () => {
        const { result } = setup();
        act(() => result.current.registerRegion(region('t1', 1, 4, 1, 2)));
        expect(result.current.tableRegions).toEqual([region('t1', 1, 4, 1, 2)]);
    });

    it('registerRegion marks the hook dirty', () => {
        const { result } = setup();
        expect(result.current.dirtyRef.current).toBe(false);
        act(() => result.current.registerRegion(region('t1', 1, 4, 1, 2)));
        expect(result.current.dirtyRef.current).toBe(true);
    });

    it('registerRegion replaces an existing region whose bounds overlap the new one', () => {
        const { result } = setup();
        act(() => result.current.registerRegion(region('t1', 1, 3, 1, 2))); // A1:B3
        act(() => result.current.registerRegion(region('t2', 2, 4, 1, 2))); // A2:B4 — overlaps rows 2-3

        expect(result.current.tableRegions).toEqual([region('t2', 2, 4, 1, 2)]);
    });

    it('registerRegion keeps non-overlapping regions alongside a newly-registered one', () => {
        const { result } = setup();
        act(() => result.current.registerRegion(region('t1', 1, 3, 1, 2)));  // A1:B3
        act(() => result.current.registerRegion(region('t2', 10, 12, 1, 2))); // A10:B12, no overlap with t1

        expect(result.current.tableRegions).toEqual([
            region('t1', 1, 3, 1, 2),
            region('t2', 10, 12, 1, 2),
        ]);
    });

    it('registerRegion treats non-intersecting rectangles on the same rows but different columns as non-overlapping', () => {
        const { result } = setup();
        act(() => result.current.registerRegion(region('t1', 1, 3, 1, 2))); // A1:B3
        act(() => result.current.registerRegion(region('t2', 1, 3, 5, 6))); // E1:F3, same rows, disjoint cols

        expect(result.current.tableRegions).toHaveLength(2);
        expect(result.current.tableRegions.map(r => r.id).sort()).toEqual(['t1', 't2']);
    });

    it('flushActiveTableRegions + switchSheetTableRegions round-trip per-sheet state, mirroring useConditionalFormatting', () => {
        const { result } = setup();

        // Sheet 0: register a region, then flush it into the per-sheet store.
        act(() => result.current.registerRegion(region('sheet0-region', 1, 3, 1, 2)));
        act(() => result.current.flushActiveTableRegions());

        // Switch to sheet 1 (never touched before): should load as empty.
        act(() => {
            result.current.activeSheetIndexRef.current = 1;
            result.current.switchSheetTableRegions(1);
        });
        expect(result.current.tableRegions).toEqual([]);

        // Register a different region on sheet 1 and flush it.
        act(() => result.current.registerRegion(region('sheet1-region', 5, 6, 1, 2)));
        act(() => result.current.flushActiveTableRegions());

        // Switch back to sheet 0: its region must still be there, untouched.
        act(() => {
            result.current.activeSheetIndexRef.current = 0;
            result.current.switchSheetTableRegions(0);
        });
        expect(result.current.tableRegions).toEqual([region('sheet0-region', 1, 3, 1, 2)]);

        // And sheet 1's region survived independently.
        act(() => {
            result.current.activeSheetIndexRef.current = 1;
            result.current.switchSheetTableRegions(1);
        });
        expect(result.current.tableRegions).toEqual([region('sheet1-region', 5, 6, 1, 2)]);
    });

    it('updateTableRegions sets state, ref, and marks dirty directly (bypassing registerRegion)', () => {
        const { result } = setup();
        const regions = [region('t1', 1, 2, 1, 2)];
        act(() => result.current.updateTableRegions(regions));
        expect(result.current.tableRegions).toEqual(regions);
        expect(result.current.tableRegionsRef.current).toEqual(regions);
        expect(result.current.dirtyRef.current).toBe(true);
    });
});
