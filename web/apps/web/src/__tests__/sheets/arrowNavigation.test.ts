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
