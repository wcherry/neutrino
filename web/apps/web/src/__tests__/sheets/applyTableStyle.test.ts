/**
 * Unit tests for computeTableStylePatches (TDD red phase — the updated
 * signature/behavior below does not exist yet; today's implementation still
 * takes the OLD `TableStyle` union with a bare `borderStyle: CellStyle['borderStyle']`
 * field and only spreads that single field into patches).
 *
 * Planned change: `computeTableStylePatches` now takes a `RegularTableStyle`
 * (see tableStyles.test.ts / types plan) whose `border` field is a
 * `BorderPatch` object (`{ borderStyle, borderTop, borderRight, borderBottom,
 * borderLeft }`), and the function spreads the FULL `style.border` patch —
 * not just a `borderStyle` field — into BOTH the header-look patch and every
 * body/band patch, so all 5 border keys flow through consistently for
 * header cells, band cells, and total-row cells alike, for all 3 border
 * variants (uniform / no borders / horizontal-only).
 *
 * The core banding/header-look algorithm itself is UNCHANGED from before
 * (see the original algorithm description this file used to carry):
 * 1. Parse every cell id into col/row; compute minC/minR/maxC/maxR over the
 *    given `cells` set.
 * 2. Body patch per cell: `{ ...style.border, fontWeight: 'normal', color:
 *    undefined, backgroundColor }`, where banding parity is relative to the
 *    first body row: `headerOffset = style.headerRow ? 1 : 0`,
 *    `bodyRowIndex = row - minR - headerOffset`, `backgroundColor =
 *    bodyRowIndex % 2 === 0 ? style.bandColorA : style.bandColorB`.
 * 3. Overrides applied in order (later wins): headerColumn (col === minC),
 *    headerRow (row === minR), totalRow (row === maxR && maxR > minR) — each
 *    replaces the cell's patch with the "header look":
 *    `{ backgroundColor: style.header.backgroundColor, color:
 *    style.header.color, fontWeight: 'bold', ...style.border }`.
 * 4. Returns a patch for every cell in the input set.
 */

import { describe, it, expect } from 'vitest';
import { computeTableStylePatches } from '../../app/(apps)/sheets/editor/styles/applyTableStyle';
import type { CellStyle } from '../../app/(apps)/sheets/editor/types';

// Mirror of the planned `RegularTableStyle` shape (types.ts / tableStyles.ts
// aren't updated yet, so this is a local structural fixture type — vitest's
// esbuild transform doesn't type-check against the real not-yet-updated
// `TableStyle`/`computeTableStylePatches` signatures, so this compiles and
// runs today even though the source doesn't match it yet).
type BorderPatch = Pick<CellStyle, 'borderStyle' | 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft'>;
type RegularTableStyleFixture = {
    kind: 'regular';
    id: string;
    name: string;
    header: { backgroundColor: string; color: string };
    bandColorA: string;
    bandColorB: string;
    border: BorderPatch;
    headerRow: boolean;
    headerColumn: boolean;
    totalRow: boolean;
};

const UNIFORM_BORDER: BorderPatch = {
    borderStyle: 'thin', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined,
};
const NO_BORDER: BorderPatch = {
    borderStyle: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
};
const HORIZONTAL_BORDER: BorderPatch = {
    borderStyle: 'none', borderTop: 'thin', borderRight: 'none', borderBottom: 'thin', borderLeft: 'none',
};

function headerPatch(border: BorderPatch): Partial<CellStyle> {
    return {
        backgroundColor: '#1e40af',
        color: '#ffffff',
        fontWeight: 'bold',
        ...border,
    };
}

function bodyPatch(backgroundColor: string, border: BorderPatch = UNIFORM_BORDER): Partial<CellStyle> {
    return {
        fontWeight: 'normal',
        color: undefined,
        backgroundColor,
        ...border,
    };
}

function rangeCells(colStart: string, rowStart: number, colEnd: string, rowEnd: number): Set<string> {
    const cols = colStart.charCodeAt(0) <= colEnd.charCodeAt(0)
        ? Array.from({ length: colEnd.charCodeAt(0) - colStart.charCodeAt(0) + 1 }, (_, i) =>
              String.fromCharCode(colStart.charCodeAt(0) + i)
          )
        : [];
    const cells = new Set<string>();
    for (let r = rowStart; r <= rowEnd; r++) {
        for (const c of cols) {
            cells.add(`${c}${r}`);
        }
    }
    return cells;
}

