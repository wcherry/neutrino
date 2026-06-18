import type { CellProps } from './types';
import { expandRange, parseDeps, alphaToNum, numToAlpha } from './utils';

// ── Public API ──────────────────────────────────────────────────────────────

export interface FunctionMeta {
    name: string;
    signature: string;
    description: string;
}

export const FUNCTIONS_META: FunctionMeta[] = [
    // Math & basic
    { name: 'SUM',       signature: 'SUM(number1, [number2], ...)',          description: 'Add numbers or a range' },
    { name: 'AVERAGE',   signature: 'AVERAGE(number1, [number2], ...)',      description: 'Mean of numbers or a range' },
    { name: 'COUNT',     signature: 'COUNT(value1, [value2], ...)',          description: 'Count numeric cells' },
    { name: 'COUNTA',    signature: 'COUNTA(value1, [value2], ...)',         description: 'Count non-empty cells' },
    { name: 'MIN',       signature: 'MIN(number1, [number2], ...)',          description: 'Smallest value' },
    { name: 'MAX',       signature: 'MAX(number1, [number2], ...)',          description: 'Largest value' },
    { name: 'ROUND',     signature: 'ROUND(number, digits)',                 description: 'Round to N decimal places' },
    { name: 'ROUNDUP',   signature: 'ROUNDUP(number, digits)',               description: 'Round up to N decimal places' },
    { name: 'ROUNDDOWN', signature: 'ROUNDDOWN(number, digits)',             description: 'Round down to N decimal places' },
    { name: 'ABS',       signature: 'ABS(number)',                          description: 'Absolute value' },
    { name: 'MOD',       signature: 'MOD(number, divisor)',                  description: 'Remainder after division' },
    // Logical
    { name: 'IF',        signature: 'IF(condition, value_if_true, [value_if_false])', description: 'Conditional value' },
    { name: 'IFS',       signature: 'IFS(condition1, value1, ...)',          description: 'Multiple conditions' },
    { name: 'AND',       signature: 'AND(logical1, [logical2], ...)',        description: 'True if all arguments are true' },
    { name: 'OR',        signature: 'OR(logical1, [logical2], ...)',         description: 'True if any argument is true' },
    { name: 'NOT',       signature: 'NOT(logical)',                          description: 'Reverse a logical value' },
    { name: 'IFERROR',   signature: 'IFERROR(value, value_if_error)',        description: 'Return fallback on error' },
    // Lookup & reference
    { name: 'VLOOKUP',   signature: 'VLOOKUP(lookup_value, table, col_index, [exact])',                  description: 'Vertical lookup in a table' },
    { name: 'HLOOKUP',   signature: 'HLOOKUP(lookup_value, table, row_index, [exact])',                  description: 'Horizontal lookup in a table' },
    { name: 'XLOOKUP',   signature: 'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])', description: 'Flexible modern lookup' },
    { name: 'INDEX',     signature: 'INDEX(array, row_num, [col_num])',      description: 'Return value at position' },
    { name: 'MATCH',     signature: 'MATCH(lookup_value, lookup_array, [match_type])', description: 'Find position of a value' },
    { name: 'OFFSET',    signature: 'OFFSET(reference, rows, cols)',         description: 'Dynamic cell reference' },
    // Text
    { name: 'CONCAT',        signature: 'CONCAT(text1, [text2], ...)',                       description: 'Join text together' },
    { name: 'CONCATENATE',   signature: 'CONCATENATE(text1, [text2], ...)',                  description: 'Join text together' },
    { name: 'TEXTJOIN',      signature: 'TEXTJOIN(delimiter, ignore_empty, text1, ...)',     description: 'Join text with a delimiter' },
    { name: 'LEFT',          signature: 'LEFT(text, [num_chars])',                           description: 'First N characters' },
    { name: 'RIGHT',         signature: 'RIGHT(text, [num_chars])',                          description: 'Last N characters' },
    { name: 'MID',           signature: 'MID(text, start, num_chars)',                       description: 'Substring from position' },
    { name: 'LEN',           signature: 'LEN(text)',                                         description: 'Number of characters' },
    { name: 'TRIM',          signature: 'TRIM(text)',                                        description: 'Remove extra spaces' },
    { name: 'UPPER',         signature: 'UPPER(text)',                                       description: 'Convert to uppercase' },
    { name: 'LOWER',         signature: 'LOWER(text)',                                       description: 'Convert to lowercase' },
    { name: 'PROPER',        signature: 'PROPER(text)',                                      description: 'Capitalize each word' },
    { name: 'SUBSTITUTE',    signature: 'SUBSTITUTE(text, old_text, new_text, [occurrence])', description: 'Replace text occurrences' },
    { name: 'FIND',          signature: 'FIND(find_text, within_text, [start_num])',         description: 'Position of text (case-sensitive)' },
    { name: 'SEARCH',        signature: 'SEARCH(find_text, within_text, [start_num])',       description: 'Position of text (case-insensitive)' },
    // Date & time
    { name: 'TODAY',         signature: 'TODAY()',                                            description: 'Current date' },
    { name: 'NOW',           signature: 'NOW()',                                              description: 'Current date and time' },
    { name: 'DATE',          signature: 'DATE(year, month, day)',                             description: 'Build a date from parts' },
    { name: 'YEAR',          signature: 'YEAR(date)',                                         description: 'Year from a date' },
    { name: 'MONTH',         signature: 'MONTH(date)',                                        description: 'Month from a date' },
    { name: 'DAY',           signature: 'DAY(date)',                                          description: 'Day from a date' },
    { name: 'DATEDIF',       signature: 'DATEDIF(start_date, end_date, unit)',                description: 'Difference between dates' },
    { name: 'EOMONTH',       signature: 'EOMONTH(start_date, months)',                       description: 'Last day of a month' },
    { name: 'WORKDAY',       signature: 'WORKDAY(start_date, days)',                         description: 'Date N workdays away' },
    { name: 'NETWORKDAYS',   signature: 'NETWORKDAYS(start_date, end_date)',                 description: 'Count working days between dates' },
    // Statistical
    { name: 'SUMIF',         signature: 'SUMIF(range, criteria, [sum_range])',               description: 'Sum cells matching criteria' },
    { name: 'SUMIFS',        signature: 'SUMIFS(sum_range, criteria_range1, criteria1, ...)', description: 'Sum with multiple criteria' },
    { name: 'COUNTIF',       signature: 'COUNTIF(range, criteria)',                          description: 'Count cells matching criteria' },
    { name: 'COUNTIFS',      signature: 'COUNTIFS(criteria_range1, criteria1, ...)',         description: 'Count with multiple criteria' },
    { name: 'AVERAGEIF',     signature: 'AVERAGEIF(range, criteria, [average_range])',       description: 'Average cells matching criteria' },
    { name: 'AVERAGEIFS',    signature: 'AVERAGEIFS(average_range, criteria_range1, criteria1, ...)', description: 'Average with multiple criteria' },
    { name: 'MEDIAN',        signature: 'MEDIAN(number1, [number2], ...)',                   description: 'Middle value' },
    { name: 'STDEV',         signature: 'STDEV(number1, [number2], ...)',                    description: 'Sample standard deviation' },
    { name: 'STDEV.S',       signature: 'STDEV.S(number1, [number2], ...)',                  description: 'Sample standard deviation' },
    { name: 'STDEV.P',       signature: 'STDEV.P(number1, [number2], ...)',                  description: 'Population standard deviation' },
    { name: 'STDEVP',        signature: 'STDEVP(number1, [number2], ...)',                   description: 'Population standard deviation' },
    // Dynamic array
    { name: 'FILTER',        signature: 'FILTER(array, include, [if_empty])',                description: 'Return matching rows' },
    { name: 'SORT',          signature: 'SORT(array, [sort_index], [sort_order])',           description: 'Sort an array' },
    { name: 'SORTBY',        signature: 'SORTBY(array, by_array, [sort_order])',             description: 'Sort by another array' },
    { name: 'UNIQUE',        signature: 'UNIQUE(array)',                                     description: 'Distinct values from an array' },
    { name: 'SEQUENCE',      signature: 'SEQUENCE(rows, [cols], [start], [step])',           description: 'Generate a number series' },
    { name: 'RANDARRAY',     signature: 'RANDARRAY([rows], [cols])',                         description: 'Random array of numbers' },
    // Financial
    { name: 'PMT',           signature: 'PMT(rate, nper, pv, [fv], [type])',                 description: 'Loan payment amount' },
    { name: 'NPV',           signature: 'NPV(rate, value1, [value2], ...)',                  description: 'Net present value' },
    { name: 'IRR',           signature: 'IRR(values, [guess])',                              description: 'Internal rate of return' },
];

