/**
 * Unit tests for `structuralShift.ts` (TDD red phase — module does not exist
 * yet; these tests are expected to fail with a module-resolution error until
 * a specialist implements `editor/structuralShift.ts`).
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/fix-sheets-structural-shift.md
 * for full background. Summary of the pinned algorithm under test:
 *
 * - `shiftedId(id, axis, op, index)`: unified per-cell id shift. `index` is
 *   1-based (same numbering as cell ids). Insert: coordinate >= index shifts
 *   by +1. Delete: coordinate === index -> null (dropped); coordinate >
 *   index shifts by -1; coordinate < index unaffected.
 * - `shiftCellMap`: rewrites every key via `shiftedId`, then fixes up merge
 *   anchors (grow/shrink spans when the edit lands strictly inside the span)
 *   and member `mergeAnchor` pointers (updated on anchor-id shift, cleared on
 *   anchor drop or full unmerge).
 * - `shiftRect`: shared rectangle-shift logic for CF ranges and table
 *   regions.
 * - `shiftIndexMap`: colWidths/rowHeights are keyed 0-based; `index` is
 *   1-based; the function converts internally.
 * - `parseRangeToBounds`/`boundsToRange`: "A1"/"A1:C5" <-> RectBounds.
 * - `shiftCFRules`: shifts every rule's range via shiftRect, dropping rules
 *   whose range collapses.
 * - `computeStructuralShift`: top-level orchestrator — shifts cells, then
 *   recomputes table-style patches for every surviving TableRegion against
 *   its new bounds (this is the actual bug fix: no more unstyled gap after a
 *   structural edit), and shifts colWidths/rowHeights (matching axis only)
 *   and conditionalFormats.
 */

import { describe, it, expect } from 'vitest';
import {
    shiftedId,
    shiftCellMap,
    shiftRect,
    shiftIndexMap,
    parseRangeToBounds,
    boundsToRange,
    shiftCFRules,
    computeStructuralShift,
    type RectBounds,
} from '../../app/(apps)/sheets/editor/structuralShift';
import { TABLE_STYLES } from '../../app/(apps)/sheets/editor/styles/tableStyles';
import { computeTableStylePatches } from '../../app/(apps)/sheets/editor/styles/applyTableStyle';
import { numToAlpha } from '../../app/(apps)/sheets/editor/utils';
import type { CellProps, CFRule, TableRegion } from '../../app/(apps)/sheets/editor/types';

// ── Test helpers ─────────────────────────────────────────────────────────────

function cell(id: string, extra: Partial<CellProps> = {}): CellProps {
    return { id, value: id, raw: id, edit: false, ...extra };
}

function cfRule(id: string, range: string): CFRule {
    return {
        id,
        range,
        rule: { kind: 'singleColor', condition: 'isEmpty', format: {} },
    };
}

// Builds the set of cell ids for a rectangle (1-based, inclusive), matching
// the RectBounds/TableRegion convention (minR/maxR/minC/maxC).
function rectCellSet(minC: number, minR: number, maxC: number, maxR: number): Set<string> {
    const ids = new Set<string>();
    for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
            ids.add(`${numToAlpha(c)}${r}`);
        }
    }
    return ids;
}

// ── shiftedId ────────────────────────────────────────────────────────────────

describe('shiftedId', () => {
    describe('row axis, insert', () => {
        it('leaves a row below the insertion index unchanged', () => {
            expect(shiftedId('A4', 'row', 'insert', 5)).toBe('A4');
        });
        it('shifts a row exactly at the insertion index by +1', () => {
            expect(shiftedId('A5', 'row', 'insert', 5)).toBe('A6');
        });
        it('shifts a row above the insertion index by +1', () => {
            expect(shiftedId('A6', 'row', 'insert', 5)).toBe('A7');
        });
    });

    describe('row axis, delete', () => {
        it('leaves a row below the delete index unchanged', () => {
            expect(shiftedId('A4', 'row', 'delete', 5)).toBe('A4');
        });
        it('drops the row exactly at the delete index', () => {
            expect(shiftedId('A5', 'row', 'delete', 5)).toBeNull();
        });
        it('shifts a row above the delete index by -1', () => {
            expect(shiftedId('A6', 'row', 'delete', 5)).toBe('A5');
        });
    });

    describe('col axis, insert', () => {
        it('leaves a col below the insertion index unchanged', () => {
            expect(shiftedId('A1', 'col', 'insert', 2)).toBe('A1');
        });
        it('shifts a col exactly at the insertion index by +1', () => {
            expect(shiftedId('B1', 'col', 'insert', 2)).toBe('C1');
        });
        it('shifts a col above the insertion index by +1', () => {
            expect(shiftedId('C1', 'col', 'insert', 2)).toBe('D1');
        });
    });

    describe('col axis, delete', () => {
        it('leaves a col below the delete index unchanged', () => {
            expect(shiftedId('A1', 'col', 'delete', 2)).toBe('A1');
        });
        it('drops the col exactly at the delete index', () => {
            expect(shiftedId('B1', 'col', 'delete', 2)).toBeNull();
        });
        it('shifts a col above the delete index by -1', () => {
            expect(shiftedId('C1', 'col', 'delete', 2)).toBe('B1');
        });
    });
});

