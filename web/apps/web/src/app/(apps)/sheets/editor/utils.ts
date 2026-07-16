import type { CellStyle, CellProps } from './types';
import { MAX_COLS, MAX_ROWS } from './constants';

export type ArrowNavigationKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export function numToAlpha(num: number): string {
    let alpha: string = '';
    while (num > 0) {
        num--;
        alpha = String.fromCharCode(65 + (num % 26)) + alpha;
        num = Math.floor(num / 26);
    }
    return alpha;
}

export function alphaToNum(alpha: string): number {
    let num = 0;
    for (let i = 0; i < alpha.length; i++) {
        num = num * 26 + (alpha.charCodeAt(i) - 64);
    }
    return num;
}

export function parseCellId(id: string): { col: number; row: number } | null {
    const match = id.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    return { col: alphaToNum(match[1]), row: parseInt(match[2], 10) };
}

function isPopulatedCell(cell: CellProps | undefined): boolean {
    return ((cell?.raw ?? '') !== '') || ((cell?.value ?? '') !== '');
}

function populatedBounds(cells: Map<string, CellProps>, origin: { col: number; row: number }) {
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
    for (const [id, cell] of cells) {
        if (!isPopulatedCell(cell)) continue;
        const parsed = parseCellId(id);
        if (!parsed) continue;
        if (parsed.row === origin.row) {
            minCol = Math.min(minCol, parsed.col);
            maxCol = Math.max(maxCol, parsed.col);
        }
        if (parsed.col === origin.col) {
            minRow = Math.min(minRow, parsed.row);
            maxRow = Math.max(maxRow, parsed.row);
        }
    }
    return { minCol, maxCol, minRow, maxRow };
}

export function navigateCell(
    currentId: string,
    direction: ArrowNavigationKey,
    options: { ctrlKey?: boolean; data?: Map<string, CellProps> } = {},
): string {
    const parsed = parseCellId(currentId);
    if (!parsed) return currentId;

    let { col, row } = parsed;

    if (options.ctrlKey) {
        const bounds = populatedBounds(options.data ?? new Map(), parsed);
        if (direction === 'ArrowUp' && bounds.minRow !== Infinity) row = bounds.minRow;
        if (direction === 'ArrowDown' && bounds.maxRow !== -Infinity) row = bounds.maxRow;
        if (direction === 'ArrowLeft' && bounds.minCol !== Infinity) col = bounds.minCol;
        if (direction === 'ArrowRight' && bounds.maxCol !== -Infinity) col = bounds.maxCol;
    } else {
        const currentCell = options.data?.get(currentId);
        if (direction === 'ArrowUp') row -= 1;
        if (direction === 'ArrowDown') row += (currentCell?.rowSpan ?? 1);
        if (direction === 'ArrowLeft') col -= 1;
        if (direction === 'ArrowRight') col += (currentCell?.colSpan ?? 1);
    }

    col = Math.max(1, Math.min(MAX_COLS, col));
    row = Math.max(1, Math.min(MAX_ROWS, row));
    const nextId = `${numToAlpha(col)}${row}`;
    const nextCell = options.data?.get(nextId);
    return nextCell?.mergeAnchor ?? nextId;
}

// Excel date serial: 1 = Jan 1, 1900. Excel incorrectly treats 1900 as a leap
// year (serial 60 = non-existent Feb 29, 1900), so serials > 60 are off by one
// relative to the real calendar — subtract 1 to compensate.
function excelSerialToDate(serial: number): Date {
    const adjusted = serial > 60 ? serial - 1 : serial;
    return new Date(Date.UTC(1900, 0, 1) + (adjusted - 1) * 86400000);
}

// Inverse of excelSerialToDate: converts a UTC-midnight Date to an Excel serial.
// Re-adds the phantom Feb 29, 1900 (serial 60) for dates on/after Mar 1, 1900 so
// the round-trip matches excelSerialToDate's `serial > 60` correction.
function dateToExcelSerial(d: Date): number {
    const days = Math.round((d.getTime() - Date.UTC(1900, 0, 1)) / 86400000);
    const adjusted = days + 1;
    return adjusted > 59 ? adjusted + 1 : adjusted;
}

