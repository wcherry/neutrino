/**
 * Tests for formula dependency propagation (issue #4).
 *
 * When a cell value changes, all cells whose formulas reference that cell
 * must recalculate automatically. This requires two things to be in place:
 *
 * 1. `dependents` must be populated when the sheet is loaded (evaluateSheetMap
 *    must build the reverse dependency graph after evaluating all formulas).
 * 2. `propagateDeps` must walk the graph and recompute each dependent cell.
 */

import { describe, it, expect } from 'vitest';
import { computeCell, propagateDeps } from '../../app/(apps)/sheets/editor/formula';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

// Helper: build a CellProps map with deps and dependents wired up — simulating
// what the fixed evaluateSheetMap() produces on load.
function buildSheet(entries: { id: string; raw: string }[]): Map<string, CellProps> {
    const map = new Map<string, CellProps>();

    // Pass 1: evaluate all cells and collect deps.
    for (const { id, raw } of entries) {
        const { value, deps } = computeCell(raw, map);
        map.set(id, { id, raw, value, deps, edit: false });
    }

    // Pass 2: build reverse dependency graph (dependents).
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

describe('propagateDeps — basic recalculation', () => {
    it('recalculates a direct dependent when a cell changes', () => {
        // A1 = 1, A2 = =A1+1  →  A2 should be 2
        const data = buildSheet([
            { id: 'A1', raw: '1' },
            { id: 'A2', raw: '=A1+1' },
        ]);

        expect(data.get('A2')?.value).toBe('2');

        // Now change A1 to 5 and propagate.
        const a1 = data.get('A1')!;
        data.set('A1', { ...a1, value: '5', raw: '5' });

        propagateDeps('A1', data, new Set(['A1']));

        // A2 should now be 6.
        expect(data.get('A2')?.value).toBe('6');
    });

    it('recalculates a transitive chain: A1 → A2 → A3', () => {
        // A1=1, A2==A1+1 (2), A3==A2+1 (3)
        const data = buildSheet([
            { id: 'A1', raw: '1' },
            { id: 'A2', raw: '=A1+1' },
            { id: 'A3', raw: '=A2+1' },
        ]);

        expect(data.get('A2')?.value).toBe('2');
        expect(data.get('A3')?.value).toBe('3');

        // Change A1 to 10.
        const a1 = data.get('A1')!;
        data.set('A1', { ...a1, value: '10', raw: '10' });

        propagateDeps('A1', data, new Set(['A1']));

        expect(data.get('A2')?.value).toBe('11');
        expect(data.get('A3')?.value).toBe('12');
    });

    it('recalculates multiple direct dependents on the same cell', () => {
        // A1=5, B1==A1*2 (10), C1==A1+3 (8)
        const data = buildSheet([
            { id: 'A1', raw: '5' },
            { id: 'B1', raw: '=A1*2' },
            { id: 'C1', raw: '=A1+3' },
        ]);

        expect(data.get('B1')?.value).toBe('10');
        expect(data.get('C1')?.value).toBe('8');

        // Change A1 to 7.
        const a1 = data.get('A1')!;
        data.set('A1', { ...a1, value: '7', raw: '7' });

        propagateDeps('A1', data, new Set(['A1']));

        expect(data.get('B1')?.value).toBe('14');
        expect(data.get('C1')?.value).toBe('10');
    });

    it('handles SUM formula recalculation', () => {
        // A1=1, A2=2, A3=3, B1==SUM(A1:A3)=6
        const data = buildSheet([
            { id: 'A1', raw: '1' },
            { id: 'A2', raw: '2' },
            { id: 'A3', raw: '3' },
            { id: 'B1', raw: '=SUM(A1:A3)' },
        ]);

        expect(data.get('B1')?.value).toBe('6');

        // Change A2 to 10.
        const a2 = data.get('A2')!;
        data.set('A2', { ...a2, value: '10', raw: '10' });

        propagateDeps('A2', data, new Set(['A2']));

        // B1 should be 1 + 10 + 3 = 14.
        expect(data.get('B1')?.value).toBe('14');
    });

    it('does not recalculate cells with no formula reference to the changed cell', () => {
        // A1=1, A2==A1+1, B2=99 (no reference to A1)
        const data = buildSheet([
            { id: 'A1', raw: '1' },
            { id: 'A2', raw: '=A1+1' },
            { id: 'B2', raw: '99' },
        ]);

        const b2Before = data.get('B2')?.value;

        const a1 = data.get('A1')!;
        data.set('A1', { ...a1, value: '5', raw: '5' });
        propagateDeps('A1', data, new Set(['A1']));

        // B2 must be unchanged.
        expect(data.get('B2')?.value).toBe(b2Before);
    });
});

describe('buildSheet — dependents are wired correctly on load', () => {
    it('sets dependents on a referenced cell', () => {
        const data = buildSheet([
            { id: 'A1', raw: '1' },
            { id: 'A2', raw: '=A1+1' },
        ]);

        // A1 should list A2 as a dependent.
        expect(data.get('A1')?.dependents).toContain('A2');
    });

    it('sets dependents for range formulas', () => {
        const data = buildSheet([
            { id: 'A1', raw: '1' },
            { id: 'A2', raw: '2' },
            { id: 'A3', raw: '3' },
            { id: 'B1', raw: '=SUM(A1:A3)' },
        ]);

        // Each cell in the range should list B1 as a dependent.
        expect(data.get('A1')?.dependents).toContain('B1');
        expect(data.get('A2')?.dependents).toContain('B1');
        expect(data.get('A3')?.dependents).toContain('B1');
    });

    it('does not duplicate entries in dependents', () => {
        // A2 references A1 twice (edge case for malformed formulas)
        // Using a simpler formula that naturally references A1 once.
        const data = buildSheet([
            { id: 'A1', raw: '2' },
            { id: 'A2', raw: '=A1+A1' },
        ]);

        const dependents = data.get('A1')?.dependents ?? [];
        const occurrences = dependents.filter(d => d === 'A2').length;
        // A2 should appear at most once even though it's referenced twice.
        expect(occurrences).toBeLessThanOrEqual(1);
    });
});