// ── shiftCellMap ─────────────────────────────────────────────────────────────

describe('shiftCellMap', () => {
    describe('plain shift (no merges) — matches today\'s 12-handler behavior', () => {
        function plainCells(): Map<string, CellProps> {
            return new Map([
                ['A1', cell('A1')], ['A2', cell('A2')], ['A3', cell('A3')],
                ['B1', cell('B1')], ['B2', cell('B2')], ['B3', cell('B3')],
            ]);
        }

        it('insert row at index 2 shifts rows >= 2 down by one, keeps row 1', () => {
            const result = shiftCellMap(plainCells(), 'row', 'insert', 2);
            expect(result.get('A1')?.raw).toBe('A1');
            expect(result.get('B1')?.raw).toBe('B1');
            expect(result.get('A3')?.raw).toBe('A2');
            expect(result.get('B3')?.raw).toBe('B2');
            expect(result.get('A4')?.raw).toBe('A3');
            expect(result.get('B4')?.raw).toBe('B3');
            expect(result.has('A2')).toBe(false); // nothing maps back onto row 2 as the *new* row 2
            expect(result.size).toBe(6);
        });

        it('delete row at index 2 drops row 2 and shifts rows > 2 up by one', () => {
            const result = shiftCellMap(plainCells(), 'row', 'delete', 2);
            expect(result.get('A1')?.raw).toBe('A1');
            expect(result.get('B1')?.raw).toBe('B1');
            expect(result.get('A2')?.raw).toBe('A3');
            expect(result.get('B2')?.raw).toBe('B3');
            expect(result.size).toBe(4);
        });

        it('insert col at index 2 shifts cols >= 2 right by one, keeps col A', () => {
            const result = shiftCellMap(plainCells(), 'col', 'insert', 2);
            expect(result.get('A1')?.raw).toBe('A1');
            expect(result.get('A2')?.raw).toBe('A2');
            expect(result.get('A3')?.raw).toBe('A3');
            expect(result.get('C1')?.raw).toBe('B1');
            expect(result.get('C2')?.raw).toBe('B2');
            expect(result.get('C3')?.raw).toBe('B3');
            expect(result.size).toBe(6);
        });

        it('delete col at index 2 drops col B, col A survives untouched', () => {
            const result = shiftCellMap(plainCells(), 'col', 'delete', 2);
            expect(result.get('A1')?.raw).toBe('A1');
            expect(result.get('A2')?.raw).toBe('A2');
            expect(result.get('A3')?.raw).toBe('A3');
            expect(result.size).toBe(3);
        });
    });

    describe('merges entirely before/after the edit point', () => {
        it('insert before a merge (index <= anchorMin) slides the whole merge down, fixing up mergeAnchor', () => {
            const cells = new Map<string, CellProps>([
                ['A5', cell('A5', { rowSpan: 3 })],
                ['A6', cell('A6', { mergeAnchor: 'A5' })],
                ['A7', cell('A7', { mergeAnchor: 'A5' })],
            ]);
            const result = shiftCellMap(cells, 'row', 'insert', 2);
            expect(result.get('A6')?.rowSpan).toBe(3);
            expect(result.has('A5')).toBe(false);
            expect(result.get('A7')?.mergeAnchor).toBe('A6');
            expect(result.get('A8')?.mergeAnchor).toBe('A6');
        });

        it('delete before a merge (index < anchorMin) slides the whole merge up, fixing up mergeAnchor', () => {
            const cells = new Map<string, CellProps>([
                ['A5', cell('A5', { rowSpan: 3 })],
                ['A6', cell('A6', { mergeAnchor: 'A5' })],
                ['A7', cell('A7', { mergeAnchor: 'A5' })],
            ]);
            const result = shiftCellMap(cells, 'row', 'delete', 2);
            expect(result.get('A4')?.rowSpan).toBe(3);
            expect(result.get('A5')?.mergeAnchor).toBe('A4');
            expect(result.get('A6')?.mergeAnchor).toBe('A4');
        });

        it('insert after a merge (index > anchorMax) leaves the merge completely untouched', () => {
            const cells = new Map<string, CellProps>([
                ['A5', cell('A5', { rowSpan: 3 })],
                ['A6', cell('A6', { mergeAnchor: 'A5' })],
                ['A7', cell('A7', { mergeAnchor: 'A5' })],
            ]);
            const result = shiftCellMap(cells, 'row', 'insert', 10);
            expect(result.get('A5')?.rowSpan).toBe(3);
            expect(result.get('A6')?.mergeAnchor).toBe('A5');
            expect(result.get('A7')?.mergeAnchor).toBe('A5');
        });

        it('delete after a merge (index > anchorMax) leaves the merge completely untouched', () => {
            const cells = new Map<string, CellProps>([
                ['A5', cell('A5', { rowSpan: 3 })],
                ['A6', cell('A6', { mergeAnchor: 'A5' })],
                ['A7', cell('A7', { mergeAnchor: 'A5' })],
            ]);
            const result = shiftCellMap(cells, 'row', 'delete', 10);
            expect(result.get('A5')?.rowSpan).toBe(3);
            expect(result.get('A6')?.mergeAnchor).toBe('A5');
            expect(result.get('A7')?.mergeAnchor).toBe('A5');
        });
    });

    describe('insert strictly inside a merge span', () => {
        it('grows colSpan by 1, anchor id unchanged, member mergeAnchor strings still correct', () => {
            const cells = new Map<string, CellProps>([
                ['B2', cell('B2', { colSpan: 3 })], // spans B2:D2 (cols 2-4)
                ['C2', cell('C2', { mergeAnchor: 'B2' })],
                ['D2', cell('D2', { mergeAnchor: 'B2' })],
            ]);
            // index 3 is strictly inside (anchorMin 2 < 3 <= anchorMin + span - 1 = 4)
            const result = shiftCellMap(cells, 'col', 'insert', 3);
            expect(result.get('B2')?.colSpan).toBe(4);
            expect(result.get('D2')?.raw).toBe('C2'); // old C2 shifted to D2
            expect(result.get('D2')?.mergeAnchor).toBe('B2');
            expect(result.get('E2')?.raw).toBe('D2'); // old D2 shifted to E2
            expect(result.get('E2')?.mergeAnchor).toBe('B2');
        });
    });

    describe('delete strictly inside a merge span (shrink, not collapsing to 1)', () => {
        it('shrinks colSpan by 1 and fixes up surviving member mergeAnchor', () => {
            const cells = new Map<string, CellProps>([
                ['B2', cell('B2', { colSpan: 4 })], // spans B2:E2 (cols 2-5)
                ['C2', cell('C2', { mergeAnchor: 'B2' })],
                ['D2', cell('D2', { mergeAnchor: 'B2' })],
                ['E2', cell('E2', { mergeAnchor: 'B2' })],
            ]);
            // index 4 is strictly inside (anchorMin 2 < 4 <= anchorMin + span - 1 = 5)
            const result = shiftCellMap(cells, 'col', 'delete', 4);
            expect(result.get('B2')?.colSpan).toBe(3);
            expect(result.get('C2')?.raw).toBe('C2'); // col 3 < 4, untouched
            expect(result.get('C2')?.mergeAnchor).toBe('B2');
            expect(result.get('D2')?.raw).not.toBe('D2'); // old D2 (col 4) is dropped, not surviving under its own key
            expect(result.get('D2')?.raw).toBe('E2'); // old E2 (col 5) shifts into D2
            expect(result.get('D2')?.mergeAnchor).toBe('B2');
        });
    });

    describe('delete that shrinks a merge to a span of 1', () => {
        it('clears the shrunk axis span field to undefined (not 1)', () => {
            const cells = new Map<string, CellProps>([
                ['B2', cell('B2', { colSpan: 2 })], // spans B2:C2
                ['C2', cell('C2', { mergeAnchor: 'B2' })],
            ]);
            // index 3 is strictly inside (anchorMin 2 < 3 <= anchorMin + span - 1 = 3)
            const result = shiftCellMap(cells, 'col', 'delete', 3);
            expect(result.get('B2')?.colSpan).toBeUndefined();
            expect(result.get('B2')?.colSpan).not.toBe(1);
        });

        it('keeps mergeAnchor on a surviving member when only one axis collapses but the other axis is still a real merge', () => {
            // 2x2 merge: B2 anchor (colSpan 2, rowSpan 2) spanning B2:C3.
            const cells = new Map<string, CellProps>([
                ['B2', cell('B2', { colSpan: 2, rowSpan: 2 })],
                ['C2', cell('C2', { mergeAnchor: 'B2' })],
                ['B3', cell('B3', { mergeAnchor: 'B2' })],
                ['C3', cell('C3', { mergeAnchor: 'B2' })],
            ]);
            // Delete row axis at index 3 (anchorMin row 2 < 3 <= anchorMin + rowSpan - 1 = 3):
            // rowSpan shrinks 2 -> 1 (cleared), but colSpan (2) is untouched by a row op,
            // so the anchor is still a real (horizontal) merge.
            const result = shiftCellMap(cells, 'row', 'delete', 3);
            expect(result.get('B2')?.rowSpan).toBeUndefined();
            expect(result.get('B2')?.colSpan).toBe(2);
            expect(result.get('C2')?.mergeAnchor).toBe('B2'); // survives, anchor still has span > 1
        });
    });

    describe('delete landing exactly on the merge anchor\'s own row/col', () => {
        it('drops the anchor like a normal cell and clears mergeAnchor on surviving former members instead of leaving a dangling reference', () => {
            // 2x2 merge: A2 anchor (colSpan 2, rowSpan 2) spanning A2:B3.
            const cells = new Map<string, CellProps>([
                ['A2', cell('A2', { colSpan: 2, rowSpan: 2 })],
                ['B2', cell('B2', { mergeAnchor: 'A2' })],
                ['A3', cell('A3', { mergeAnchor: 'A2' })],
                ['B3', cell('B3', { mergeAnchor: 'A2' })],
            ]);
            // Delete row axis at index 2 === anchorMin row: NOT strictly contained
            // (spec requires anchorMin < index), so the anchor and its same-row
            // sibling are dropped like any other cell at row 2.
            const result = shiftCellMap(cells, 'row', 'delete', 2);

            // The old anchor is gone as an anchor — whatever now occupies A2 (the
            // former A3) must not carry the dropped anchor's colSpan/rowSpan.
            expect(result.get('A2')?.colSpan).toBeUndefined();
            expect(result.get('A2')?.rowSpan).toBeUndefined();
            // A3/B3 (row 3) shift up to row 2, and must not carry a dangling mergeAnchor
            // pointing at the now-dropped 'A2'.
            expect(result.get('A2')?.mergeAnchor).toBeUndefined();
            expect(result.get('B2')?.mergeAnchor).toBeUndefined();
        });
    });
});