// Parses "13:30", "13:30:00", "1:30 PM" or "1:30:00 PM" into hour/minute/second
// parts (24-hour). Returns null for out-of-range components or a bad shape.
function parseTimeParts(value: string): { h: number; m: number; s: number } | null {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
    if (!m) return null;
    let h = +m[1];
    const min = +m[2];
    const sec = m[3] ? +m[3] : 0;
    const meridiem = m[4]?.toLowerCase();
    if (min > 59 || sec > 59) return null;
    if (meridiem) {
        if (h < 1 || h > 12) return null;
        h = meridiem === 'am' ? (h % 12) : (h % 12) + 12;
    } else if (h > 23) {
        return null;
    }
    return { h, m: min, s: sec };
}

// Fraction of a day represented by a time-of-day (e.g. 13:30:00 -> 0.5625).
function timePartsToFraction(t: { h: number; m: number; s: number }): number {
    return (t.h * 3600 + t.m * 60 + t.s) / 86400;
}

// Parses a plain date string ("01/01/2026", "2026-01-01"), a bare time string
// ("13:30", "1:30 PM"), or a combined date+time string ("2026-01-01 13:30",
// "01/01/2026 1:30 PM") into an Excel serial so date/time-valued cells
// participate in arithmetic (e.g. =A1+0.5 adds 12 hours). Returns null when the
// value doesn't match any of these shapes, letting callers fall back to numeric
// parsing.
export function dateStringToSerial(value: string): number | null {
    const s = value.trim();

    // Split "<date> <time>" or ISO "<date>T<time>" on the first space/T so the
    // date part (no internal spaces) and time part can be parsed independently.
    const split = s.match(/^(.+?)[ T](\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)$/);
    let datePart = s;
    let timePart: string | null = null;
    if (split) {
        datePart = split[1];
        timePart = split[2];
    } else {
        // No date/time separator found — the whole string might be a bare time.
        const timeOnly = parseTimeParts(s);
        if (timeOnly) return timePartsToFraction(timeOnly);
    }

    let y: number, mo: number, d: number;
    const iso = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const us  = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (iso) {
        y = +iso[1]; mo = +iso[2]; d = +iso[3];
    } else if (us) {
        mo = +us[1]; d = +us[2]; y = +us[3];
        if (y < 100) y += y < 50 ? 2000 : 1900;
    } else {
        return null;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, mo - 1, d));
    // Reject calendar overflow (e.g. 02/30 rolls forward into March).
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    let serial = dateToExcelSerial(date);

    if (timePart) {
        const t = parseTimeParts(timePart);
        if (!t) return null;
        serial += timePartsToFraction(t);
    }
    return serial;
}

const TIME_TOKEN_RE = /mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|hh|h|ss|s|am\/pm|a\/p/gi;

