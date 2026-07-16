/**
 * Regression: time-of-day parsing and arithmetic in the sheets editor.
 *
 * Bug: dateStringToSerial() only recognized full calendar dates ("01/01/2026",
 * "2026-01-01"). A typed time value ("13:30", "1:30 PM") or a combined
 * date+time value ("2026-01-01 13:30") fell through to parseFloat in
 * cellScalar(), which silently read only the leading digits (parseFloat("13:30")
 * === 13), corrupting any formula that referenced the cell.
 *
 * Fix: dateStringToSerial() now also recognizes bare time strings and combined
 * date+time strings, returning an Excel serial whose fractional part is the
 * time-of-day (0.5 = 12 hours), consistent with excelSerialToDate's existing
 * fractional-serial handling.
 */

import { describe, it, expect } from 'vitest';
import { computeCell, FUNCTIONS } from '../../app/(apps)/sheets/editor/formula';
import { dateStringToSerial, formatCellValue } from '../../app/(apps)/sheets/editor/utils';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

function cell(value: string): CellProps {
    return { id: 'A1', value, raw: value, edit: false };
}

// ── dateStringToSerial — common time / date+time formats ─────────────────────

describe('dateStringToSerial — bare time strings', () => {
    it('parses 24-hour "13:30" as a 0.5625 day fraction', () => {
        expect(dateStringToSerial('13:30')).toBeCloseTo(0.5625, 10);
    });

    it('parses "13:30:00" the same as "13:30"', () => {
        expect(dateStringToSerial('13:30:00')).toBeCloseTo(0.5625, 10);
    });

    it('parses 12-hour "1:30 PM" the same as "13:30"', () => {
        expect(dateStringToSerial('1:30 PM')).toBeCloseTo(0.5625, 10);
    });

    it('parses "1:30:00 PM" with seconds', () => {
        expect(dateStringToSerial('1:30:00 PM')).toBeCloseTo(0.5625, 10);
    });

    it('parses "1:30 AM" as a small fraction', () => {
        expect(dateStringToSerial('1:30 AM')).toBeCloseTo(0.0625, 10);
    });

    it('treats 12:00 AM as midnight (fraction 0)', () => {
        expect(dateStringToSerial('12:00 AM')).toBeCloseTo(0, 10);
    });

    it('treats 12:00 PM as noon (fraction 0.5)', () => {
        expect(dateStringToSerial('12:00 PM')).toBeCloseTo(0.5, 10);
    });

    it('accepts a time with no space before AM/PM', () => {
        expect(dateStringToSerial('1:30PM')).toBeCloseTo(0.5625, 10);
    });

    it('rejects an out-of-range hour (25:00)', () => {
        expect(dateStringToSerial('25:00')).toBeNull();
    });

    it('rejects an out-of-range 24-hour value (24:00)', () => {
        expect(dateStringToSerial('24:00')).toBeNull();
    });

    it('rejects an out-of-range minute (13:60)', () => {
        expect(dateStringToSerial('13:60')).toBeNull();
    });

    it('rejects a malformed meridiem ("13:30 XM")', () => {
        expect(dateStringToSerial('13:30 XM')).toBeNull();
    });
});

describe('dateStringToSerial — combined date + time strings', () => {
    it('parses ISO date + 24-hour time ("2026-01-15 09:05")', () => {
        const dateOnly = dateStringToSerial('2026-01-15')!;
        const combined = dateStringToSerial('2026-01-15 09:05')!;
        expect(combined - dateOnly).toBeCloseTo(9 / 24 + 5 / 1440, 10);
    });

    it('parses US date + 12-hour time ("01/15/2026 9:05 AM")', () => {
        expect(dateStringToSerial('01/15/2026 9:05 AM')).toBeCloseTo(dateStringToSerial('2026-01-15 09:05')!, 10);
    });

    it('parses ISO "T" separator without a timezone suffix ("2026-01-15T09:05:00")', () => {
        expect(dateStringToSerial('2026-01-15T09:05:00')).toBeCloseTo(dateStringToSerial('2026-01-15 09:05')!, 10);
    });

    it('still rejects a bare fraction like "3/4" (no year, not a date)', () => {
        expect(dateStringToSerial('3/4')).toBeNull();
    });

    it('still rejects an overflow calendar date (02/30/2026)', () => {
        expect(dateStringToSerial('02/30/2026')).toBeNull();
    });
});