export const FUNCTIONS: string[] = FUNCTIONS_META.map(f => f.name);

export function functionsList(q: string): FunctionMeta[] {
    const upper = q.toUpperCase();
    if (!upper) return FUNCTIONS_META;
    return FUNCTIONS_META.filter(fn => fn.name.startsWith(upper));
}

// ── Internal value types ────────────────────────────────────────────────────

type FormulaValue = number | string;
/** A range arg is an ordered list of cell IDs (e.g. ["A1","A2","B1","B2"]). */
type RangeArg = string[];
type FuncArg = FormulaValue | RangeArg;

function isRange(arg: FuncArg): arg is RangeArg {
    return Array.isArray(arg);
}

/**
 * Separator used to prefix cross-sheet cell IDs inside RangeArgs.
 * Format: \x01SheetName\x01CellId
 * This character is not valid in sheet names or cell references.
 */
const CROSS_SHEET_SEP = '\x01';

function makeCrossSheetId(sheetName: string, cellId: string): string {
    return `${CROSS_SHEET_SEP}${sheetName}${CROSS_SHEET_SEP}${cellId}`;
}

function getNumValues(arg: FuncArg, data: Map<string, CellProps>): number[] {
    if (isRange(arg)) {
        return arg.map(id => parseFloat(data.get(id)?.value ?? '')).filter(n => !isNaN(n));
    }
    const n = typeof arg === 'number' ? arg : parseFloat(String(arg));
    return isNaN(n) ? [] : [n];
}

function getStrValues(arg: FuncArg, data: Map<string, CellProps>): string[] {
    if (isRange(arg)) return arg.map(id => data.get(id)?.value ?? '');
    return [String(arg === null || arg === undefined ? '' : arg)];
}

function toStr(arg: FuncArg, data: Map<string, CellProps>): string {
    if (isRange(arg)) return data.get(arg[0])?.value ?? '';
    return String(arg === null || arg === undefined ? '' : arg);
}

function toNum(arg: FuncArg): number {
    if (isRange(arg)) return NaN;
    return typeof arg === 'number' ? arg : parseFloat(String(arg));
}

function isTruthy(arg: FuncArg, data: Map<string, CellProps>): boolean {
    if (isRange(arg)) {
        const val = data.get(arg[0])?.value ?? '';
        const n = parseFloat(val);
        return isNaN(n) ? (val !== '' && val.toLowerCase() !== 'false') : n !== 0;
    }
    if (typeof arg === 'number') return arg !== 0;
    const s = String(arg).toLowerCase();
    return s !== '' && s !== 'false' && s !== '0';
}

function isErrorVal(v: FuncArg): boolean {
    return typeof v === 'string' && v.startsWith('#');
}

// ── Date utilities ──────────────────────────────────────────────────────────

/**
 * Parse a date string into a UTC-midnight Date, avoiding timezone offset issues.
 * ISO strings like "2024-06-15" are parsed as UTC so all subsequent getUTC* calls
 * return the correct calendar values in any local timezone.
 */
function parseDate(arg: FuncArg, data: Map<string, CellProps>): Date | null {
    const s = isRange(arg) ? (data.get(arg[0])?.value ?? '') : String(arg);
    if (!s) return null;
    // Parse YYYY-MM-DD (with optional time component) as UTC midnight
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
        return new Date(Date.UTC(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])));
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

/** Format a UTC-midnight Date as "YYYY-MM-DD". */
function dateToStr(d: Date): string {
    const y  = d.getUTCFullYear();
    const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
}

function isWeekend(d: Date): boolean {
    const dow = d.getUTCDay();
    return dow === 0 || dow === 6;
}

// ── Criterion matching for SUMIF/COUNTIF ────────────────────────────────────

function matchesCriterion(cellValue: string, criterion: string): boolean {
    const c = String(criterion);
    // Comparison operators: >=, <=, <>, >, <, =
    const m = c.match(/^(>=|<=|<>|>|<|=)(.*)$/);
    if (m) {
        const op = m[1], rhs = m[2];
        const lhsNum = parseFloat(cellValue), rhsNum = parseFloat(rhs);
        if (!isNaN(lhsNum) && !isNaN(rhsNum)) {
            switch (op) {
                case '>':  return lhsNum > rhsNum;
                case '<':  return lhsNum < rhsNum;
                case '>=': return lhsNum >= rhsNum;
                case '<=': return lhsNum <= rhsNum;
                case '<>': return lhsNum !== rhsNum;
                case '=':  return lhsNum === rhsNum;
            }
        }
        switch (op) {
            case '=':  return cellValue.toLowerCase() === rhs.toLowerCase();
            case '<>': return cellValue.toLowerCase() !== rhs.toLowerCase();
            default:   return false;
        }
    }
    // Wildcard: * = any sequence, ? = single char
    if (c.includes('*') || c.includes('?')) {
        const pattern = '^' +
            c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
             .replace(/\*/g, '.*')
             .replace(/\?/g, '.') +
            '$';
        return new RegExp(pattern, 'i').test(cellValue);
    }
    // Numeric exact match
    const lhsNum = parseFloat(cellValue), rhsNum = parseFloat(c);
    if (!isNaN(lhsNum) && !isNaN(rhsNum)) return lhsNum === rhsNum;
    // Text exact match (case-insensitive)
    return cellValue.toLowerCase() === c.toLowerCase();
}

// ── Range organisation helpers ──────────────────────────────────────────────

function organizeByRow(cells: string[]): string[][] {
    const rowMap = new Map<number, Map<number, string>>();
    for (const id of cells) {
        const mm = id.match(/^([A-Z]+)(\d+)$/);
        if (!mm) continue;
        const col = alphaToNum(mm[1]), row = parseInt(mm[2]);
        if (!rowMap.has(row)) rowMap.set(row, new Map());
        rowMap.get(row)!.set(col, id);
    }
    return [...rowMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, colMap]) =>
            [...colMap.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id),
        );
}