function formatDateWithPattern(d: Date, fmt: string): string {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const daysShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();
    const dow = d.getUTCDay();
    const hours24 = d.getUTCHours();
    const minutes = d.getUTCMinutes();
    const seconds = d.getUTCSeconds();
    // Replace quoted literals with placeholders so their content isn't token-matched
    const literals: string[] = [];
    let result = fmt.replace(/"([^"]*)"/g, (_, s) => { literals.push(s); return `\x00${literals.length - 1}\x00`; });

    // 'm'/'mm' is ambiguous between month and minute — Excel's rule is that it means
    // minutes when adjacent to an hour or seconds token, month otherwise. Tokenize
    // first so each 'm'/'mm' match can inspect its neighbors before substitution.
    const matches = [...result.matchAll(TIME_TOKEN_RE)];
    const hasMeridiem = matches.some(m => /^(am\/pm|a\/p)$/i.test(m[0]));
    const minuteTokenIndexes = new Set<number>();
    matches.forEach((m, i) => {
        const tok = m[0].toLowerCase();
        if (tok !== 'm' && tok !== 'mm') return;
        const prev = matches[i - 1]?.[0]?.toLowerCase();
        const next = matches[i + 1]?.[0]?.toLowerCase();
        if (prev === 'h' || prev === 'hh' || next === 's' || next === 'ss') minuteTokenIndexes.add(i);
    });

    let matchIndex = 0;
    result = result.replace(TIME_TOKEN_RE, token => {
        const i = matchIndex++;
        switch (token.toLowerCase()) {
            case 'mmmm': return months[mo];
            case 'mmm':  return monthsShort[mo];
            case 'mm':   return minuteTokenIndexes.has(i) ? String(minutes).padStart(2, '0') : String(mo + 1).padStart(2, '0');
            case 'm':    return minuteTokenIndexes.has(i) ? String(minutes) : String(mo + 1);
            case 'dddd': return days[dow];
            case 'ddd':  return daysShort[dow];
            case 'dd':   return String(day).padStart(2, '0');
            case 'd':    return String(day);
            case 'yyyy': return String(y);
            case 'yy':   return String(y).slice(-2);
            case 'hh':   return String(hasMeridiem ? (hours24 % 12 || 12) : hours24).padStart(2, '0');
            case 'h':    return String(hasMeridiem ? (hours24 % 12 || 12) : hours24);
            case 'ss':   return String(seconds).padStart(2, '0');
            case 's':    return String(seconds);
            case 'am/pm': return token === token.toLowerCase() ? (hours24 < 12 ? 'am' : 'pm') : (hours24 < 12 ? 'AM' : 'PM');
            case 'a/p':   return token === token.toLowerCase() ? (hours24 < 12 ? 'a' : 'p') : (hours24 < 12 ? 'A' : 'P');
            default:     return token;
        }
    });
    // Restore literals
    return result.replace(/\x00(\d+)\x00/g, (_, i) => literals[parseInt(i)]);
}

function isDateOrTimeFormatStr(fmt: string): boolean {
    const noLiterals = fmt.replace(/"[^"]*"/g, '');
    return /[dmyDMY]|\bh{1,2}\b|\bs{1,2}\b|am\/pm|a\/p/i.test(noLiterals);
}

// Parses a cell's raw value into a Date, treating a purely numeric value as an
// Excel serial (whose fractional part encodes time-of-day), a recognized date/
// time/datetime string as a serial via dateStringToSerial, and anything else as
// a native Date-parseable string. Shared by both custom-format and preset rendering.
function parseCellDateValue(value: string): Date {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return excelSerialToDate(parseFloat(trimmed));
    const serial = dateStringToSerial(trimmed);
    if (serial !== null) return excelSerialToDate(serial);
    return new Date(value);
}