// ── shiftRect ────────────────────────────────────────────────────────────────

describe('shiftRect', () => {
    const base: RectBounds = { minR: 5, maxR: 8, minC: 2, maxC: 3 };

    describe('row axis', () => {
        it('insert at/before minR shifts the whole rect down, col untouched', () => {
            expect(shiftRect(base, 'row', 'insert', 5)).toEqual({ minR: 6, maxR: 9, minC: 2, maxC: 3 });
        });
        it('insert strictly inside grows maxR, minR unchanged', () => {
            expect(shiftRect(base, 'row', 'insert', 7)).toEqual({ minR: 5, maxR: 9, minC: 2, maxC: 3 });
        });
        it('insert after maxR is a no-op', () => {
            expect(shiftRect(base, 'row', 'insert', 9)).toEqual(base);
        });
        it('delete before minR shifts the whole rect up', () => {
            expect(shiftRect(base, 'row', 'delete', 3)).toEqual({ minR: 4, maxR: 7, minC: 2, maxC: 3 });
        });
        it('delete inside the range shrinks maxR, minR unchanged', () => {
            expect(shiftRect(base, 'row', 'delete', 6)).toEqual({ minR: 5, maxR: 7, minC: 2, maxC: 3 });
        });
        it('delete after maxR is a no-op', () => {
            expect(shiftRect(base, 'row', 'delete', 9)).toEqual(base);
        });
        it('delete that collapses a 1-row range returns null', () => {
            const oneRow: RectBounds = { minR: 5, maxR: 5, minC: 2, maxC: 3 };
            expect(shiftRect(oneRow, 'row', 'delete', 5)).toBeNull();
        });
    });

    describe('col axis', () => {
        it('insert at/before minC shifts the whole rect right, row untouched', () => {
            expect(shiftRect(base, 'col', 'insert', 2)).toEqual({ minR: 5, maxR: 8, minC: 3, maxC: 4 });
        });
        it('insert strictly inside grows maxC, minC unchanged', () => {
            expect(shiftRect(base, 'col', 'insert', 3)).toEqual({ minR: 5, maxR: 8, minC: 2, maxC: 4 });
        });
        it('insert after maxC is a no-op', () => {
            expect(shiftRect(base, 'col', 'insert', 4)).toEqual(base);
        });
        it('delete before minC shifts the whole rect left', () => {
            expect(shiftRect(base, 'col', 'delete', 1)).toEqual({ minR: 5, maxR: 8, minC: 1, maxC: 2 });
        });
        it('delete after maxC is a no-op', () => {
            expect(shiftRect(base, 'col', 'delete', 4)).toEqual(base);
        });
        it('delete that collapses a 1-col range returns null', () => {
            const oneCol: RectBounds = { minR: 5, maxR: 8, minC: 2, maxC: 2 };
            expect(shiftRect(oneCol, 'col', 'delete', 2)).toBeNull();
        });
    });
});

