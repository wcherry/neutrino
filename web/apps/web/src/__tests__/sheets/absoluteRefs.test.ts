/**
 * Unit tests for absolute cell reference ($) support in encodeFormula / decodeFormula
 * and the formula tokenizer / evaluator.
 *
 * These tests are written BEFORE the implementation (TDD red phase) and will
 * fail until the feature is implemented.
 */

import { describe, it, expect } from 'vitest';
import { encodeFormula, decodeFormula, parseDeps } from '../../app/(apps)/sheets/editor/utils';
import { computeCell } from '../../app/(apps)/sheets/editor/formula';

// ── encodeFormula ────────────────────────────────────────────────────────────

describe('encodeFormula — absolute refs', () => {
    it('encodes $A$1 with both dimensions absolute', () => {
        // Cell at row=1, col=1; formula references $A$1
        const encoded = encodeFormula('=$A$1', 1, 1);
        // Column absolute -> [$A], row absolute -> [$1]
        expect(encoded).toBe('=[$A][$1]');
    });

    it('encodes A$1 with row absolute and column relative', () => {
        // Cell at row=2, col=2 (B2); formula =$A$1 references col A (delta=-1) row fixed 1
        // formula =A$1 references col A (delta=-1 from B) row fixed at 1
        const encoded = encodeFormula('=A$1', 2, 2);
        // Column A from col 2 = delta -1; row is absolute $1
        expect(encoded).toBe('=[-1][$1]');
    });

    it('encodes $A1 with column absolute and row relative', () => {
        // Cell at row=3, col=3 (C3); formula =$A1 references col A (absolute), row 1 (delta=-2)
        const encoded = encodeFormula('=$A1', 3, 3);
        // Column absolute A; row delta = 1 - 3 = -2
        expect(encoded).toBe('=[$A][-2]');
    });

    it('encodes relative ref A1 unchanged (no $ prefix)', () => {
        const encoded = encodeFormula('=A1', 2, 2);
        // col delta = 1-2 = -1; row delta = 1-2 = -1
        expect(encoded).toBe('=[-1][-1]');
    });

    it('encodes mixed refs inside a range: A$1:B3', () => {
        // Cell at C2 (row=2, col=3)
        const encoded = encodeFormula('=SUM(A$1:B3)', 2, 3);
        // A from col 3: delta = 1-3 = -2; $1 absolute
        // B from col 3: delta = 2-3 = -1; 3 from row 2: delta = 3-2 = 1
        expect(encoded).toBe('=SUM([-2][$1]:[-1][1])');
    });

    it('preserves $ on cross-sheet ref Beta!$A$1', () => {
        const encoded = encodeFormula('=Beta!$A$1', 2, 2);
        // Cross-sheet ref: Beta! prefix stays, then [$A][$1]
        expect(encoded).toBe('=Beta![$A][$1]');
    });
});

// ── decodeFormula ────────────────────────────────────────────────────────────

describe('decodeFormula — absolute refs', () => {
    it('decodes [$A][$1] back to $A$1', () => {
        const decoded = decodeFormula('=[$A][$1]', 5, 5);
        expect(decoded).toBe('=$A$1');
    });

    it('decodes [-1][$1] back to A$1 when pasting to C2', () => {
        // Target C2: col=3, row=2; column delta=-1 → col 2 = B; row absolute $1
        const decoded = decodeFormula('=[-1][$1]', 2, 3);
        expect(decoded).toBe('=B$1');
    });

    it('decodes [$A][-2] back to $A1 when pasting to C3', () => {
        // Target C3: col=3, row=3; col absolute A; row delta=-2 → 3+(-2)=1
        const decoded = decodeFormula('=[$A][-2]', 3, 3);
        expect(decoded).toBe('=$A1');
    });

    it('decodes relative ref [-1][-1] back to A1 when pasting at B2', () => {
        const decoded = decodeFormula('=[-1][-1]', 2, 2);
        expect(decoded).toBe('=A1');
    });

    it('decodes mixed range SUM([-2][$1]:[-1][1]) when pasting to D3', () => {
        // Target D3: col=4, row=3
        // [-2] → col 4-2=2 → B; [$1] → $1
        // [-1] → col 4-1=3 → C; [1] → row 3+1=4
        const decoded = decodeFormula('=SUM([-2][$1]:[-1][1])', 3, 4);
        expect(decoded).toBe('=SUM(B$1:C4)');
    });

    it('decodes cross-sheet =Beta![$A][$1] back to =Beta!$A$1', () => {
        const decoded = decodeFormula('=Beta![$A][$1]', 5, 5);
        expect(decoded).toBe('=Beta!$A$1');
    });

    it('decodes $A1 row adjustment: [$A][-1] when pasted to B2 → $A1', () => {
        // Target row=2, col=2; row delta=-1 → 2+(-1)=1
        const decoded = decodeFormula('=[$A][-1]', 2, 2);
        expect(decoded).toBe('=$A1');
    });

    it('decodes $A1 row adjustment: [$A][0] when pasted to B2 → $A2', () => {
        // Target row=2, col=2; row delta=0 → 2
        const decoded = decodeFormula('=[$A][0]', 2, 2);
        expect(decoded).toBe('=$A2');
    });
});