function organizeByCol(cells: string[]): string[][] {
    const colMap = new Map<number, Map<number, string>>();
    for (const id of cells) {
        const mm = id.match(/^([A-Z]+)(\d+)$/);
        if (!mm) continue;
        const col = alphaToNum(mm[1]), row = parseInt(mm[2]);
        if (!colMap.has(col)) colMap.set(col, new Map());
        colMap.get(col)!.set(row, id);
    }
    return [...colMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, rowMap]) =>
            [...rowMap.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id),
        );
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

type Token =
    | { type: 'NUMBER'; value: number }
    | { type: 'STRING'; value: string }
    | { type: 'CELL';   value: string }
    | { type: 'FUNC';   value: string }
    /** Cross-sheet single-cell reference: SheetName!CellId */
    | { type: 'SHEET_CELL'; sheet: string; cell: string }
    /** Cross-sheet range reference: SheetName!StartCell:EndCell */
    | { type: 'SHEET_RANGE'; sheet: string; start: string; end: string }
    | { type: 'PLUS' } | { type: 'MINUS' } | { type: 'STAR' } | { type: 'SLASH' }
    | { type: 'LPAREN' } | { type: 'RPAREN' }
    | { type: 'COMMA' }  | { type: 'COLON' }
    | { type: 'AMPERSAND' }
    | { type: 'EQ' } | { type: 'NEQ' } | { type: 'LT' } | { type: 'GT' }
    | { type: 'LTE' } | { type: 'GTE' };

/**
 * Attempt to read a cell reference (e.g. "C4", "$AB$12") starting at position i
 * in string s. Returns { cell, end } on success or null if no cell ref found.
 */
function tryReadCellRef(s: string, i: number): { cell: string; end: number } | null {
    if (i >= s.length) return null;
    let j = i;
    const dollarCol = s[j] === '$';
    if (dollarCol) j++;
    if (j >= s.length || !/[A-Za-z]/.test(s[j])) return null;
    const colStart = j;
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
    const col = s.slice(colStart, j).toUpperCase();
    const dollarRow = s[j] === '$';
    if (dollarRow) j++;
    if (j >= s.length || !/\d/.test(s[j])) return null;
    let k = j;
    while (k < s.length && /\d/.test(s[k])) k++;
    const row = s.slice(j, k);
    return { cell: `${dollarCol ? '$' : ''}${col}${dollarRow ? '$' : ''}${row}`, end: k };
}

function tokenize(s: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (ch === ' ')  { i++; continue; }
        if (ch === '+')  { tokens.push({ type: 'PLUS' });      i++; continue; }
        if (ch === '-')  { tokens.push({ type: 'MINUS' });     i++; continue; }
        if (ch === '*')  { tokens.push({ type: 'STAR' });      i++; continue; }
        if (ch === '/')  { tokens.push({ type: 'SLASH' });     i++; continue; }
        if (ch === '(')  { tokens.push({ type: 'LPAREN' });    i++; continue; }
        if (ch === ')')  { tokens.push({ type: 'RPAREN' });    i++; continue; }
        if (ch === ',')  { tokens.push({ type: 'COMMA' });     i++; continue; }
        if (ch === ':')  { tokens.push({ type: 'COLON' });     i++; continue; }
        if (ch === '&')  { tokens.push({ type: 'AMPERSAND' }); i++; continue; }
        if (ch === '<') {
            if (s[i + 1] === '=')      { tokens.push({ type: 'LTE' }); i += 2; }
            else if (s[i + 1] === '>') { tokens.push({ type: 'NEQ' }); i += 2; }
            else                       { tokens.push({ type: 'LT'  }); i++; }
            continue;
        }
        if (ch === '>') {
            if (s[i + 1] === '=') { tokens.push({ type: 'GTE' }); i += 2; }
            else                  { tokens.push({ type: 'GT'  }); i++; }
            continue;
        }
        if (ch === '=') { tokens.push({ type: 'EQ' }); i++; continue; }
        if (ch === '"') {
            let j = i + 1, str = '';
            while (j < s.length && s[j] !== '"') str += s[j++];
            tokens.push({ type: 'STRING', value: str });
            i = j + 1;
            continue;
        }
        // Single-quoted sheet name: 'Sheet Name'!CellRef
        if (ch === "'") {
            let j = i + 1, sheetName = '';
            while (j < s.length && s[j] !== "'") sheetName += s[j++];
            if (s[j] === "'" && s[j + 1] === '!') {
                // Found 'SheetName'!
                const afterBang = j + 2;
                const cellRef = tryReadCellRef(s, afterBang);
                if (cellRef) {
                    // Check for range: 'SheetName'!A1:B3
                    if (s[cellRef.end] === ':') {
                        const endRef = tryReadCellRef(s, cellRef.end + 1);
                        if (endRef) {
                            tokens.push({ type: 'SHEET_RANGE', sheet: sheetName, start: cellRef.cell, end: endRef.cell });
                            i = endRef.end;
                            continue;
                        }
                    }
                    tokens.push({ type: 'SHEET_CELL', sheet: sheetName, cell: cellRef.cell });
                    i = cellRef.end;
                    continue;
                }
            }
            // Not a valid quoted sheet ref — skip the character
            i++;
            continue;
        }
        if (/\d/.test(ch)) {
            let j = i;
            while (j < s.length && /[\d.]/.test(s[j])) j++;
            tokens.push({ type: 'NUMBER', value: parseFloat(s.slice(i, j)) });
            i = j; continue;
        }
        // $ — starts an absolute column reference ($A1, $A$1) or absolute row
        // only ($A already consumed — handled in the letter branch below).
        // When a bare $ precedes a letter we treat it as beginning a cell ref.
        if (ch === '$' && i + 1 < s.length && /[A-Za-z]/.test(s[i + 1])) {
            // Read the optional leading $ (already at i), then column letters
            let j = i + 1; // skip $
            while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
            // Must be followed by optional $ then digits to be a cell ref
            let k = j;
            if (k < s.length && s[k] === '$') k++; // skip optional row $
            if (k < s.length && /\d/.test(s[k])) {
                while (k < s.length && /\d/.test(s[k])) k++;
                // Build the cell ref string preserving $ markers
                const colPart = '$' + s.slice(i + 1, j).toUpperCase();
                const dollarRow = (s[j] === '$') ? '$' : '';
                const rowPart = dollarRow + s.slice(j + (dollarRow ? 1 : 0), k);
                tokens.push({ type: 'CELL', value: colPart + rowPart });
                i = k; continue;
            }
            // Not a valid cell ref — skip $
            i++; continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < s.length && /[A-Za-z_]/.test(s[j])) j++;
            let name = s.slice(i, j).toUpperCase();
            let end = j;
            // Handle dotted names like STDEV.P
            if (s[end] === '.') {
                let k = end + 1;
                while (k < s.length && /[A-Za-z]/.test(s[k])) k++;
                if (k > end + 1) { name = name + '.' + s.slice(end + 1, k).toUpperCase(); end = k; }
            }
            // TRUE / FALSE keywords
            if (name === 'TRUE')  { tokens.push({ type: 'NUMBER', value: 1 }); i = end; continue; }
            if (name === 'FALSE') { tokens.push({ type: 'NUMBER', value: 0 }); i = end; continue; }
            // Function call?
            if (s[end] === '(') { tokens.push({ type: 'FUNC', value: name }); i = end; continue; }
            // Cell reference: letters immediately followed by optional-$ then digits
            // e.g. A1, A$1
            if (s[j] === '$' && /\d/.test(s[j + 1])) {
                // Row-anchored: COL$ROW
                let k = j + 1;
                while (k < s.length && /\d/.test(s[k])) k++;
                tokens.push({ type: 'CELL', value: s.slice(i, j).toUpperCase() + '$' + s.slice(j + 1, k) });
                i = k; continue;
            }
            // Cross-sheet reference: Identifier followed by ! — e.g. Beta!C4
            if (s[end] === '!') {
                const afterBang = end + 1;
                const cellRef = tryReadCellRef(s, afterBang);
                if (cellRef) {
                    // The sheet name is the original (non-uppercased) slice
                    const sheetName = s.slice(i, end);
                    // Check for range: Beta!A1:B3
                    if (s[cellRef.end] === ':') {
                        const endRef = tryReadCellRef(s, cellRef.end + 1);
                        if (endRef) {
                            tokens.push({ type: 'SHEET_RANGE', sheet: sheetName, start: cellRef.cell, end: endRef.cell });
                            i = endRef.end;
                            continue;
                        }
                    }
                    tokens.push({ type: 'SHEET_CELL', sheet: sheetName, cell: cellRef.cell });
                    i = cellRef.end;
                    continue;
                }
            }
            // Cell reference: letters immediately followed by digits
            if (/\d/.test(s[j])) {
                let k = j;
                while (k < s.length && /\d/.test(s[k])) k++;
                tokens.push({ type: 'CELL', value: (s.slice(i, j) + s.slice(j, k)).toUpperCase() });
                i = k; continue;
            }
            // Plain identifier treated as a cell name
            tokens.push({ type: 'CELL', value: name });
            i = end; continue;
        }
        i++;
    }
    return tokens;
}