// ── shiftIndexMap ────────────────────────────────────────────────────────────

describe('shiftIndexMap', () => {
    // Map represents colWidths/rowHeights: 0-based key -> pixel size.
    // 0-based key 0 = row/col 1, key 1 = row/col 2, key 2 = row/col 3, etc.
    function baseMap(): Map<number, number> {
        return new Map([[0, 10], [1, 20], [2, 30], [3, 40]]);
    }

    it('insert at 1-based index 3 shifts 0-based key 2 (row/col 3) to key 3, leaves key 1 (row/col 2) alone', () => {
        const result = shiftIndexMap(baseMap(), 'insert', 3);
        expect(result.get(0)).toBe(10); // row/col 1 untouched
        expect(result.get(1)).toBe(20); // row/col 2 untouched (key 1 < index-1=2)
        expect(result.has(2)).toBe(false); // nothing maps back onto key 2 as the *new* key 2
        expect(result.get(3)).toBe(30); // old key 2 -> key 3
        expect(result.get(4)).toBe(40); // old key 3 -> key 4
    });

    it('delete at 1-based index 3 drops 0-based key 2 (row/col 3), shifts key 3 down to key 2, leaves key 1 alone', () => {
        const result = shiftIndexMap(baseMap(), 'delete', 3);
        expect(result.get(0)).toBe(10);
        expect(result.get(1)).toBe(20);
        expect(result.get(2)).toBe(40); // old key 3 -> key 2
        expect(result.size).toBe(3);
    });
});