// ── Round-trip: encode then decode ───────────────────────────────────────────

describe('encodeFormula + decodeFormula round-trip', () => {
    function roundTrip(
        formula: string,
        srcRow: number,
        srcCol: number,
        destRow: number,
        destCol: number,
    ): string {
        const encoded = encodeFormula(formula, srcRow, srcCol);
        return decodeFormula(encoded, destRow, destCol);
    }

    it('$A$1 copied to any cell always produces $A$1', () => {
        expect(roundTrip('=$A$1', 1, 1, 5, 5)).toBe('=$A$1');
        expect(roundTrip('=$A$1', 3, 3, 1, 1)).toBe('=$A$1');
        expect(roundTrip('=$A$1', 2, 2, 10, 10)).toBe('=$A$1');
    });

    it('A$1 copied down preserves row 1', () => {
        // Source at B2, dest at B3 (one row down, same col)
        expect(roundTrip('=A$1', 2, 2, 3, 2)).toBe('=A$1');
    });

    it('A$1 copied right adjusts column', () => {
        // Source at B2, dest at C2 (same row, one col right)
        expect(roundTrip('=A$1', 2, 2, 2, 3)).toBe('=B$1');
    });

    it('$A1 copied right preserves column A', () => {
        // Source at B2, dest at C2
        expect(roundTrip('=$A1', 2, 2, 2, 3)).toBe('=$A1');
    });

    it('$A1 copied down adjusts row', () => {
        // Source at B1, dest at B2
        expect(roundTrip('=$A1', 1, 2, 2, 2)).toBe('=$A2');
    });

    it('relative ref adjusts both dimensions', () => {
        // Source at B2 references A1 (offset -1,-1). Pasted at C3 → B2.
        expect(roundTrip('=A1', 2, 2, 3, 3)).toBe('=B2');
        // Source at B2 references B2 (offset 0,0). Pasted at D4 → D4.
        expect(roundTrip('=B2', 2, 2, 4, 4)).toBe('=D4');
    });

    it('SUM(A$1:B3) copied down: A$1 stays, B3 adjusts', () => {
        // Source at C3, dest at C4
        expect(roundTrip('=SUM(A$1:B3)', 3, 3, 4, 3)).toBe('=SUM(A$1:B4)');
    });

    it('cross-sheet =Beta!$A$1 stays fixed anywhere', () => {
        expect(roundTrip('=Beta!$A$1', 2, 2, 10, 10)).toBe('=Beta!$A$1');
        expect(roundTrip('=Beta!$A$1', 1, 1, 5, 8)).toBe('=Beta!$A$1');
    });
});

// ── parseDeps strips $ markers ───────────────────────────────────────────────

describe('parseDeps — strips $ from absolute refs', () => {
    it('extracts A1 from =$A$1', () => {
        const deps = parseDeps('=$A$1');
        expect(deps).toContain('A1');
        expect(deps).not.toContain('$A$1');
    });

    it('extracts A1 from =A$1', () => {
        const deps = parseDeps('=A$1');
        expect(deps).toContain('A1');
    });

    it('extracts A1 from =$A1', () => {
        const deps = parseDeps('=$A1');
        expect(deps).toContain('A1');
    });

    it('extracts range cells from =SUM(A$1:B3)', () => {
        const deps = parseDeps('=SUM(A$1:B3)');
        expect(deps).toContain('A1');
        expect(deps).toContain('B3');
        expect(deps).toContain('B1');
        expect(deps).toContain('A3');
    });
});

// ── computeCell evaluates absolute refs correctly ────────────────────────────

describe('computeCell — evaluates absolute ref formulas', () => {
    function makeData(entries: [string, string][]): Map<string, { id: string; value: string; raw: string; edit: boolean }> {
        return new Map(entries.map(([id, value]) => [id, { id, value, raw: value, edit: false }]));
    }

    it('=$A$1 resolves to the value of A1', () => {
        const data = makeData([['A1', '42']]);
        const { value } = computeCell('=$A$1', data);
        expect(value).toBe('42');
    });

    it('=A$1 resolves to the value of A1', () => {
        const data = makeData([['A1', '99']]);
        const { value } = computeCell('=A$1', data);
        expect(value).toBe('99');
    });

    it('=$A1 resolves to the value of A1', () => {
        const data = makeData([['A1', '77']]);
        const { value } = computeCell('=$A1', data);
        expect(value).toBe('77');
    });

    it('=SUM(A$1:B$2) sums the range A1:B2', () => {
        const data = makeData([
            ['A1', '1'],
            ['A2', '2'],
            ['B1', '3'],
            ['B2', '4'],
        ]);
        const { value } = computeCell('=SUM(A$1:B$2)', data);
        expect(value).toBe('10');
    });

    it('=$A$1+$B$2 adds two absolute refs', () => {
        const data = makeData([['A1', '10'], ['B2', '5']]);
        const { value } = computeCell('=$A$1+$B$2', data);
        expect(value).toBe('15');
    });

    it('=Beta!$A$1 resolves an absolute cross-sheet ref', () => {
        const active = makeData([]);
        const beta = makeData([['A1', '123']]);
        const { value } = computeCell('=Beta!$A$1', active, [{ name: 'Beta', data: beta }]);
        expect(value).toBe('123');
    });
});