// ── Parser ──────────────────────────────────────────────────────────────────

export interface SheetRef {
    name: string;
    data: Map<string, CellProps>;
}

class FormulaParser {
    private pos = 0;
    /**
     * The merged data map: starts as the active sheet's data, extended on demand
     * with cross-sheet cell entries keyed as \x01SheetName\x01CellId.
     * We lazily extend it in parsePrimary/parseFuncArg when cross-sheet tokens appear.
     */
    private mergedData: Map<string, CellProps>;

    constructor(
        private tokens: Token[],
        private data: Map<string, CellProps>,
        private allSheets?: SheetRef[],
    ) {
        // Start with a reference to the active sheet's data.
        // We will extend this map when cross-sheet references are encountered.
        this.mergedData = data;
    }

    /**
     * Find a sheet by name (case-insensitive). Returns null if not found.
     * Used by cross-sheet reference resolution.
     */
    private findSheet(name: string): Map<string, CellProps> | null {
        if (!this.allSheets) return null;
        const lower = name.toLowerCase();
        const found = this.allSheets.find(s => s.name.toLowerCase() === lower);
        return found?.data ?? null;
    }

    /**
     * Ensure that the cells of a foreign sheet are populated in mergedData
     * under namespaced keys. Returns the namespaced cell IDs for the given cellIds.
     * If the sheet is not found, returns null.
     */
    private ensureCrossSheetCells(sheetName: string, cellIds: string[]): string[] | null {
        const sheetData = this.findSheet(sheetName);
        if (!sheetData) return null;
        // Lazily copy the active data into a new map only the first time we need to extend it.
        if (this.mergedData === this.data) {
            this.mergedData = new Map(this.data);
        }
        const namespacedIds: string[] = [];
        for (const cellId of cellIds) {
            const plainCellId = cellId.replace(/\$/g, '');
            const nsId = makeCrossSheetId(sheetName, plainCellId);
            if (!this.mergedData.has(nsId)) {
                const cell = sheetData.get(plainCellId);
                if (cell) {
                    this.mergedData.set(nsId, { ...cell, id: nsId });
                } else {
                    // Cell doesn't exist — provide an empty placeholder so functions get '' / 0.
                    this.mergedData.set(nsId, { id: nsId, value: '', raw: '', edit: false });
                }
            }
            namespacedIds.push(nsId);
        }
        return namespacedIds;
    }

    private peek(): Token | undefined { return this.tokens[this.pos]; }
    private consume(): Token { return this.tokens[this.pos++]; }

    // Operator precedence (lowest → highest):
    //   comparison → string-concat (&) → add/sub → mul/div → unary → primary

    parseExpr(): FormulaValue {
        let left = this.parseConcat();
        const CMP = ['EQ', 'NEQ', 'LT', 'GT', 'LTE', 'GTE'] as const;
        while (this.peek() && CMP.includes(this.peek()!.type as typeof CMP[number])) {
            const op = this.consume();
            const right = this.parseConcat();
            const lStr = String(left).toLowerCase(), rStr = String(right).toLowerCase();
            const lNum = typeof left  === 'number' ? left  : parseFloat(String(left));
            const rNum = typeof right === 'number' ? right : parseFloat(String(right));
            const numCmp = !isNaN(lNum) && !isNaN(rNum);
            switch (op.type) {
                case 'EQ':  left = (numCmp ? lNum === rNum : lStr === rStr) ? 1 : 0; break;
                case 'NEQ': left = (numCmp ? lNum !== rNum : lStr !== rStr) ? 1 : 0; break;
                case 'LT':  left = (numCmp ? lNum <  rNum : lStr <  rStr)  ? 1 : 0; break;
                case 'GT':  left = (numCmp ? lNum >  rNum : lStr >  rStr)  ? 1 : 0; break;
                case 'LTE': left = (numCmp ? lNum <= rNum : lStr <= rStr)  ? 1 : 0; break;
                case 'GTE': left = (numCmp ? lNum >= rNum : lStr >= rStr)  ? 1 : 0; break;
            }
        }
        return left;
    }

    private parseConcat(): FormulaValue {
        let left = this.parseAdd();
        while (this.peek()?.type === 'AMPERSAND') {
            this.consume();
            left = String(left) + String(this.parseAdd());
        }
        return left;
    }

    /** Coerce a value to a number for arithmetic. Empty string (empty cell) → 0. */
    private coerceNum(v: FormulaValue): number {
        if (typeof v === 'number') return v;
        const s = String(v);
        if (s === '') return 0;
        return parseFloat(s);
    }

    private parseAdd(): FormulaValue {
        let left = this.parseMul();
        while (this.peek()?.type === 'PLUS' || this.peek()?.type === 'MINUS') {
            const op = this.consume();
            const right = this.parseMul();
            const l = this.coerceNum(left);
            const r = this.coerceNum(right);
            left = op.type === 'PLUS' ? l + r : l - r;
        }
        return left;
    }

    private parseMul(): FormulaValue {
        let left = this.parseUnary();
        while (this.peek()?.type === 'STAR' || this.peek()?.type === 'SLASH') {
            const op = this.consume();
            const right = this.parseUnary();
            const l = this.coerceNum(left);
            const r = this.coerceNum(right);
            if (op.type === 'SLASH') { left = r === 0 ? '#DIV/0!' : l / r; }
            else { left = l * r; }
        }
        return left;
    }

    private parseUnary(): FormulaValue {
        if (this.peek()?.type === 'MINUS') {
            this.consume();
            const v = this.parsePrimary();
            return -this.coerceNum(v);
        }
        return this.parsePrimary();
    }

