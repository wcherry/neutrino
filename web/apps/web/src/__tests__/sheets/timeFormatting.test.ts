/**
 * Tests for time-of-day formatting in the sheets editor, extending the existing
 * date-formatting engine (formatDateWithPattern / applyCustomFormat / formatCellValue)
 * with h/m/s and AM/PM tokens.
 *
 * 'm'/'mm' is ambiguous between "month" and "minute" in Excel-style format strings.
 * The engine disambiguates by looking at neighboring tokens: 'm' is a minute when it
 * immediately follows an hour token (h/hh) or precedes a seconds token (s/ss),
 * otherwise it's a month.
 */

import { describe, it, expect } from 'vitest';
import { applyCustomFormat, formatCellValue } from '../../app/(apps)/sheets/editor/utils';

const SAMPLE = '2025-11-01T13:30:00Z'; // 1:30:00 PM UTC

describe('applyCustomFormat — time tokens', () => {
    it('formats 12-hour time with AM/PM', () => {
        expect(applyCustomFormat(SAMPLE, 'h:mm AM/PM')).toBe('1:30 PM');
    });

    it('formats 24-hour time with zero-padded hour', () => {
        expect(applyCustomFormat(SAMPLE, 'hh:mm:ss')).toBe('13:30:00');
    });

    it('formats 12-hour time with seconds', () => {
        expect(applyCustomFormat(SAMPLE, 'h:mm:ss AM/PM')).toBe('1:30:00 PM');
    });

    it('preserves lowercase am/pm designator casing', () => {
        expect(applyCustomFormat(SAMPLE, 'h:mm am/pm')).toBe('1:30 pm');
    });

    it('pads single-digit hour/minute/second with leading zero', () => {
        expect(applyCustomFormat('2025-11-01T01:05:09Z', 'hh:mm:ss')).toBe('01:05:09');
    });

    it('does not pad hour/minute/second without the doubled token', () => {
        expect(applyCustomFormat('2025-11-01T01:05:09Z', 'h:mm:ss AM/PM')).toBe('1:05:09 AM');
    });
});

describe('applyCustomFormat — disambiguating month "m" from minute "m"', () => {
    it('treats "mm" as minutes when it follows an hour token', () => {
        expect(applyCustomFormat(SAMPLE, 'yyyy-mm-dd hh:mm:ss')).toBe('2025-11-01 13:30:00');
    });

    it('treats "mm" as month when it is not adjacent to an hour/seconds token', () => {
        expect(applyCustomFormat(SAMPLE, 'M/D/yyyy')).toBe('11/1/2025');
    });

    it('correctly disambiguates two "m"-family tokens in the same combined date+time format', () => {
        expect(applyCustomFormat(SAMPLE, 'M/D/yyyy h:mm AM/PM')).toBe('11/1/2025 1:30 PM');
    });

    it('treats a single "m" as minutes when it precedes a seconds token', () => {
        expect(applyCustomFormat(SAMPLE, 'h:m:ss AM/PM')).toBe('1:30:00 PM');
    });
});

describe('formatCellValue — numberFormat time/datetime', () => {
    it('renders numberFormat "time" as a locale time string', () => {
        const result = formatCellValue(SAMPLE, { numberFormat: 'time' });
        expect(result).toMatch(/1:30:00[\s ]PM/);
    });

    it('renders numberFormat "datetime" as a combined locale date+time string', () => {
        const result = formatCellValue(SAMPLE, { numberFormat: 'datetime' });
        expect(result).toMatch(/11\/1\/2025/);
        expect(result).toMatch(/1:30:00[\s ]PM/);
    });

    it('extracts time-of-day from a fractional Excel serial', () => {
        // 46067 = 2026-02-14 (midnight). +0.5625 days = 13:30:00 (9/16 is an exact
        // binary fraction, so this is exact — no floating-point rounding risk).
        const result = formatCellValue('46067.5625', { numberFormat: 'time' });
        expect(result).toMatch(/1:30:00[\s ]PM/);
    });
});
