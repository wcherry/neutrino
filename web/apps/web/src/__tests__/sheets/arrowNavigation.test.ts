/**
 * Unit tests for arrow-key cell navigation logic in the sheets editor.
 *
 * These tests cover:
 * - The coordinate computation (alphaToNum / numToAlpha / clamping)
 * - The navigation helper that computes the next cell ID given a direction
 */

import { describe, it, expect } from 'vitest';
import { navigateCell, numToAlpha } from '../../app/(apps)/sheets/editor/utils';
import { MAX_ROWS, MAX_COLS } from '../../app/(apps)/sheets/editor/constants';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

// ── Basic directional movement ────────────────────────────────────────────────

describe('navigateCell — basic movement', () => {
    it('ArrowDown moves from A1 to A2', () => {
        expect(navigateCell('A1', 'ArrowDown')).toBe('A2');
    });

    it('ArrowUp moves from A2 to A1', () => {
        expect(navigateCell('A2', 'ArrowUp')).toBe('A1');
    });

    it('ArrowRight moves from A1 to B1', () => {
        expect(navigateCell('A1', 'ArrowRight')).toBe('B1');
    });

    it('ArrowLeft moves from B1 to A1', () => {
        expect(navigateCell('B1', 'ArrowLeft')).toBe('A1');
    });

    it('moves diagonally via two steps', () => {
        const after1 = navigateCell('B3', 'ArrowDown');
        const after2 = navigateCell(after1, 'ArrowRight');
        expect(after2).toBe('C4');
    });

    it('works with multi-letter column (Z → AA via ArrowRight)', () => {
        // Z = col 26; AA = col 27
        expect(navigateCell('Z1', 'ArrowRight')).toBe('AA1');
    });

    it('works moving left from AA to Z', () => {
        expect(navigateCell('AA1', 'ArrowLeft')).toBe('Z1');
    });
});

// ── Boundary clamping ──────────────────────────────────────────────────────────

describe('navigateCell — boundary clamping', () => {
    it('ArrowUp at row 1 stays at row 1', () => {
        expect(navigateCell('A1', 'ArrowUp')).toBe('A1');
        expect(navigateCell('C1', 'ArrowUp')).toBe('C1');
    });

    it('ArrowLeft at column A stays at column A', () => {
        expect(navigateCell('A1', 'ArrowLeft')).toBe('A1');
        expect(navigateCell('A5', 'ArrowLeft')).toBe('A5');
    });

    it('ArrowDown at MAX_ROWS stays at MAX_ROWS', () => {
        const lastRow = `A${MAX_ROWS}`;
        expect(navigateCell(lastRow, 'ArrowDown')).toBe(lastRow);
    });

    it('ArrowRight at MAX_COLS stays at MAX_COLS', () => {
        const lastCol = numToAlpha(MAX_COLS);
        const lastCell = `${lastCol}1`;
        expect(navigateCell(lastCell, 'ArrowRight')).toBe(lastCell);
    });
});

// ── Ctrl jumps to populated bounds ────────────────────────────────────────────

describe('navigateCell — Ctrl movement', () => {
    const data = new Map<string, CellProps>([
        ['B2', { id: 'B2', raw: 'left', value: 'left', edit: false }],
        ['E2', { id: 'E2', raw: 'right', value: 'right', edit: false }],
        ['C4', { id: 'C4', raw: 'top', value: 'top', edit: false }],
        ['C9', { id: 'C9', raw: 'bottom', value: 'bottom', edit: false }],
        ['G2', { id: 'G2', raw: '', value: '', edit: false }],
    ]);

    it('Ctrl+Right moves to the last populated column in the row', () => {
        expect(navigateCell('C2', 'ArrowRight', { ctrlKey: true, data })).toBe('E2');
    });

    it('Ctrl+Left moves to the first populated column in the row', () => {
        expect(navigateCell('D2', 'ArrowLeft', { ctrlKey: true, data })).toBe('B2');
    });

    it('Ctrl+Down moves to the last populated row in the column', () => {
        expect(navigateCell('C5', 'ArrowDown', { ctrlKey: true, data })).toBe('C9');
    });

    it('Ctrl+Up moves to the first populated row in the column', () => {
        expect(navigateCell('C8', 'ArrowUp', { ctrlKey: true, data })).toBe('C4');
    });

    it('Ctrl movement stays put when the row or column has no populated data', () => {
        expect(navigateCell('A10', 'ArrowRight', { ctrlKey: true, data })).toBe('A10');
    });
});