    private parsePrimary(): FormulaValue {
        const tok = this.peek();
        if (!tok) return 0;
        if (tok.type === 'NUMBER') { this.consume(); return tok.value; }
        if (tok.type === 'STRING') { this.consume(); return tok.value; }
        if (tok.type === 'CELL') {
            this.consume();
            // Strip $ markers to get the plain cell ID for data lookup
            const cellId = tok.value.replace(/\$/g, '');
            const raw = this.data.get(cellId)?.value ?? '';
            const n = parseFloat(raw);
            return isNaN(n) ? raw : n;
        }
        if (tok.type === 'SHEET_CELL') {
            this.consume();
            const nsIds = this.ensureCrossSheetCells(tok.sheet, [tok.cell]);
            if (!nsIds) return '#REF!';
            const raw = this.mergedData.get(nsIds[0])?.value ?? '';
            const n = parseFloat(raw);
            return isNaN(n) ? raw : n;
        }
        if (tok.type === 'SHEET_RANGE') {
            // A bare SHEET_RANGE outside a function argument context — return the
            // top-left cell value (consistent with how bare ranges work in Excel).
            this.consume();
            const cells = expandRange(tok.start.replace(/\$/g, ''), tok.end.replace(/\$/g, ''));
            const nsIds = this.ensureCrossSheetCells(tok.sheet, cells);
            if (!nsIds) return '#REF!';
            const raw = nsIds.length > 0 ? (this.mergedData.get(nsIds[0])?.value ?? '') : '';
            const n = parseFloat(raw);
            return isNaN(n) ? raw : n;
        }
        if (tok.type === 'FUNC') {
            this.consume();          // FUNC name
            this.consume();          // LPAREN
            const args = this.parseFuncArgs();
            this.consume();          // RPAREN
            return this.applyFunc(tok.value, args);
        }
        if (tok.type === 'LPAREN') {
            this.consume();
            const v = this.parseExpr();
            if (this.peek()?.type === 'RPAREN') this.consume();
            return v;
        }
        return 0;
    }

    private parseFuncArgs(): FuncArg[] {
        const args: FuncArg[] = [];
        if (this.peek()?.type === 'RPAREN') return args;
        args.push(this.parseFuncArg());
        while (this.peek()?.type === 'COMMA') {
            this.consume();
            args.push(this.parseFuncArg());
        }
        return args;
    }

    /**
     * A function argument is:
     *   - A range (CELL:CELL) → returned as string[] of cell IDs
     *   - A bare cell (CELL followed by COMMA, RPAREN, or end) → returned as
     *     single-element string[] so functions can access the cell ID for OFFSET etc.
     *   - A cross-sheet range (SHEET_RANGE) → returned as string[] of namespaced cell IDs
     *   - A cross-sheet cell (SHEET_CELL) → returned as single-element string[] of namespaced ID
     *   - Anything else → evaluated as an expression
     */
    private parseFuncArg(): FuncArg {
        const tok = this.peek();
        if (tok?.type === 'CELL') {
            const next = this.tokens[this.pos + 1];
            if (next?.type === 'COLON') {
                // Range: A1:B6 (may have $ markers)
                const startRaw = (this.consume() as { type: 'CELL'; value: string }).value;
                this.consume(); // COLON
                const endRaw   = (this.consume() as { type: 'CELL'; value: string }).value;
                // Strip $ for range expansion; the data map uses plain cell IDs
                return expandRange(startRaw.replace(/\$/g, ''), endRaw.replace(/\$/g, ''));
            }
            // Bare cell (not part of an arithmetic / comparison expression)
            if (!next || next.type === 'COMMA' || next.type === 'RPAREN') {
                const cellRaw = (this.consume() as { type: 'CELL'; value: string }).value;
                // Strip $ for data map lookup
                return [cellRaw.replace(/\$/g, '')];
            }
        }
        if (tok?.type === 'SHEET_RANGE') {
            this.consume();
            const cells = expandRange(tok.start.replace(/\$/g, ''), tok.end.replace(/\$/g, ''));
            const nsIds = this.ensureCrossSheetCells(tok.sheet, cells);
            // Return #REF! placeholder IDs if sheet not found — functions will
            // get empty values from mergedData lookups, which is safe.
            return nsIds ?? [];
        }
        if (tok?.type === 'SHEET_CELL') {
            this.consume();
            const nsIds = this.ensureCrossSheetCells(tok.sheet, [tok.cell]);
            return nsIds ?? [];
        }
        return this.parseExpr();
    }

    private applyFunc(name: string, args: FuncArg[]): FormulaValue {
        try { return this._applyFunc(name, args); }
        catch { return '#ERROR!'; }
    }