describe('computeTableStylePatches', () => {
    describe('Scenario A — Banded style over A1:D4 (uniform border)', () => {
        const style: RegularTableStyleFixture = {
            kind: 'regular',
            id: 'banded-blue',
            name: 'Blue Banded',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            border: UNIFORM_BORDER,
            headerRow: true,
            headerColumn: false,
            totalRow: false,
        };
        const cells = rangeCells('A', 1, 'D', 4);
        const patches = computeTableStylePatches(style as any, cells);

        it('gives every cell in row 1 (header row) the header patch', () => {
            for (const id of ['A1', 'B1', 'C1', 'D1']) {
                expect(patches.get(id)).toEqual(headerPatch(UNIFORM_BORDER));
            }
        });

        it('gives row 2 (first body row, bodyRowIndex 0) bandColorA / white', () => {
            for (const id of ['A2', 'B2', 'C2', 'D2']) {
                expect(patches.get(id)).toEqual(bodyPatch('#ffffff'));
            }
        });

        it('gives row 3 (bodyRowIndex 1) bandColorB / tint', () => {
            for (const id of ['A3', 'B3', 'C3', 'D3']) {
                expect(patches.get(id)).toEqual(bodyPatch('#dbeafe'));
            }
        });

        it('gives row 4 (bodyRowIndex 2) bandColorA / white', () => {
            for (const id of ['A4', 'B4', 'C4', 'D4']) {
                expect(patches.get(id)).toEqual(bodyPatch('#ffffff'));
            }
        });

        it('returns a map whose key set is exactly the 16 cells in A1:D4', () => {
            expect(new Set(patches.keys())).toEqual(cells);
            expect(patches.size).toBe(16);
        });
    });

    describe('Scenario B — Header & Totals style over A1:D5 (uniform border)', () => {
        const style: RegularTableStyleFixture = {
            kind: 'regular',
            id: 'header-totals-blue',
            name: 'Blue Header & Totals',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            border: UNIFORM_BORDER,
            headerRow: true,
            headerColumn: true,
            totalRow: true,
        };
        const cells = rangeCells('A', 1, 'D', 5);
        const patches = computeTableStylePatches(style as any, cells);

        it('gives every cell in row 1 (header row) the header patch', () => {
            for (const id of ['A1', 'B1', 'C1', 'D1']) {
                expect(patches.get(id)).toEqual(headerPatch(UNIFORM_BORDER));
            }
        });

        it('gives every cell in row 5 (total row) the header patch, including the D5 corner', () => {
            for (const id of ['A5', 'B5', 'C5', 'D5']) {
                expect(patches.get(id)).toEqual(headerPatch(UNIFORM_BORDER));
            }
        });

        it('gives the header column (A2, A3, A4) the header patch even though they are body rows', () => {
            for (const id of ['A2', 'A3', 'A4']) {
                expect(patches.get(id)).toEqual(headerPatch(UNIFORM_BORDER));
            }
        });

        it('bands non-header-column body cells (B/C/D, rows 2-4) relative to the first body row', () => {
            expect(patches.get('B2')).toEqual(bodyPatch('#ffffff'));
            expect(patches.get('C2')).toEqual(bodyPatch('#ffffff'));
            expect(patches.get('D2')).toEqual(bodyPatch('#ffffff'));

            expect(patches.get('B3')).toEqual(bodyPatch('#dbeafe'));
            expect(patches.get('C3')).toEqual(bodyPatch('#dbeafe'));
            expect(patches.get('D3')).toEqual(bodyPatch('#dbeafe'));

            expect(patches.get('B4')).toEqual(bodyPatch('#ffffff'));
            expect(patches.get('C4')).toEqual(bodyPatch('#ffffff'));
            expect(patches.get('D4')).toEqual(bodyPatch('#ffffff'));
        });

        it('gives the A1 corner (header row and header column both apply) the header patch', () => {
            expect(patches.get('A1')).toEqual(headerPatch(UNIFORM_BORDER));
        });
    });

    describe('Edge case — single-row selection with totalRow true does not fire', () => {
        const style: RegularTableStyleFixture = {
            kind: 'regular',
            id: 'totals-only-blue',
            name: 'Blue Totals Only',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            border: UNIFORM_BORDER,
            headerRow: false,
            headerColumn: false,
            totalRow: true,
        };
        const cells = rangeCells('A', 1, 'C', 1);
        const patches = computeTableStylePatches(style as any, cells);

        it('treats all 3 cells as plain (non-header) body cells since maxR === minR', () => {
            // headerOffset is 0 (headerRow false), so bodyRowIndex = 1-1-0 = 0 -> bandColorA.
            for (const id of ['A1', 'B1', 'C1']) {
                expect(patches.get(id)).toEqual(bodyPatch('#ffffff'));
            }
        });

        it('returns exactly the 3 selected cells', () => {
            expect(new Set(patches.keys())).toEqual(cells);
        });
    });

    describe('No-border style — header/band/total patches all carry the full no-border patch', () => {
        const style: RegularTableStyleFixture = {
            kind: 'regular',
            id: 'blue-header-totals-no-border',
            name: 'Blue Header & Totals — No Border',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            border: NO_BORDER,
            headerRow: true,
            headerColumn: true,
            totalRow: true,
        };
        const cells = rangeCells('A', 1, 'D', 5);
        const patches = computeTableStylePatches(style as any, cells);

        it('every header-look cell (row 1, row 5, column A) resolves borderStyle/borderTop/borderRight/borderBottom/borderLeft to the no-border patch', () => {
            for (const id of ['A1', 'B1', 'C1', 'D1', 'A5', 'B5', 'C5', 'D5', 'A2', 'A3', 'A4']) {
                expect(patches.get(id)).toEqual(headerPatch(NO_BORDER));
                expect(patches.get(id)).toMatchObject({
                    borderStyle: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
                });
            }
        });

        it('every plain body/band cell resolves the same no-border patch', () => {
            for (const id of ['B2', 'C2', 'D2', 'B3', 'C3', 'D3', 'B4', 'C4', 'D4']) {
                expect(patches.get(id)).toMatchObject({
                    borderStyle: 'none', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
                });
            }
            expect(patches.get('B2')).toEqual(bodyPatch('#ffffff', NO_BORDER));
            expect(patches.get('B3')).toEqual(bodyPatch('#dbeafe', NO_BORDER));
            expect(patches.get('B4')).toEqual(bodyPatch('#ffffff', NO_BORDER));
        });
    });

    describe('Horizontal-only-border style — header/band/total patches all carry the full horizontal-only patch', () => {
        const style: RegularTableStyleFixture = {
            kind: 'regular',
            id: 'blue-header-totals-horizontal',
            name: 'Blue Header & Totals — Horizontal Lines',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            border: HORIZONTAL_BORDER,
            headerRow: true,
            headerColumn: true,
            totalRow: true,
        };
        const cells = rangeCells('A', 1, 'D', 5);
        const patches = computeTableStylePatches(style as any, cells);

        it('every header-look cell (row 1, row 5, column A) resolves to the horizontal-only patch', () => {
            for (const id of ['A1', 'B1', 'C1', 'D1', 'A5', 'B5', 'C5', 'D5', 'A2', 'A3', 'A4']) {
                expect(patches.get(id)).toEqual(headerPatch(HORIZONTAL_BORDER));
                expect(patches.get(id)).toMatchObject({
                    borderStyle: 'none', borderTop: 'thin', borderRight: 'none', borderBottom: 'thin', borderLeft: 'none',
                });
            }
        });

        it('every plain body/band cell resolves the same horizontal-only patch', () => {
            for (const id of ['B2', 'C2', 'D2', 'B3', 'C3', 'D3', 'B4', 'C4', 'D4']) {
                expect(patches.get(id)).toMatchObject({
                    borderStyle: 'none', borderTop: 'thin', borderRight: 'none', borderBottom: 'thin', borderLeft: 'none',
                });
            }
            expect(patches.get('B2')).toEqual(bodyPatch('#ffffff', HORIZONTAL_BORDER));
            expect(patches.get('B3')).toEqual(bodyPatch('#dbeafe', HORIZONTAL_BORDER));
            expect(patches.get('B4')).toEqual(bodyPatch('#ffffff', HORIZONTAL_BORDER));
        });
    });
});
