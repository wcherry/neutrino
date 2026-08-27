/**
 * Regression for issue #33 — "Date Math/Parsing is Broken in Sheets".
 *
 * The formula engine's parseDate() used to reach for `new Date(s)` directly,
 * which broke the two inputs a spreadsheet produces most:
 *
 *  1. An Excel **serial**. Date arithmetic yields serials (=A1+30 → 45822), so
 *     feeding that back into MONTH/YEAR/DATEDIF hit `new Date("45822")`, which
 *     parses 45822 as a *year* — MONTH said 1 and YEAR said 45792.
 *  2. A **US "MM/DD/YYYY"** string, which `new Date` parses at local midnight
 *     while every reader below uses getUTC*. Anywhere east of Greenwich that is
 *     the previous day, so 11/01/2025 reported month 10 — the October-for-
 *     November in the issue's screenshot.
 *
 * parseDate now shares parseCellDateValue with the display layer, so a date
 * means the same thing in a formula as it does on screen, in every timezone.
 * The tests below are asserted against fixed expectations and the suite is run
 * under several TZ settings in CI; none of them may depend on the local zone.
 */

import { describe, it, expect } from 'vitest';
import { computeCell } from '../../app/(apps)/sheets/editor/formula';
import { applyCustomFormat } from '../../app/(apps)/sheets/editor/utils';
import type { CellProps } from '../../app/(apps)/sheets/editor/types';

function sheet(values: Record<string, string>): Map<string, CellProps> {
    const data = new Map<string, CellProps>();
    for (const [id, value] of Object.entries(values)) {
        data.set(id, { id, value, raw: value, edit: false });
    }
    return data;
}

const evaluate = (formula: string, values: Record<string, string> = {}) =>
    computeCell(formula, sheet(values)).value;

// ── Excel serials are dates, not years ───────────────────────────────────────

describe('date functions accept an Excel serial', () => {
    // 45792 = 2025-05-15.
    it('MONTH/DAY/YEAR read a serial as a date', () => {
        const cells = { A1: '45792' };
        expect(evaluate('=YEAR(A1)', cells)).toBe('2025');
        expect(evaluate('=MONTH(A1)', cells)).toBe('5');
        expect(evaluate('=DAY(A1)', cells)).toBe('15');
    });

    it('a serial produced by arithmetic flows back into a date function', () => {
        const cells = { A1: '05/15/2025' };
        // =A1+30 is 45822 = 2025-06-14.
        expect(evaluate('=MONTH(A1+30)', cells)).toBe('6');
        expect(evaluate('=DAY(A1+30)', cells)).toBe('14');
        expect(evaluate('=EOMONTH(A1+30,0)', cells)).toBe('2025-06-30');
        expect(evaluate('=DATEDIF(A1,A1+30,"D")', cells)).toBe('30');
    });

    it('a fractional serial keeps its date portion', () => {
        // 45792.75 = 2025-05-15 18:00.
        expect(evaluate('=DAY(A1)', { A1: '45792.75' })).toBe('15');
        expect(evaluate('=MONTH(A1)', { A1: '45792.75' })).toBe('5');
    });
});

// ── US dates are read as calendar dates, not local midnights ─────────────────

describe('date functions are timezone-independent', () => {
    it('the 1st of a month does not slip into the previous month', () => {
        const cells = { A1: '11/01/2025' };
        expect(evaluate('=MONTH(A1)', cells)).toBe('11');
        expect(evaluate('=DAY(A1)', cells)).toBe('1');
    });

    it('a US date string keeps its day', () => {
        expect(evaluate('=DAY(A1)', { A1: '05/15/2025' })).toBe('15');
        expect(evaluate('=DAY("05/15/2025")')).toBe('15');
    });

    it('a long-form date string keeps its day', () => {
        const cells = { A1: 'May 15, 2025' };
        expect(evaluate('=MONTH(A1)', cells)).toBe('5');
        expect(evaluate('=DAY(A1)', cells)).toBe('15');
    });

    it('DATEADD/WORKDAY advance a US date by a whole day', () => {
        const cells = { A1: '05/15/2025' };
        expect(evaluate('=DATEADD(A1,1)', cells)).toBe('2025-05-16');
        expect(evaluate('=WORKDAY(A1,1)', cells)).toBe('2025-05-16');
    });

    it('NETWORKDAYS counts the same span whichever date shape is used', () => {
        expect(evaluate('=NETWORKDAYS(A1,B1)', { A1: '05/15/2025', B1: '11/01/2025' })).toBe('122');
        expect(evaluate('=NETWORKDAYS(A1,B1)', { A1: '2025-05-15', B1: '2025-11-01' })).toBe('122');
    });
});

// ── Non-dates still error rather than resolving to something arbitrary ───────

describe('date functions reject non-dates', () => {
    it('text is #VALUE!', () => {
        expect(evaluate('=MONTH(A1)', { A1: 'hello' })).toBe('#VALUE!');
    });

    it('an empty cell is #VALUE!', () => {
        expect(evaluate('=MONTH(A1)')).toBe('#VALUE!');
    });
});

// ── The reported repro: custom format over a typed date ──────────────────────

describe('issue #33 repro — mmmm" "yyyy over a typed US date', () => {
    it('05/15/2025 renders as May 2025', () => {
        expect(applyCustomFormat('05/15/2025', 'mmmm" "yyyy')).toBe('May 2025');
    });

    it('11/01/2025 renders as November 2025, not October', () => {
        expect(applyCustomFormat('11/01/2025', 'mmmm" "yyyy')).toBe('November 2025');
    });

    it('a long-form date keeps its day through a custom format', () => {
        expect(applyCustomFormat('May 15, 2025', 'mmmm D, yyyy')).toBe('May 15, 2025');
    });
});

// ── NOW() agrees with TODAY() ────────────────────────────────────────────────

describe('NOW() reports local wall-clock time', () => {
    it('its date part matches TODAY()', () => {
        expect(evaluate('=NOW()').slice(0, 10)).toBe(evaluate('=TODAY()'));
    });

    it('its time part is the local hour', () => {
        const hour = Number(evaluate('=NOW()').slice(11, 13));
        expect(hour).toBe(new Date().getHours());
    });
});