    private _applyFunc(name: string, args: FuncArg[]): FormulaValue {
        const data = this.mergedData;
        const nums  = (a: FuncArg) => getNumValues(a, data);
        const strs  = (a: FuncArg) => getStrValues(a, data);
        const str   = (a: FuncArg) => toStr(a, data);
        const num   = (a: FuncArg) => toNum(a);
        const bool  = (a: FuncArg) => isTruthy(a, data);
        const allNums = (...as: FuncArg[]) => as.flatMap(a => nums(a));

        switch (name) {
            // ── Math ──────────────────────────────────────────────────────
            case 'SUM':       return allNums(...args).reduce((s, v) => s + v, 0);
            case 'AVERAGE': {
                const ns = allNums(...args);
                return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : 0;
            }
            case 'COUNT':  return allNums(...args).length;
            case 'COUNTA': return args.flatMap(a => strs(a)).filter(v => v !== '').length;
            case 'MAX': { const ns = allNums(...args); return ns.length ? Math.max(...ns) : 0; }
            case 'MIN': { const ns = allNums(...args); return ns.length ? Math.min(...ns) : 0; }
            case 'ROUND': {
                const dp = num(args[1] ?? 0), f = Math.pow(10, dp);
                return Math.round(num(args[0]) * f) / f;
            }
            case 'ROUNDUP': {
                const dp = num(args[1] ?? 0), f = Math.pow(10, dp);
                return Math.ceil(num(args[0]) * f) / f;
            }
            case 'ROUNDDOWN': {
                const dp = num(args[1] ?? 0), f = Math.pow(10, dp);
                return Math.floor(num(args[0]) * f) / f;
            }
            case 'ABS': return Math.abs(num(args[0]));
            case 'MOD': {
                const d = num(args[1]);
                if (d === 0) return '#DIV/0!';
                return num(args[0]) % d;
            }

            // ── Logical ───────────────────────────────────────────────────
            case 'IF': {
                const cond = bool(args[0]);
                const branch = cond ? args[1] : (args[2] ?? 0);
                if (branch === undefined) return 0;
                if (isRange(branch)) return data.get(branch[0])?.value ?? '';
                return branch as FormulaValue;
            }
            case 'IFS': {
                for (let i = 0; i + 1 < args.length; i += 2) {
                    if (bool(args[i])) {
                        const v = args[i + 1];
                        return isRange(v) ? (data.get(v[0])?.value ?? '') : (v as FormulaValue);
                    }
                }
                return '#N/A';
            }
            case 'AND': return args.every(a => bool(a)) ? 1 : 0;
            case 'OR':  return args.some(a => bool(a))  ? 1 : 0;
            case 'NOT': return bool(args[0]) ? 0 : 1;
            case 'IFERROR': {
                const v = args[0];
                if (isErrorVal(v)) {
                    const fb = args[1] ?? '';
                    return isRange(fb) ? (data.get(fb[0])?.value ?? '') : (fb as FormulaValue);
                }
                return isRange(v) ? (data.get(v[0])?.value ?? '') : (v as FormulaValue);
            }

            // ── Lookup & reference ────────────────────────────────────────
            case 'VLOOKUP': {
                const lookupVal = str(args[0]);
                const tableRange = isRange(args[1]) ? (args[1] as string[]) : [];
                const colIdx = num(args[2]) - 1;
                const exact = args[3] !== undefined ? !bool(args[3]) : true;
                if (!tableRange.length) return '#N/A';
                const rows = organizeByRow(tableRange);
                if (exact) {
                    for (const row of rows) {
                        const fv = data.get(row[0])?.value ?? '';
                        const numMatch = !isNaN(parseFloat(lookupVal)) && parseFloat(fv) === parseFloat(lookupVal);
                        if (numMatch || fv.toLowerCase() === lookupVal.toLowerCase()) {
                            return data.get(row[colIdx])?.value ?? '#N/A';
                        }
                    }
                    return '#N/A';
                }
                let best: string | undefined;
                const lNum = parseFloat(lookupVal);
                for (const row of rows) {
                    const fv = parseFloat(data.get(row[0])?.value ?? '');
                    if (!isNaN(fv) && fv <= lNum) best = data.get(row[colIdx])?.value;
                    else break;
                }
                return best ?? '#N/A';
            }
            case 'HLOOKUP': {
                const lookupVal = str(args[0]);
                const tableRange = isRange(args[1]) ? (args[1] as string[]) : [];
                const rowIdx = num(args[2]) - 1;
                const exact = args[3] !== undefined ? !bool(args[3]) : true;
                if (!tableRange.length) return '#N/A';
                const cols = organizeByCol(tableRange);
                for (const col of cols) {
                    const fv = data.get(col[0])?.value ?? '';
                    const numMatch = !isNaN(parseFloat(lookupVal)) && parseFloat(fv) === parseFloat(lookupVal);
                    if (exact ? (numMatch || fv.toLowerCase() === lookupVal.toLowerCase()) : parseFloat(fv) <= parseFloat(lookupVal)) {
                        return data.get(col[rowIdx])?.value ?? '#N/A';
                    }
                }
                return '#N/A';
            }
            case 'XLOOKUP': {
                const sv = str(args[0]);
                const lr = isRange(args[1]) ? (args[1] as string[]) : [];
                const rr = isRange(args[2]) ? (args[2] as string[]) : [];
                const nf = args[3] !== undefined ? str(args[3]) : '#N/A';
                for (let i = 0; i < lr.length; i++) {
                    const cv = data.get(lr[i])?.value ?? '';
                    const numMatch = !isNaN(parseFloat(sv)) && parseFloat(cv) === parseFloat(sv);
                    if (numMatch || cv.toLowerCase() === sv.toLowerCase()) {
                        return rr[i] !== undefined ? (data.get(rr[i])?.value ?? '') : '';
                    }
                }
                return nf;
            }
            case 'INDEX': {
                const range = isRange(args[0]) ? (args[0] as string[]) : [];
                const rowNum = num(args[1]);
                const colNum = args[2] !== undefined ? num(args[2]) : 1;
                const rows = organizeByRow(range);
                const row = rows[rowNum - 1];
                if (!row) return '#REF!';
                const cell = row[colNum - 1];
                return cell ? (data.get(cell)?.value ?? '') : '#REF!';
            }
            case 'MATCH': {
                const sv = str(args[0]);
                const range = isRange(args[1]) ? (args[1] as string[]) : [];
                const mt = args[2] !== undefined ? num(args[2]) : 0;
                if (mt === 0) {
                    for (let i = 0; i < range.length; i++) {
                        const cv = data.get(range[i])?.value ?? '';
                        const numMatch = !isNaN(parseFloat(sv)) && parseFloat(cv) === parseFloat(sv);
                        if (numMatch || cv.toLowerCase() === sv.toLowerCase()) return i + 1;
                    }
                    return '#N/A';
                }
                const sn = parseFloat(sv);
                let result = -1;
                for (let i = 0; i < range.length; i++) {
                    const cn = parseFloat(data.get(range[i])?.value ?? '');
                    if (mt === 1 && !isNaN(cn) && !isNaN(sn) && cn <= sn) result = i + 1;
                    else if (mt === -1 && !isNaN(cn) && !isNaN(sn) && cn >= sn) { return i + 1; }
                }
                return result === -1 ? '#N/A' : result;
            }
            case 'OFFSET': {
                const refArr = isRange(args[0]) ? (args[0] as string[]) : [];
                if (!refArr.length) return '#REF!';
                const mm = refArr[0].match(/^([A-Z]+)(\d+)$/);
                if (!mm) return '#REF!';
                const col = alphaToNum(mm[1]) + num(args[1]);
                const row = parseInt(mm[2])   + num(args[2]);
                if (col < 1 || row < 1) return '#REF!';
                return data.get(`${numToAlpha(col)}${row}`)?.value ?? '';
            }

            // ── Text ──────────────────────────────────────────────────────
            case 'CONCAT':
            case 'CONCATENATE':
                return args.map(a => strs(a).join('')).join('');
            case 'TEXTJOIN': {
                const delim = str(args[0]);
                const ignoreEmpty = bool(args[1]);
                const vals = args.slice(2).flatMap(a => strs(a));
                return (ignoreEmpty ? vals.filter(v => v !== '') : vals).join(delim);
            }
            case 'LEFT': {
                const s = str(args[0]);
                return s.slice(0, Math.max(0, num(args[1] ?? 1)));
            }
            case 'RIGHT': {
                const s = str(args[0]);
                const n2 = args[1] !== undefined ? num(args[1]) : 1;
                return s.slice(Math.max(0, s.length - n2));
            }
            case 'MID': {
                const s = str(args[0]);
                const start = num(args[1]) - 1;
                return s.slice(Math.max(0, start), start + num(args[2]));
            }
            case 'LEN':   return str(args[0]).length;
            case 'TRIM':  return str(args[0]).replace(/\s+/g, ' ').trim();
            case 'UPPER': return str(args[0]).toUpperCase();
            case 'LOWER': return str(args[0]).toLowerCase();
            case 'PROPER':
                return str(args[0]).toLowerCase().replace(/(?:^|[\s\-'])./g, c => c.toUpperCase());
            case 'SUBSTITUTE': {
                const s = str(args[0]), old = str(args[1]), rep = str(args[2]);
                if (!old) return s;
                if (args[3] === undefined) return s.split(old).join(rep);
                const occ = num(args[3]);
                let cnt = 0;
                return s.replace(
                    new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    m => { cnt++; return cnt === occ ? rep : m; },
                );
            }
            case 'FIND': {
                const find = str(args[0]), within = str(args[1]);
                const start = args[2] !== undefined ? num(args[2]) - 1 : 0;
                const pos = within.indexOf(find, start);
                return pos === -1 ? '#VALUE!' : pos + 1;
            }
            case 'SEARCH': {
                const pat = str(args[0]).replace(/[.+^${}()|[\]\\]/g, '\\$&')
                                        .replace(/\*/g, '.*').replace(/\?/g, '.');
                const within = str(args[1]);
                const start = args[2] !== undefined ? num(args[2]) - 1 : 0;
                const m2 = new RegExp(pat, 'i').exec(within.slice(start));
                return m2 ? m2.index + start + 1 : '#VALUE!';
            }

            // ── Date & time ───────────────────────────────────────────────
            case 'TODAY': {
                const now = new Date();
                return dateToStr(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
            }
            case 'NOW':   return new Date().toISOString().replace('T', ' ').slice(0, 19);
            case 'DATE': {
                const y = num(args[0]), mo = num(args[1]), d2 = num(args[2]);
                return dateToStr(new Date(Date.UTC(y, mo - 1, d2)));
            }
            case 'YEAR': {
                const d = parseDate(args[0], data);
                return d ? d.getUTCFullYear() : '#VALUE!';
            }
            case 'MONTH': {
                const d = parseDate(args[0], data);
                return d ? d.getUTCMonth() + 1 : '#VALUE!';
            }
            case 'DAY': {
                const d = parseDate(args[0], data);
                return d ? d.getUTCDate() : '#VALUE!';
            }
            case 'DATEDIF': {
                const d1 = parseDate(args[0], data), d2 = parseDate(args[1], data);
                const unit = str(args[2]).toUpperCase();
                if (!d1 || !d2) return '#VALUE!';
                const utcDiff = (a: Date, b: Date) =>
                    Math.floor((b.getTime() - a.getTime()) / 86400000);
                switch (unit) {
                    case 'D':  return utcDiff(d1, d2);
                    case 'M': {
                        let mo = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth());
                        if (d2.getUTCDate() < d1.getUTCDate()) mo--;
                        return mo;
                    }
                    case 'Y': {
                        let yr = d2.getUTCFullYear() - d1.getUTCFullYear();
                        if (d2.getUTCMonth() < d1.getUTCMonth() ||
                            (d2.getUTCMonth() === d1.getUTCMonth() && d2.getUTCDate() < d1.getUTCDate())) yr--;
                        return yr;
                    }
                    case 'MD': {
                        const day2 = d2.getUTCDate(), day1 = d1.getUTCDate();
                        if (day2 >= day1) return day2 - day1;
                        return new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), 0)).getUTCDate() - day1 + day2;
                    }
                    case 'YM': {
                        let mo = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth());
                        if (d2.getUTCDate() < d1.getUTCDate()) mo--;
                        return ((mo % 12) + 12) % 12;
                    }
                    case 'YD': {
                        let refMs = Date.UTC(d2.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate());
                        if (refMs > d2.getTime()) refMs = Date.UTC(d2.getUTCFullYear() - 1, d1.getUTCMonth(), d1.getUTCDate());
                        return Math.floor((d2.getTime() - refMs) / 86400000);
                    }
                    default: return '#VALUE!';
                }
            }
            case 'EOMONTH': {
                const d = parseDate(args[0], data);
                if (!d) return '#VALUE!';
                return dateToStr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + num(args[1]) + 1, 0)));
            }
            case 'WORKDAY': {
                const d = parseDate(args[0], data);
                if (!d) return '#VALUE!';
                let days = Math.round(num(args[1]));
                const dir = days >= 0 ? 1 : -1;
                days = Math.abs(days);
                let ms = d.getTime();
                while (days > 0) {
                    ms += dir * 86400000;
                    if (!isWeekend(new Date(ms))) days--;
                }
                return dateToStr(new Date(ms));
            }
            case 'NETWORKDAYS': {
                const d1 = parseDate(args[0], data), d2 = parseDate(args[1], data);
                if (!d1 || !d2) return '#VALUE!';
                const [sMs, eMs] = d1 <= d2
                    ? [d1.getTime(), d2.getTime()]
                    : [d2.getTime(), d1.getTime()];
                let count = 0;
                for (let ms = sMs; ms <= eMs; ms += 86400000) {
                    if (!isWeekend(new Date(ms))) count++;
                }
                return d1 <= d2 ? count : -count;
            }

            // ── Statistical ───────────────────────────────────────────────
            case 'SUMIF': {
                const range   = isRange(args[0]) ? (args[0] as string[]) : [];
                const crit    = str(args[1]);
                const sumRange = isRange(args[2]) ? (args[2] as string[]) : range;
                let total = 0;
                for (let i = 0; i < range.length; i++) {
                    if (matchesCriterion(data.get(range[i])?.value ?? '', crit)) {
                        const n2 = parseFloat(data.get(sumRange[i] ?? range[i])?.value ?? '');
                        if (!isNaN(n2)) total += n2;
                    }
                }
                return total;
            }
            case 'SUMIFS': {
                if (!isRange(args[0])) return '#VALUE!';
                const sumRange = args[0] as string[];
                let total = 0;
                for (let i = 0; i < sumRange.length; i++) {
                    let ok = true;
                    for (let j = 1; j + 1 < args.length; j += 2) {
                        if (!isRange(args[j])) { ok = false; break; }
                        if (!matchesCriterion(data.get((args[j] as string[])[i])?.value ?? '', str(args[j + 1]))) { ok = false; break; }
                    }
                    if (ok) { const n2 = parseFloat(data.get(sumRange[i])?.value ?? ''); if (!isNaN(n2)) total += n2; }
                }
                return total;
            }
            case 'COUNTIF': {
                const range = isRange(args[0]) ? (args[0] as string[]) : [];
                const crit = str(args[1]);
                return range.filter(id => matchesCriterion(data.get(id)?.value ?? '', crit)).length;
            }
            case 'COUNTIFS': {
                if (!isRange(args[0])) return 0;
                const firstRange = args[0] as string[];
                let count = 0;
                for (let i = 0; i < firstRange.length; i++) {
                    let ok = true;
                    for (let j = 0; j + 1 < args.length; j += 2) {
                        if (!isRange(args[j])) { ok = false; break; }
                        if (!matchesCriterion(data.get((args[j] as string[])[i])?.value ?? '', str(args[j + 1]))) { ok = false; break; }
                    }
                    if (ok) count++;
                }
                return count;
            }
            case 'AVERAGEIF': {
                const range   = isRange(args[0]) ? (args[0] as string[]) : [];
                const crit    = str(args[1]);
                const avgRange = isRange(args[2]) ? (args[2] as string[]) : range;
                let total = 0, cnt = 0;
                for (let i = 0; i < range.length; i++) {
                    if (matchesCriterion(data.get(range[i])?.value ?? '', crit)) {
                        const n2 = parseFloat(data.get(avgRange[i] ?? range[i])?.value ?? '');
                        if (!isNaN(n2)) { total += n2; cnt++; }
                    }
                }
                return cnt === 0 ? '#DIV/0!' : total / cnt;
            }
            case 'AVERAGEIFS': {
                if (!isRange(args[0])) return '#VALUE!';
                const avgRange = args[0] as string[];
                let total = 0, cnt = 0;
                for (let i = 0; i < avgRange.length; i++) {
                    let ok = true;
                    for (let j = 1; j + 1 < args.length; j += 2) {
                        if (!isRange(args[j])) { ok = false; break; }
                        if (!matchesCriterion(data.get((args[j] as string[])[i])?.value ?? '', str(args[j + 1]))) { ok = false; break; }
                    }
                    if (ok) { const n2 = parseFloat(data.get(avgRange[i])?.value ?? ''); if (!isNaN(n2)) { total += n2; cnt++; } }
                }
                return cnt === 0 ? '#DIV/0!' : total / cnt;
            }
            case 'MEDIAN': {
                const ns = allNums(...args).sort((a, b) => a - b);
                if (!ns.length) return 0;
                const mid = Math.floor(ns.length / 2);
                return ns.length % 2 !== 0 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
            }
            case 'STDEV':
            case 'STDEV.S': {
                const ns = allNums(...args);
                if (ns.length < 2) return 0;
                const mean = ns.reduce((s, v) => s + v, 0) / ns.length;
                return Math.sqrt(ns.reduce((s, v) => s + (v - mean) ** 2, 0) / (ns.length - 1));
            }
            case 'STDEV.P':
            case 'STDEVP': {
                const ns = allNums(...args);
                if (!ns.length) return 0;
                const mean = ns.reduce((s, v) => s + v, 0) / ns.length;
                return Math.sqrt(ns.reduce((s, v) => s + (v - mean) ** 2, 0) / ns.length);
            }

            // ── Dynamic array (scalar representation) ────────────────────
            case 'FILTER': {
                const arr     = isRange(args[0]) ? (args[0] as string[]) : [];
                const include = isRange(args[1]) ? (args[1] as string[]) : [];
                const ifEmpty = args[2] !== undefined ? str(args[2]) : '#CALC!';
                const results: string[] = [];
                for (let i = 0; i < arr.length; i++) {
                    const v = data.get(include[i] ?? '')?.value ?? '';
                    const n2 = parseFloat(v);
                    if (isNaN(n2) ? (v !== '' && v.toLowerCase() !== 'false') : n2 !== 0) {
                        results.push(data.get(arr[i])?.value ?? '');
                    }
                }
                return results.length ? results.join(', ') : ifEmpty;
            }
            case 'SORT': {
                const arr = isRange(args[0]) ? (args[0] as string[]) : [];
                const order = args[2] !== undefined ? num(args[2]) : 1;
                const vals = arr.map(id => ({ s: data.get(id)?.value ?? '', n: parseFloat(data.get(id)?.value ?? '') }));
                vals.sort((a, b) => {
                    if (!isNaN(a.n) && !isNaN(b.n)) return order >= 0 ? a.n - b.n : b.n - a.n;
                    return order >= 0 ? a.s.localeCompare(b.s) : b.s.localeCompare(a.s);
                });
                return vals.map(v => v.s).join(', ');
            }
            case 'SORTBY': {
                const arr = isRange(args[0]) ? (args[0] as string[]) : [];
                const by  = isRange(args[1]) ? (args[1] as string[]) : [];
                const order = args[2] !== undefined ? num(args[2]) : 1;
                const pairs = arr.map((id, i) => ({
                    val: data.get(id)?.value ?? '',
                    key: data.get(by[i])?.value ?? '',
                    keyN: parseFloat(data.get(by[i])?.value ?? ''),
                }));
                pairs.sort((a, b) => {
                    if (!isNaN(a.keyN) && !isNaN(b.keyN)) return order >= 0 ? a.keyN - b.keyN : b.keyN - a.keyN;
                    return order >= 0 ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key);
                });
                return pairs.map(p => p.val).join(', ');
            }
            case 'UNIQUE': {
                const arr = isRange(args[0]) ? (args[0] as string[]) : [];
                const seen = new Set<string>();
                const out: string[] = [];
                for (const id of arr) {
                    const v = data.get(id)?.value ?? '';
                    if (!seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
                }
                return out.join(', ');
            }
            case 'SEQUENCE': {
                const rows  = num(args[0]);
                const cols  = args[1] !== undefined ? num(args[1]) : 1;
                const start = args[2] !== undefined ? num(args[2]) : 1;
                const step  = args[3] !== undefined ? num(args[3]) : 1;
                const out2: number[] = [];
                for (let i = 0; i < rows * cols; i++) out2.push(start + i * step);
                return out2.join(', ');
            }
            case 'RANDARRAY': {
                const rows = args[0] !== undefined ? num(args[0]) : 1;
                const cols = args[1] !== undefined ? num(args[1]) : 1;
                const out3: string[] = [];
                for (let i = 0; i < rows * cols; i++) out3.push(Math.random().toFixed(6));
                return out3.join(', ');
            }

            // ── Financial ─────────────────────────────────────────────────
            case 'PMT': {
                const rate = num(args[0]), nper = num(args[1]), pv = num(args[2]);
                const fv   = args[3] !== undefined ? num(args[3]) : 0;
                const type = args[4] !== undefined ? num(args[4]) : 0;
                if (rate === 0) return -(pv + fv) / nper;
                const factor = Math.pow(1 + rate, nper);
                return -(pv * factor + fv) * rate / ((factor - 1) * (1 + type * rate));
            }
            case 'NPV': {
                const rate = num(args[0]);
                const vals = args.slice(1).flatMap(a => nums(a));
                return vals.reduce((s, v, i) => s + v / Math.pow(1 + rate, i + 1), 0);
            }
            case 'IRR': {
                const vals = isRange(args[0]) ? getNumValues(args[0], data) : [];
                if (!vals.length) return '#NUM!';
                let r = args[1] !== undefined ? num(args[1]) : 0.1;
                if (isNaN(r)) r = 0.1;
                for (let iter = 0; iter < 100; iter++) {
                    let npv = 0, dnpv = 0;
                    for (let i = 0; i < vals.length; i++) {
                        const pf = Math.pow(1 + r, i);
                        if (!isFinite(pf) || pf === 0) return '#NUM!';
                        npv  += vals[i] / pf;
                        dnpv -= i * vals[i] / ((1 + r) * pf);
                    }
                    if (Math.abs(npv) < 1e-10) return r;
                    if (dnpv === 0) return '#NUM!';
                    const nr = r - npv / dnpv;
                    if (Math.abs(nr - r) < 1e-10) return nr;
                    r = nr;
                }
                return '#NUM!';
            }

            default: return 0;
        }
    }
}