// ── parseRangeToBounds / boundsToRange ───────────────────────────────────────

describe('parseRangeToBounds / boundsToRange', () => {
    it('parses a single cell id into a 1x1 RectBounds', () => {
        expect(parseRangeToBounds('A1')).toEqual({ minR: 1, maxR: 1, minC: 1, maxC: 1 });
    });

    it('parses a multi-cell range into RectBounds', () => {
        expect(parseRangeToBounds('A1:C5')).toEqual({ minR: 1, maxR: 5, minC: 1, maxC: 3 });
    });

    it('returns null for an unparseable range', () => {
        expect(parseRangeToBounds('not a range')).toBeNull();
    });

    it('serializes a 1x1 RectBounds back to a bare cell id, not "A1:A1"', () => {
        expect(boundsToRange({ minR: 1, maxR: 1, minC: 1, maxC: 1 })).toBe('A1');
    });

    it('serializes a multi-cell RectBounds to a range string', () => {
        expect(boundsToRange({ minR: 1, maxR: 5, minC: 1, maxC: 3 })).toBe('A1:C5');
    });

    it('round-trips a single cell through parse -> serialize', () => {
        expect(boundsToRange(parseRangeToBounds('A1')!)).toBe('A1');
    });

    it('round-trips a multi-cell range through parse -> serialize', () => {
        expect(boundsToRange(parseRangeToBounds('A1:C5')!)).toBe('A1:C5');
    });
});