export function applyCustomFormat(value: string, fmt: string): string {
    if (!value) return value;
    // Date/time format
    if (isDateOrTimeFormatStr(fmt)) {
        const d = parseCellDateValue(value);
        if (isNaN(d.getTime())) return value;
        return formatDateWithPattern(d, fmt);
    }
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    const decimalMatch = fmt.match(/\.([0#]+)/);
    const decimals = decimalMatch ? decimalMatch[1].length : 0;
    const useGrouping = fmt.includes(',');
    // Percent
    if (fmt.includes('%')) {
        return num.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    // Currency — $ anywhere in the format string (quoted or unquoted)
    if (fmt.includes('$')) {
        return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    // Plain number
    return num.toLocaleString('en-US', { useGrouping, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCellValue(value: string, style?: CellStyle): string {
    if (!value) return value;
    if (style?.customFormat) return applyCustomFormat(value, style.customFormat);
    if (!style?.numberFormat) return value;
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    const decimals = style.decimalPlaces ?? (style.numberFormat === 'currency' ? 2 : 0);
    switch (style.numberFormat) {
        case 'currency':
            return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        case 'percent':
            return num.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        case 'number':
            return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        case 'date': {
            const d = parseCellDateValue(value);
            return isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { timeZone: 'UTC' });
        }
        case 'time': {
            const d = parseCellDateValue(value);
            return isNaN(d.getTime()) ? value : d.toLocaleTimeString('en-US', { timeZone: 'UTC' });
        }
        case 'datetime': {
            const d = parseCellDateValue(value);
            return isNaN(d.getTime()) ? value : d.toLocaleString('en-US', { timeZone: 'UTC' });
        }
        default:
            return value;
    }
}

export function expandRange(start: string, end: string): string[] {
    const s = start.match(/^([A-Z]+)(\d+)$/);
    const e = end.match(/^([A-Z]+)(\d+)$/);
    if (!s || !e) return [];
    const c1 = alphaToNum(s[1]), r1 = parseInt(s[2]);
    const c2 = alphaToNum(e[1]), r2 = parseInt(e[2]);
    const cells: string[] = [];
    for (let c = c1; c <= c2; c++)
        for (let r = r1; r <= r2; r++)
            cells.push(`${numToAlpha(c)}${r}`);
    return cells;
}

export function getRangeCells(anchor: string, active: string): Set<string> {
    const am = anchor.match(/^([A-Z]+)(\d+)$/);
    const bm = active.match(/^([A-Z]+)(\d+)$/);
    if (!am || !bm) return new Set([anchor]);
    const c1 = Math.min(alphaToNum(am[1]), alphaToNum(bm[1]));
    const c2 = Math.max(alphaToNum(am[1]), alphaToNum(bm[1]));
    const r1 = Math.min(parseInt(am[2]), parseInt(bm[2]));
    const r2 = Math.max(parseInt(am[2]), parseInt(bm[2]));
    const cells = new Set<string>();
    for (let c = c1; c <= c2; c++)
        for (let r = r1; r <= r2; r++)
            cells.add(`${numToAlpha(c)}${r}`);
    return cells;
}

export function rangeAddress(anchor: string, active: string): string {
    const am = anchor.match(/^([A-Z]+)(\d+)$/);
    const bm = active.match(/^([A-Z]+)(\d+)$/);
    if (!am || !bm || anchor === active) return anchor;
    const c1 = Math.min(alphaToNum(am[1]), alphaToNum(bm[1]));
    const c2 = Math.max(alphaToNum(am[1]), alphaToNum(bm[1]));
    const r1 = Math.min(parseInt(am[2]), parseInt(bm[2]));
    const r2 = Math.max(parseInt(am[2]), parseInt(bm[2]));
    if (c1 === c2 && r1 === r2) return anchor;
    return `${numToAlpha(c1)}${r1}:${numToAlpha(c2)}${r2}`;
}

// Replaces every cell reference in a formula with an encoded token.
//
// Encoding rules:
//   - Relative column:  [N]    (signed integer delta from cellCol)
//   - Absolute column:  [$A]   (dollar sign + original alpha letters)
//   - Relative row:     [N]    (signed integer delta from cellRow)
//   - Absolute row:     [$N]   (dollar sign + original digits)
//
// So $A$1 at (row=2,col=3) becomes [$A][$1].
//    A$1 at (row=2,col=3) becomes [-2][$1].
//    $A1 at (row=2,col=3) becomes [$A][-1].
//    A1  at (row=2,col=3) becomes [-2][-1].
//
// The regex captures an optional $ before column letters and an optional $
// before the row digits.  The resulting token is used by decodeFormula.
export function encodeFormula(raw: string, cellRow: number, cellCol: number): string {
    if (!raw.startsWith('=')) return raw;
    // Match optional-$, column-letters, optional-$, digits — handling cross-sheet
    // prefix (SheetName!) by using a negative-lookbehind for '!'.  We skip the
    // sheet name itself (identifier + '!') because it contains only letters and
    // digits but must not be treated as a cell reference.
    //
    // Strategy: first replace cross-sheet prefixes with a placeholder, encode
    // cell refs, then restore the prefixes.
    // More robust: replace sheet-name! fragments first, then encode.
    // Protect cross-sheet prefixes (e.g. "Beta!" or "'Net Worth'!") so they
    // are not treated as cell references by the encode regex.
    // We replace them with a placeholder that contains no letters or digits.
    const sheetPrefixRe = /('(?:[^']+)'!|[A-Za-z_][A-Za-z0-9_]*!)/g;
    const sheetPrefixes: string[] = [];
    const noSheets = raw.replace(sheetPrefixRe, (m) => {
        sheetPrefixes.push(m);
        // Placeholder: \x00 + index digits only + \x00 — no letters, so the
        // encode regex below will never mistake it for a cell reference.
        return `\x00${sheetPrefixes.length - 1}\x00`;
    });

    const encoded = noSheets.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)/g, (
        _,
        dollarCol: string,
        alpha: string,
        dollarRow: string,
        num: string,
    ) => {
        const colToken = dollarCol
            ? `[$${alpha.toUpperCase()}]`
            : `[${alphaToNum(alpha.toUpperCase()) - cellCol}]`;
        const rowToken = dollarRow
            ? `[$${num}]`
            : `[${parseInt(num, 10) - cellRow}]`;
        return `${colToken}${rowToken}`;
    });

    // Restore cross-sheet prefixes
    return encoded.replace(/\x00(\d+)\x00/g, (_, idx) => sheetPrefixes[parseInt(idx)]);
}

// Inverse of encodeFormula: restores encoded tokens to cell references.
//
// Token forms:
//   Column: [N] (relative delta) or [$ALPHA] (absolute)
//   Row:    [N] (relative delta) or [$N]     (absolute)
//
// When the column token starts with $ the original alpha letters are emitted
// verbatim with the $ prefix (absolute column preserved).
// When the row token starts with $ the original digits are emitted verbatim
// with the $ prefix (absolute row preserved).
export function decodeFormula(encoded: string, targetRow: number, targetCol: number): string {
    if (!encoded.startsWith('=')) return encoded;
    // Regex matches: [$ALPHA] or [-?N] for col, then [$N] or [-?N] for row
    return encoded.replace(
        /\[(\$[A-Z]+|-?\d+)\]\[(\$\d+|-?\d+)\]/g,
        (_, colToken: string, rowToken: string) => {
            let colPart: string;
            if (colToken.startsWith('$')) {
                // Absolute column — emit as-is with $ prefix
                colPart = `$${colToken.slice(1)}`;
            } else {
                const col = targetCol + parseInt(colToken, 10);
                if (col < 1) return '#REF!';
                colPart = numToAlpha(col);
            }

            let rowPart: string;
            if (rowToken.startsWith('$')) {
                // Absolute row — emit as-is with $ prefix
                rowPart = `$${rowToken.slice(1)}`;
            } else {
                const row = targetRow + parseInt(rowToken, 10);
                if (row < 1) return '#REF!';
                rowPart = String(row);
            }

            return `${colPart}${rowPart}`;
        },
    );
}

// Returns the min/max row and col (1-based) for a set of cell IDs.
export function getCellBounds(ids: Iterable<string>): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
    let minRow = Infinity, maxRow = 0, minCol = Infinity, maxCol = 0;
    for (const id of ids) {
        const m = id.match(/^([A-Z]+)(\d+)$/);
        if (!m) continue;
        const col = alphaToNum(m[1]), row = parseInt(m[2]);
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
    }
    return { minRow, maxRow, minCol, maxCol };
}

// Creates a Blob URL, triggers a download via a temporary <a> element, then revokes the URL.
export function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Builds a subset Map from a set of cell IDs, filling missing cells with empty defaults.
export function getSelectionSubset(ids: Set<string>, data: Map<string, CellProps>): Map<string, CellProps> {
    const subset = new Map<string, CellProps>();
    for (const id of ids) {
        subset.set(id, data.get(id) ?? { id, value: '', raw: '', edit: false });
    }
    return subset;
}

export function parseDeps(raw: string): string[] {
    if (raw && !raw.startsWith('=')) return [];
    const deps = new Set<string>();
    // Skip cross-sheet references (SheetName!CellRef or 'Sheet Name'!CellRef).
    // We do not track cross-sheet deps in the within-sheet dependency graph.
    const withoutCrossSheet = raw
        .replace(/'[^']*'!\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?/g, '')
        .replace(/[A-Za-z_][A-Za-z0-9_]*!\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?/g, '');
    // Match optional $ prefixes on column and row; strip them when building the dep ID.
    const pattern = /(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/g;
    let match;
    while ((match = pattern.exec(withoutCrossSheet)) !== null) {
        // Strip $ to get the plain cell ID for the dependency graph
        const start = match[1].replace(/\$/g, '');
        if (match[2]) {
            const end = match[2].replace(/\$/g, '');
            expandRange(start, end).forEach(id => deps.add(id));
        } else {
            deps.add(start);
        }
    }
    return Array.from(deps);
}