// ── Merged cell navigation ─────────────────────────────────────────────────────

describe('navigateCell — merged cells', () => {
    // A1:C1 merged horizontally (colSpan=3); B1 and C1 are slaves.
    const hMerge = new Map<string, CellProps>([
        ['A1', { id: 'A1', raw: '', value: '', edit: false, colSpan: 3 }],
        ['B1', { id: 'B1', raw: '', value: '', edit: false, mergeAnchor: 'A1' }],
        ['C1', { id: 'C1', raw: '', value: '', edit: false, mergeAnchor: 'A1' }],
    ]);

    it('ArrowRight from merge anchor jumps past the merged columns', () => {
        expect(navigateCell('A1', 'ArrowRight', { data: hMerge })).toBe('D1');
    });

    it('ArrowLeft into a merged slave resolves to the anchor', () => {
        expect(navigateCell('D1', 'ArrowLeft', { data: hMerge })).toBe('A1');
    });

    it('ArrowLeft from the anchor exits to the left normally', () => {
        // Z1 is not in the map, so no mergeAnchor redirection expected
        expect(navigateCell('A1', 'ArrowLeft', { data: hMerge })).toBe('A1'); // clamped at col 1
    });

    // A1:A3 merged vertically (rowSpan=3); A2 and A3 are slaves.
    const vMerge = new Map<string, CellProps>([
        ['A1', { id: 'A1', raw: '', value: '', edit: false, rowSpan: 3 }],
        ['A2', { id: 'A2', raw: '', value: '', edit: false, mergeAnchor: 'A1' }],
        ['A3', { id: 'A3', raw: '', value: '', edit: false, mergeAnchor: 'A1' }],
    ]);

    it('ArrowDown from merge anchor jumps past the merged rows', () => {
        expect(navigateCell('A1', 'ArrowDown', { data: vMerge })).toBe('A4');
    });

    it('ArrowUp into a merged slave resolves to the anchor', () => {
        expect(navigateCell('A4', 'ArrowUp', { data: vMerge })).toBe('A1');
    });

    // B2:D4 merged (colSpan=3, rowSpan=3); interior cells have mergeAnchor='B2'.
    const blockMerge = new Map<string, CellProps>([
        ['B2', { id: 'B2', raw: '', value: '', edit: false, colSpan: 3, rowSpan: 3 }],
        ['C2', { id: 'C2', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
        ['D2', { id: 'D2', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
        ['B3', { id: 'B3', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
        ['C3', { id: 'C3', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
        ['D3', { id: 'D3', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
        ['B4', { id: 'B4', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
        ['C4', { id: 'C4', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
        ['D4', { id: 'D4', raw: '', value: '', edit: false, mergeAnchor: 'B2' }],
    ]);

    it('ArrowRight from block merge anchor jumps past the merged columns', () => {
        expect(navigateCell('B2', 'ArrowRight', { data: blockMerge })).toBe('E2');
    });

    it('ArrowDown from block merge anchor jumps past the merged rows', () => {
        expect(navigateCell('B2', 'ArrowDown', { data: blockMerge })).toBe('B5');
    });

    it('ArrowLeft into block merge slave resolves to anchor', () => {
        expect(navigateCell('E2', 'ArrowLeft', { data: blockMerge })).toBe('B2');
    });

    it('ArrowUp into block merge slave resolves to anchor', () => {
        expect(navigateCell('B5', 'ArrowUp', { data: blockMerge })).toBe('B2');
    });

    it('ArrowRight into a merge anchor (not a slave) lands on the anchor normally', () => {
        // Navigating into B2 itself, which is the anchor — no mergeAnchor field, so stays B2
        expect(navigateCell('A2', 'ArrowRight', { data: blockMerge })).toBe('B2');
    });
});

// ── Cell ID parsing robustness ─────────────────────────────────────────────────

describe('navigateCell — ID parsing', () => {
    it('handles single-digit row', () => {
        expect(navigateCell('B5', 'ArrowUp')).toBe('B4');
    });

    it('handles large row numbers', () => {
        expect(navigateCell('A1000', 'ArrowDown')).toBe('A1001');
        expect(navigateCell('A1000', 'ArrowUp')).toBe('A999');
    });

    it('returns the original ID unchanged if it does not match the cell ID pattern', () => {
        expect(navigateCell('invalid', 'ArrowDown')).toBe('invalid');
    });
});