// ── shiftCFRules ─────────────────────────────────────────────────────────────

describe('shiftCFRules', () => {
    it('leaves a rule entirely after the insert point unaffected', () => {
        const rules = [cfRule('r1', 'A1:B2')];
        const result = shiftCFRules(rules, 'row', 'insert', 10);
        expect(result).toHaveLength(1);
        expect(result[0].range).toBe('A1:B2');
    });

    it('shifts a rule entirely before the insert point (whole range slides)', () => {
        const rules = [cfRule('r1', 'A5:B6')];
        const result = shiftCFRules(rules, 'row', 'insert', 2);
        expect(result).toHaveLength(1);
        expect(result[0].range).toBe('A6:B7');
    });

    it('grows a rule whose range strictly contains the insert point', () => {
        const rules = [cfRule('r1', 'A5:B10')];
        const result = shiftCFRules(rules, 'row', 'insert', 7);
        expect(result).toHaveLength(1);
        expect(result[0].range).toBe('A5:B11');
    });

    it('drops a rule entirely instead of emitting an inverted/empty range when a delete collapses it', () => {
        const rules = [cfRule('r1', 'A5:B5'), cfRule('r2', 'A10:B10')];
        const result = shiftCFRules(rules, 'row', 'delete', 5);
        expect(result.find(r => r.id === 'r1')).toBeUndefined();
        const survivor = result.find(r => r.id === 'r2');
        expect(survivor).toBeDefined();
        expect(survivor!.range).toBe('A9:B9'); // shifted up by the deletion above it
        expect(result).toHaveLength(1);
    });

    it('shrinks a rule whose range is delete-inside without dropping it', () => {
        const rules = [cfRule('r1', 'A5:B10')];
        const result = shiftCFRules(rules, 'row', 'delete', 7);
        expect(result).toHaveLength(1);
        expect(result[0].range).toBe('A5:B9');
    });
});

// ── computeStructuralShift ───────────────────────────────────────────────────