// ── Public formula evaluation ───────────────────────────────────────────────

/**
 * Evaluate a formula or plain cell value.
 *
 * @param raw       The raw cell content (e.g. "=SUM(A1:A3)" or "hello" or "42").
 * @param data      The active sheet's cell data map.
 * @param allSheets Optional list of all sheets (name + data) used to resolve
 *                  cross-sheet references like `Beta!C4` or `'Net Worth'!A1:B3`.
 *                  When omitted, cross-sheet references return `#REF!`.
 */
export function computeCell(
    raw: string,
    data: Map<string, CellProps>,
    allSheets?: SheetRef[],
): { value: string; deps: string[] } {
    if(raw==undefined) return {value: "", deps: []};
    const deps = parseDeps(raw);
    if (!raw.startsWith('=')) return { value: raw, deps };
    try {
        const tokens = tokenize(raw.slice(1).trim());
        const result = new FormulaParser(tokens, data, allSheets).parseExpr();
        return { value: String(result), deps };
    } catch {
        return { value: raw, deps };
    }
}

export function propagateDeps(
    changedId: string,
    data: Map<string, CellProps>,
    visited: Set<string>,
    allSheets?: SheetRef[],
): void {
    const cell = data.get(changedId);
    if (!cell?.dependents?.length) return;
    for (const depId of cell.dependents) {
        if (visited.has(depId)) continue;
        visited.add(depId);
        const depCell = data.get(depId);
        if (!depCell) continue;
        const { value } = computeCell(depCell.raw ?? '', data, allSheets);
        data.set(depId, { ...depCell, value });
        propagateDeps(depId, data, visited, allSheets);
    }
}
