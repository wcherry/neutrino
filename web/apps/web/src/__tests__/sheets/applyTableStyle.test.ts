/**
 * Unit tests for computeTableStylePatches (TDD red phase — module does not
 * exist yet).
 *
 * `editor/styles/applyTableStyle.ts` exports a pure
 * `computeTableStylePatches(style, cells: Set<string>): Map<string, Partial<CellStyle>>`
 * that computes a per-cell style patch for a table-style application over an
 * arbitrary selection. Algorithm (pinned exactly, see the plan doc):
 *
 * 1. Parse every cell id into col/row; compute minC/minR/maxC/maxR over the
 *    given `cells` set.
 * 2. Body patch per cell: `{ borderStyle, fontWeight: 'normal', color:
 *    undefined, backgroundColor }`, where banding parity is relative to the
 *    first body row: `headerOffset = style.headerRow ? 1 : 0`,
 *    `bodyRowIndex = row - minR - headerOffset`, `backgroundColor =
 *    bodyRowIndex % 2 === 0 ? style.bandColorA : style.bandColorB`.
 * 3. Overrides applied in order (later wins): headerColumn (col === minC),
 *    headerRow (row === minR), totalRow (row === maxR && maxR > minR) — each
 *    replaces the cell's patch with the "header look":
 *    `{ backgroundColor: style.header.backgroundColor, color:
 *    style.header.color, fontWeight: 'bold', borderStyle: style.borderStyle }`.
 * 4. Returns a patch for every cell in the input set.
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * ("Continuation: Table styles gallery (28 presets)") for the full spec.
 */

import { describe, it, expect } from 'vitest';
import { computeTableStylePatches } from '../../app/(apps)/sheets/editor/styles/applyTableStyle';
import type { TableStyle } from '../../app/(apps)/sheets/editor/styles/tableStyles';
import type { CellStyle } from '../../app/(apps)/sheets/editor/types';

const HEADER_PATCH: Partial<CellStyle> = {
    backgroundColor: '#1e40af',
    color: '#ffffff',
    fontWeight: 'bold',
    borderStyle: 'thin',
};

function bodyPatch(backgroundColor: string): Partial<CellStyle> {
    return {
        borderStyle: 'thin',
        fontWeight: 'normal',
        color: undefined,
        backgroundColor,
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
    describe('Scenario A — Banded style over A1:D4', () => {
        const style: TableStyle = {
            id: 'banded-blue',
            name: 'Blue Banded',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            borderStyle: 'thin',
            headerRow: true,
            headerColumn: false,
            totalRow: false,
        };
        const cells = rangeCells('A', 1, 'D', 4);
        const patches = computeTableStylePatches(style, cells);

        it('gives every cell in row 1 (header row) the header patch', () => {
            for (const id of ['A1', 'B1', 'C1', 'D1']) {
                expect(patches.get(id)).toEqual(HEADER_PATCH);
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

    describe('Scenario B — Header & Totals style over A1:D5', () => {
        const style: TableStyle = {
            id: 'header-totals-blue',
            name: 'Blue Header & Totals',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            borderStyle: 'thin',
            headerRow: true,
            headerColumn: true,
            totalRow: true,
        };
        const cells = rangeCells('A', 1, 'D', 5);
        const patches = computeTableStylePatches(style, cells);

        it('gives every cell in row 1 (header row) the header patch', () => {
            for (const id of ['A1', 'B1', 'C1', 'D1']) {
                expect(patches.get(id)).toEqual(HEADER_PATCH);
            }
        });

        it('gives every cell in row 5 (total row) the header patch, including the D5 corner', () => {
            for (const id of ['A5', 'B5', 'C5', 'D5']) {
                expect(patches.get(id)).toEqual(HEADER_PATCH);
            }
        });

        it('gives the header column (A2, A3, A4) the header patch even though they are body rows', () => {
            for (const id of ['A2', 'A3', 'A4']) {
                expect(patches.get(id)).toEqual(HEADER_PATCH);
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
            expect(patches.get('A1')).toEqual(HEADER_PATCH);
        });
    });

    describe('Edge case — single-row selection with totalRow true does not fire', () => {
        const style: TableStyle = {
            id: 'totals-only-blue',
            name: 'Blue Totals Only',
            header: { backgroundColor: '#1e40af', color: '#ffffff' },
            bandColorA: '#ffffff',
            bandColorB: '#dbeafe',
            borderStyle: 'thin',
            headerRow: false,
            headerColumn: false,
            totalRow: true,
        };
        const cells = rangeCells('A', 1, 'C', 1);
        const patches = computeTableStylePatches(style, cells);

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
});
