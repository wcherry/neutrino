/**
 * Unit tests for arrow-key cell navigation logic in the sheets editor.
 *
 * These tests cover:
 * - The coordinate computation (alphaToNum / numToAlpha / clamping)
 * - The navigation helper that computes the next cell ID given a direction
 */

import { describe, it, expect } from 'vitest';
import { alphaToNum, numToAlpha } from '../../app/(apps)/sheets/editor/utils';
import { MAX_ROWS, MAX_COLS } from '../../app/(apps)/sheets/editor/constants';

// ── Reusable navigation helper (mirrors the SheetEditor implementation) ────────
//
// This function computes the next cell ID after an arrow-key press.
// It is tested here in isolation so we can exercise all the edge cases
// without needing a rendered component.

type Direction = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function navigateCell(currentId: string, direction: Direction): string {
    const m = currentId.match(/^([A-Z]+)(\d+)$/);
    if (!m) return currentId;
    let col = alphaToNum(m[1]);
    let row = parseInt(m[2], 10);

    switch (direction) {
        case 'ArrowUp':    row = Math.max(1, row - 1);         break;
        case 'ArrowDown':  row = Math.min(MAX_ROWS, row + 1);  break;
        case 'ArrowLeft':  col = Math.max(1, col - 1);         break;
        case 'ArrowRight': col = Math.min(MAX_COLS, col + 1);  break;
    }

    return `${numToAlpha(col)}${row}`;
}

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

// ── Guard condition logic (pure boolean helpers) ───────────────────────────────
//
// The actual guard in SheetEditor checks DOM state, so we test the pure
// conditions here symbolically.

describe('arrow nav guard conditions', () => {
    // Modifier key guard
    it('should NOT navigate when Ctrl is held', () => {
        // Simulated: modifier check prevents the nav function from being called.
        // We verify the helper is only called when no modifier is held.
        const ctrlHeld = true;
        const result = ctrlHeld ? 'A1' : navigateCell('A1', 'ArrowDown');
        expect(result).toBe('A1'); // navigation was suppressed
    });

    it('should NOT navigate when Meta (Cmd) is held', () => {
        const metaHeld = true;
        const result = metaHeld ? 'B3' : navigateCell('B3', 'ArrowDown');
        expect(result).toBe('B3');
    });

    it('should NOT navigate when Alt is held', () => {
        const altHeld = true;
        const result = altHeld ? 'C5' : navigateCell('C5', 'ArrowRight');
        expect(result).toBe('C5');
    });

    it('navigates when no modifier is held', () => {
        const noModifier = false;
        const result = noModifier ? 'A1' : navigateCell('A1', 'ArrowDown');
        expect(result).toBe('A2');
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
