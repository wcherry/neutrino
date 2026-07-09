/**
 * Regression: date arithmetic in formulas.
 *
 * A cell holding a typed date string ("01/01/2026") must be treated as its Excel
 * serial in formulas, so =A1+1 yields the next day. Previously parseFloat read
 * "01/01/2026" as 1, so A1+1 was 2 → rendered as 01/02/1900.
 */

import { describe, it, expect } from 'vitest';
import { computeCell } from '../../app/(apps)/sheets/editor/formula';
import { formatCellValue } from '../../app/(apps)/sheets/editor/utils';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

function cell(value: string): CellProps {
    return { id: 'A1', value, raw: value, edit: false };
}

describe('date arithmetic in formulas', () => {
    it('=A1+1 on a US date string yields the next day serial (46023 → 46024)', () => {
        const data = new Map<string, CellProps>([['A1', cell('01/01/2026')]]);
        const { value } = computeCell('=A1+1', data);
        expect(value).toBe('46024');
        // Rendered through a date format, this is 01/02/2026 — not 01/02/1900.
        expect(formatCellValue(value, { numberFormat: 'date' })).toBe('1/2/2026');
    });

    it('=A1+1 on an ISO date string yields the next day', () => {
        const data = new Map<string, CellProps>([['A1', cell('2026-01-01')]]);
        const { value } = computeCell('=A1+1', data);
        expect(formatCellValue(value, { numberFormat: 'date' })).toBe('1/2/2026');
    });

    it('=B1-A1 gives the day difference between two dates', () => {
        const data = new Map<string, CellProps>([
            ['A1', { id: 'A1', value: '01/01/2026', raw: '01/01/2026', edit: false }],
            ['B1', { id: 'B1', value: '01/10/2026', raw: '01/10/2026', edit: false }],
        ]);
        expect(computeCell('=B1-A1', data).value).toBe('9');
    });

    it('leaves plain numbers untouched (=A1+1 where A1 is 41)', () => {
        const data = new Map<string, CellProps>([['A1', cell('41')]]);
        expect(computeCell('=A1+1', data).value).toBe('42');
    });

    it('does not treat a bare fraction like 3/4 as a date', () => {
        const data = new Map<string, CellProps>([['A1', cell('3/4')]]);
        // "3/4" has no year → not a date; parseFloat reads it as 3.
        expect(computeCell('=A1+1', data).value).toBe('4');
    });

    it('rejects overflow dates (02/30/2026) and keeps them as text', () => {
        const data = new Map<string, CellProps>([['A1', cell('02/30/2026')]]);
        // Not a valid calendar date → parseFloat("02/30/2026") = 2 → +1 = 3.
        expect(computeCell('=A1+1', data).value).toBe('3');
    });
});
