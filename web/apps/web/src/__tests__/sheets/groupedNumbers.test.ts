/**
 * Numbers entered with thousands separators (issue #305, "-2,373.14" showing as -2).
 * The cell keeps what was entered; its value is the plain number every reader needs.
 */

import { describe, it, expect } from 'vitest';
import { formatCellValue, groupedNumberValue } from '../../app/(apps)/sheets/editor/utils';
import { computeCell } from '../../app/(apps)/sheets/editor/formula';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

const cell = (id: string, raw: string): [string, CellProps] => [id, { id, raw, value: computeCell(raw, new Map()).value, edit: false }];

describe('groupedNumberValue', () => {
    it.each([
        ['-2,373.14', '-2373.14'],
        ['2,373', '2373'],
        ['1,234,567.5', '1234567.5'],
        ['+1,000', '1000'],
        ['  1,000\r', '1000'],
    ])('reads %j as %s', (text, expected) => {
        expect(groupedNumberValue(text)).toBe(expected);
    });

    it.each(['1,2', '12,34', '1,2,3', '1234,567', '1,000,00', 'a,bcd', '$1,000', '1,000 units', '', '2373.14'])(
        'leaves %j alone',
        text => { expect(groupedNumberValue(text)).toBeNull(); },
    );
});

describe('a cell holding a grouped number', () => {
    it('has the plain number as its value', () => {
        expect(computeCell('-2,373.14', new Map()).value).toBe('-2373.14');
    });

    it('shows what was entered when unformatted', () => {
        expect(formatCellValue('-2373.14', undefined, '-2,373.14')).toBe('-2,373.14');
    });

    it('shows the whole number through a number format', () => {
        expect(formatCellValue('-2373.14', { numberFormat: 'number', decimalPlaces: 2 }, '-2,373.14')).toBe('-2,373.14');
        expect(formatCellValue('-2373.14', { numberFormat: 'number' }, '-2,373.14')).toBe('-2,373');
        expect(formatCellValue('-2373.14', { customFormat: '0.00' }, '-2,373.14')).toBe('-2373.14');
    });

    it('sums and does arithmetic as the whole number', () => {
        const data = new Map([cell('A1', '-2,373.14'), cell('A2', '1,000')]);
        expect(parseFloat(computeCell('=SUM(A1:A2)', data).value)).toBeCloseTo(-1373.14);
        expect(parseFloat(computeCell('=A1*2', data).value)).toBeCloseTo(-4746.28);
    });

    it('does not touch text that is not a number', () => {
        expect(computeCell('1,2', new Map()).value).toBe('1,2');
    });
});
