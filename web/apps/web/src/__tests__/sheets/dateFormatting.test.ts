/**
 * Tests for Excel serial-date formatting in the sheets editor.
 *
 * excelSerialToDate() produces a UTC-midnight Date. All date field extraction
 * must use UTC getters (getUTCFullYear, getUTCDay, etc.) so that the displayed
 * day-of-week and date components are timezone-independent.
 *
 * Regression: serial 45782 (Monday 2025-05-05) was shown as Sunday in any
 * timezone behind UTC because getDay() returned the local-time day.
 */

import { describe, it, expect } from 'vitest';
import { applyCustomFormat, formatCellValue } from '../../app/(apps)/sheets/editor/utils';

// ── Day-of-week (DDDD / DDD) ──────────────────────────────────────────────────

describe('applyCustomFormat — DDDD day-of-week is timezone-independent', () => {
    // 45782 = Monday 2025-05-05 (UTC midnight).  In any UTC- timezone the local
    // time is still Sunday the 4th, which triggered the bug.
    it('serial 45782 formats as Monday with DDDD', () => {
        expect(applyCustomFormat('45782', 'DDDD')).toBe('Monday');
    });

    it('serial 45782 formats as Mon with DDD', () => {
        expect(applyCustomFormat('45782', 'DDD')).toBe('Mon');
    });

    // 45783 = Tuesday 2025-05-06
    it('serial 45783 formats as Tuesday with DDDD', () => {
        expect(applyCustomFormat('45783', 'DDDD')).toBe('Tuesday');
    });

    // 45786 = Friday 2025-05-09
    it('serial 45786 formats as Friday with DDDD', () => {
        expect(applyCustomFormat('45786', 'DDDD')).toBe('Friday');
    });

    // 45787 = Saturday 2025-05-10
    it('serial 45787 formats as Saturday with DDDD', () => {
        expect(applyCustomFormat('45787', 'DDDD')).toBe('Saturday');
    });

    // 45788 = Sunday 2025-05-11
    it('serial 45788 formats as Sunday with DDDD', () => {
        expect(applyCustomFormat('45788', 'DDDD')).toBe('Sunday');
    });
});

// ── Full date patterns (DD, MM, YYYY) ─────────────────────────────────────────

describe('applyCustomFormat — date components are UTC-based', () => {
    // 45782 = 2025-05-05
    it('serial 45782 produces correct DD', () => {
        expect(applyCustomFormat('45782', 'DD')).toBe('05');
    });

    it('serial 45782 produces correct MM', () => {
        expect(applyCustomFormat('45782', 'MM')).toBe('05');
    });

    it('serial 45782 produces correct YYYY', () => {
        expect(applyCustomFormat('45782', 'YYYY')).toBe('2025');
    });

    it('serial 45782 formats full date pattern correctly', () => {
        expect(applyCustomFormat('45782', 'YYYY-MM-DD')).toBe('2025-05-05');
    });

    it('serial 45782 formats with day name and date', () => {
        expect(applyCustomFormat('45782', 'DDDD, MMMM D, YYYY')).toBe('Monday, May 5, 2025');
    });
});

// ── Excel 1900 leap-year quirk ────────────────────────────────────────────────

describe('applyCustomFormat — Excel 1900 leap-year correction', () => {
    // Serial 1 = Jan 1, 1900
    it('serial 1 formats as 1900-01-01', () => {
        expect(applyCustomFormat('1', 'YYYY-MM-DD')).toBe('1900-01-01');
    });

    // Serial 61 = Mar 1, 1900 (Excel serial 60 is the phantom Feb 29)
    it('serial 61 formats as 1900-03-01', () => {
        expect(applyCustomFormat('61', 'YYYY-MM-DD')).toBe('1900-03-01');
    });
});

// ── Fractional serials (date + time of day) ──────────────────────────────────

describe('applyCustomFormat — fractional serials use the date portion', () => {
    // 46037 = 2026-01-15, 46067 = 2026-02-14 (integer serials work).
    it('serial 46037 formats as Jan 2026', () => {
        expect(applyCustomFormat('46037', 'MMM YYYY')).toBe('Jan 2026');
    });

    it('serial 46067 formats as Feb 2026', () => {
        expect(applyCustomFormat('46067', 'MMM YYYY')).toBe('Feb 2026');
    });

    // Regression: 46067.5 (A1+30.5) fell through the integer-only /^\d+$/ guard
    // to `new Date("46067.5")`, which parsed 46067 as a *year* → "May 46067".
    // The .5 is a time-of-day component and must be ignored for date display.
    it('serial 46067.5 still formats as Feb 2026 (not May 46067)', () => {
        expect(applyCustomFormat('46067.5', 'MMM YYYY')).toBe('Feb 2026');
    });

    it('serial 46067.5 produces the correct full date', () => {
        expect(applyCustomFormat('46067.5', 'YYYY-MM-DD')).toBe('2026-02-14');
    });

    it('serial 45782.75 keeps the date portion (2025-05-05)', () => {
        expect(applyCustomFormat('45782.75', 'YYYY-MM-DD')).toBe('2025-05-05');
    });
});

// ── formatCellValue date number format ────────────────────────────────────────

describe('formatCellValue — numberFormat date is timezone-independent', () => {
    it('serial 45782 displays as 5/5/2025', () => {
        const result = formatCellValue('45782', { numberFormat: 'date' });
        expect(result).toBe('5/5/2025');
    });

    it('serial 45783 displays as 5/6/2025', () => {
        const result = formatCellValue('45783', { numberFormat: 'date' });
        expect(result).toBe('5/6/2025');
    });

    it('fractional serial 46067.5 displays as 2/14/2026 (not May 46067)', () => {
        const result = formatCellValue('46067.5', { numberFormat: 'date' });
        expect(result).toBe('2/14/2026');
    });
});