describe('computeStructuralShift', () => {
    function emptyInput(overrides: Partial<Parameters<typeof computeStructuralShift>[0]> = {}) {
        return {
            cells: new Map<string, CellProps>(),
            colWidths: new Map<number, number>(),
            rowHeights: new Map<number, number>(),
            conditionalFormats: [] as CFRule[],
            tableRegions: [] as TableRegion[],
            axis: 'row' as const,
            op: 'insert' as const,
            index: 1,
            ...overrides,
        };
    }

    it('inserting a row strictly inside a banded table region grows its bounds and recolors with no unstyled gap', () => {
        const style = TABLE_STYLES.find(s => s.id === 'blue-banded')!;
        const region: TableRegion = { id: 't1', styleId: 'blue-banded', minR: 1, maxR: 4, minC: 1, maxC: 2 };
        // A sentinel cell well outside the region, on a row below the insertion
        // point — must survive completely untouched.
        const cells = new Map<string, CellProps>([
            ['Z1', cell('Z1', { raw: 'untouched' })],
        ]);

        const result = computeStructuralShift(emptyInput({
            cells, tableRegions: [region], axis: 'row', op: 'insert', index: 2,
        }));

        expect(result.tableRegions).toHaveLength(1);
        expect(result.tableRegions[0]).toEqual({ id: 't1', styleId: 'blue-banded', minR: 1, maxR: 5, minC: 1, maxC: 2 });

        // Sentinel cell (row 1, below the insertion index) must be unaffected.
        expect(result.cells.get('Z1')?.raw).toBe('untouched');
        expect(result.cells.get('Z1')?.cellStyle).toBeUndefined();

        // Recompute the expected per-cell patches against the *new* bounds directly
        // via the already-tested pure function, and confirm the orchestrator
        // produced exactly this — including the newly-inserted row, proving there
        // is no unstyled gap.
        const expectedPatches = computeTableStylePatches(style, rectCellSet(1, 1, 2, 5));
        for (const [id, patch] of expectedPatches) {
            expect(result.cells.get(id)?.cellStyle).toEqual(patch);
        }
    });

    it('inserting a column before a header+totals region shifts the whole region and follows header-column coloring', () => {
        const style = TABLE_STYLES.find(s => s.id === 'red-header-totals')!;
        const region: TableRegion = { id: 't1', styleId: 'red-header-totals', minR: 1, maxR: 3, minC: 3, maxC: 5 }; // C1:E3

        const result = computeStructuralShift(emptyInput({
            tableRegions: [region], axis: 'col', op: 'insert', index: 2, // index <= minC(3): whole region shifts right
        }));

        expect(result.tableRegions).toHaveLength(1);
        expect(result.tableRegions[0]).toEqual({ id: 't1', styleId: 'red-header-totals', minR: 1, maxR: 3, minC: 4, maxC: 6 });

        const expectedPatches = computeTableStylePatches(style, rectCellSet(4, 1, 6, 3));
        for (const [id, patch] of expectedPatches) {
            expect(result.cells.get(id)?.cellStyle).toEqual(patch);
        }
        // Header column (new minC = 4, i.e. col D) must carry the header look on a
        // body row, proving header-column coloring followed the shift.
        expect(result.cells.get('D2')?.cellStyle).toEqual(expectedPatches.get('D2'));
        expect(result.cells.get('D2')?.cellStyle?.backgroundColor).toBe(style.header.backgroundColor);
    });

    it('deleting a non-edge row from inside a region shrinks bounds by 1 and recolors correctly', () => {
        const style = TABLE_STYLES.find(s => s.id === 'blue-banded')!;
        const region: TableRegion = { id: 't1', styleId: 'blue-banded', minR: 1, maxR: 5, minC: 1, maxC: 2 };

        const result = computeStructuralShift(emptyInput({
            tableRegions: [region], axis: 'row', op: 'delete', index: 3,
        }));

        expect(result.tableRegions[0]).toEqual({ id: 't1', styleId: 'blue-banded', minR: 1, maxR: 4, minC: 1, maxC: 2 });
        const expectedPatches = computeTableStylePatches(style, rectCellSet(1, 1, 2, 4));
        for (const [id, patch] of expectedPatches) {
            expect(result.cells.get(id)?.cellStyle).toEqual(patch);
        }
    });

    it('deleting the header row of a region does not crash and recolors the new top row as the header', () => {
        const style = TABLE_STYLES.find(s => s.id === 'blue-banded')!;
        const region: TableRegion = { id: 't1', styleId: 'blue-banded', minR: 1, maxR: 5, minC: 1, maxC: 2 };

        const result = computeStructuralShift(emptyInput({
            tableRegions: [region], axis: 'row', op: 'delete', index: 1, // deletes the header row itself
        }));

        expect(result.tableRegions[0]).toEqual({ id: 't1', styleId: 'blue-banded', minR: 1, maxR: 4, minC: 1, maxC: 2 });
        // Row 1 of the new (shrunk) bounds must carry the header look, whatever
        // cell now occupies it.
        expect(result.cells.get('A1')?.cellStyle?.backgroundColor).toBe(style.header.backgroundColor);
        expect(result.cells.get('B1')?.cellStyle?.backgroundColor).toBe(style.header.backgroundColor);
    });

    it('deleting the total row of a region does not crash and moves the total-row look to the new last row', () => {
        const style = TABLE_STYLES.find(s => s.id === 'blue-header-totals')!;
        const region: TableRegion = { id: 't1', styleId: 'blue-header-totals', minR: 1, maxR: 4, minC: 1, maxC: 2 };

        const result = computeStructuralShift(emptyInput({
            tableRegions: [region], axis: 'row', op: 'delete', index: 4, // deletes the total row itself
        }));

        expect(result.tableRegions[0]).toEqual({ id: 't1', styleId: 'blue-header-totals', minR: 1, maxR: 3, minC: 1, maxC: 2 });
        // Row 3 (new maxR, and maxR > minR) must now carry the header/total look.
        expect(result.cells.get('A3')?.cellStyle?.backgroundColor).toBe(style.header.backgroundColor);
        expect(result.cells.get('B3')?.cellStyle?.backgroundColor).toBe(style.header.backgroundColor);
    });

    it('drops a table region entirely when it collapses to zero size', () => {
        const region: TableRegion = { id: 't1', styleId: 'blue-banded', minR: 5, maxR: 5, minC: 1, maxC: 2 };
        const result = computeStructuralShift(emptyInput({
            tableRegions: [region], axis: 'row', op: 'delete', index: 5,
        }));
        expect(result.tableRegions).toHaveLength(0);
    });

    it('only shifts colWidths for a col-axis op, leaving rowHeights untouched (and vice versa)', () => {
        // Independent fresh Map instances per assertion, and expected values
        // precomputed from fresh copies *before* calling the orchestrator, so
        // this test makes no assumption about whether the orchestrator mutates
        // or replaces its input maps.
        const expectedShiftedRowHeights = [...shiftIndexMap(new Map([[0, 20], [1, 25]]), 'insert', 2).entries()];
        const expectedShiftedColWidths = [...shiftIndexMap(new Map([[0, 50], [1, 60]]), 'insert', 2).entries()];

        const rowResult = computeStructuralShift(emptyInput({
            colWidths: new Map([[0, 50], [1, 60]]),
            rowHeights: new Map([[0, 20], [1, 25]]),
            axis: 'row', op: 'insert', index: 2,
        }));
        expect([...rowResult.colWidths.entries()]).toEqual([[0, 50], [1, 60]]); // untouched
        expect([...rowResult.rowHeights.entries()]).toEqual(expectedShiftedRowHeights);

        const colResult = computeStructuralShift(emptyInput({
            colWidths: new Map([[0, 50], [1, 60]]),
            rowHeights: new Map([[0, 20], [1, 25]]),
            axis: 'col', op: 'insert', index: 2,
        }));
        expect([...colResult.rowHeights.entries()]).toEqual([[0, 20], [1, 25]]); // untouched
        expect([...colResult.colWidths.entries()]).toEqual(expectedShiftedColWidths);
    });

    it('shifts conditionalFormats and tableRegions together in a single call', () => {
        const conditionalFormats: CFRule[] = [cfRule('cf1', 'A5:B10')];
        const tableRegions: TableRegion[] = [{ id: 't1', styleId: 'blue-banded', minR: 5, maxR: 10, minC: 1, maxC: 2 }];

        const result = computeStructuralShift(emptyInput({
            conditionalFormats, tableRegions, axis: 'row', op: 'insert', index: 2, // index <= minR(5) for both: whole shift
        }));

        expect(result.conditionalFormats).toHaveLength(1);
        expect(result.conditionalFormats[0].range).toBe('A6:B11');
        expect(result.tableRegions).toHaveLength(1);
        expect(result.tableRegions[0]).toEqual({ id: 't1', styleId: 'blue-banded', minR: 6, maxR: 11, minC: 1, maxC: 2 });
    });
});