// ── Formula arithmetic on typed time/datetime values ──────────────────────────

describe('formula arithmetic — adding 0.5 to a time adds 12 hours', () => {
    it('=A1+0.5 on a bare time shifts it by exactly 12 hours', () => {
        const data = new Map<string, CellProps>([['A1', cell('13:30')]]);
        const { value } = computeCell('=A1+0.5', data);
        expect(parseFloat(value)).toBeCloseTo(0.5625 + 0.5, 10);
        expect(formatCellValue(value, { numberFormat: 'time' })).toMatch(/1:30:00[\s ]AM/);
    });

    it('=A1+0.5 on a combined date+time rolls into the next day at the new time', () => {
        const data = new Map<string, CellProps>([['A1', cell('2026-01-01 13:30')]]);
        const { value } = computeCell('=A1+0.5', data);
        const result = formatCellValue(value, { numberFormat: 'datetime' });
        expect(result).toMatch(/1\/2\/2026/);
        expect(result).toMatch(/1:30:00[\s ]AM/);
    });

    it('=A1+1 on a combined date+time preserves the time of day', () => {
        const data = new Map<string, CellProps>([['A1', cell('2026-01-01 13:30')]]);
        const { value } = computeCell('=A1+1', data);
        const result = formatCellValue(value, { numberFormat: 'datetime' });
        expect(result).toMatch(/1\/2\/2026/);
        expect(result).toMatch(/1:30:00[\s ]PM/);
    });
});

// ── DATEADD / TIMEADD formula functions ───────────────────────────────────────

describe('DATEADD(date, days, [months], [years])', () => {
    it('is registered in the function list', () => {
        expect(FUNCTIONS).toContain('DATEADD');
    });

    it('adds days', () => {
        expect(computeCell('=DATEADD("2026-01-01", 10)', new Map()).value).toBe('2026-01-11');
    });

    it('adds negative days across a year boundary', () => {
        expect(computeCell('=DATEADD("2026-01-01", -1)', new Map()).value).toBe('2025-12-31');
    });

    it('adds months', () => {
        expect(computeCell('=DATEADD("2026-01-01", 0, 1)', new Map()).value).toBe('2026-02-01');
    });

    it('adds years', () => {
        expect(computeCell('=DATEADD("2026-01-01", 0, 0, 1)', new Map()).value).toBe('2027-01-01');
    });

    it('normalizes month-end overflow (Jan 31 + 1 month)', () => {
        // Feb 2026 has 28 days, so day 31 rolls into March.
        expect(computeCell('=DATEADD("2026-01-31", 0, 1)', new Map()).value).toBe('2026-03-03');
    });

    it('reads the date from a cell reference', () => {
        const data = new Map<string, CellProps>([['A1', cell('2026-01-01')]]);
        expect(computeCell('=DATEADD(A1, 5)', data).value).toBe('2026-01-06');
    });
});

describe('TIMEADD(time, seconds, minutes, hours)', () => {
    it('is registered in the function list', () => {
        expect(FUNCTIONS).toContain('TIMEADD');
    });

    it('adds hours', () => {
        expect(computeCell('=TIMEADD("13:30:00", 0, 0, 1)', new Map()).value).toBe('14:30:00');
    });

    it('adds seconds', () => {
        expect(computeCell('=TIMEADD("13:30:00", 30, 0, 0)', new Map()).value).toBe('13:30:30');
    });

    it('wraps past midnight (23:30 + 60 minutes)', () => {
        expect(computeCell('=TIMEADD("23:30:00", 0, 60, 0)', new Map()).value).toBe('00:30:00');
    });

    it('adding 12 hours flips AM/PM, matching the +0.5 serial rule', () => {
        expect(computeCell('=TIMEADD("13:30:00", 0, 0, 12)', new Map()).value).toBe('01:30:00');
    });

    it('drops the date part when given a full date+time value', () => {
        const data = new Map<string, CellProps>([['A1', cell('2026-01-01 13:30:00')]]);
        expect(computeCell('=TIMEADD(A1, 0, 0, 12)', data).value).toBe('01:30:00');
    });
});