// ── Chained shifts (multi-header operations, issue #63) ──────────────────────
//
// SheetEditor's `runStructuralShifts` feeds each result straight into the next
// call so a multi-column/row menu action lands as one undo step. These pin the
// two orderings it relies on.

describe('chained computeStructuralShift (multi-header operations)', () => {
    function chain(
        cells: Map<string, CellProps>,
        axis: 'row' | 'col',
        op: 'insert' | 'delete',
        indices: number[],
    ): Map<string, CellProps> {
        let state = {
            cells,
            colWidths: new Map<number, number>(),
            rowHeights: new Map<number, number>(),
            conditionalFormats: [] as CFRule[],
            tableRegions: [] as TableRegion[],
        };
        for (const index of indices) {
            state = computeStructuralShift({ ...state, axis, op, index });
        }
        return state.cells;
    }

    it('deletes a non-contiguous set of columns when applied highest-first', () => {
        const cells = new Map<string, CellProps>([
            ['A1', cell('A1', { raw: 'a' })],
            ['B1', cell('B1', { raw: 'b' })],
            ['C1', cell('C1', { raw: 'c' })],
            ['D1', cell('D1', { raw: 'd' })],
        ]);
        // Columns A and C selected → 1-based [1, 3], applied descending.
        const result = chain(cells, 'col', 'delete', [3, 1]);
        expect([...result.keys()].sort()).toEqual(['A1', 'B1']);
        expect(result.get('A1')?.raw).toBe('b');
        expect(result.get('B1')?.raw).toBe('d');
    });

    it('inserts a block of rows by repeating the same index', () => {
        const cells = new Map<string, CellProps>([
            ['A1', cell('A1', { raw: 'first' })],
            ['A2', cell('A2', { raw: 'second' })],
        ]);
        // Three rows selected starting at row 2 → three inserts at index 2.
        const result = chain(cells, 'row', 'insert', [2, 2, 2]);
        expect(result.get('A1')?.raw).toBe('first');
        expect(result.get('A5')?.raw).toBe('second');
        expect(result.has('A2')).toBe(false);
    });
});
