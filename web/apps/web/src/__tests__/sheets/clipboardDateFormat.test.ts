/**
 * Tests for Google Sheets clipboard paste with custom date formats.
 *
 * When pasting from Google Sheets a cell whose underlying value is a date
 * serial (e.g. 45782 = 2025-05-05, Monday) formatted with a day-name pattern
 * like 'dddd' or 'DDDD', the pasted cell should display "Monday" — not the
 * raw serial number.
 *
 * The pipeline under test:
 *   1. parseGoogleSpreadsheetCompactTableJson  — extracts raw value + cellStyle
 *   2. formatCellValue(raw, cellStyle)          — applies the custom date format
 */

import { describe, it, expect } from 'vitest';
import { parseGoogleSpreadsheetCompactTableJson, parseGoogleSheetsHtml } from '../../app/(apps)/sheets/editor/google.transfomer';
import { formatCellValue } from '../../app/(apps)/sheets/editor/utils';

// ── Compact-table JSON builders ───────────────────────────────────────────────

/**
 * Build a minimal single-cell compact-table JSON as Google Sheets puts on the
 * clipboard.  `styleEntry` is placed at index 0 of the styles table.
 */
function makeSingleNumericCell(value: number, styleEntry: object): object {
    return {
        "2": [195],              // one VALUE_CODE cell
        "3": {
            "1": [1],            // valuesIndex: [NUMBER_TYPE]
            "3": [value],        // numbers table
            "4": [],             // strings table (empty)
        },
        "4": [styleEntry],       // stylesTable: one entry
        "5": [0],               // stylesIndex: cell 0 → style 0
        "8": [],                // functionsTable (empty)
        "9": [],                // functionsIndex (empty)
        "12": [1],              // rowSpanTable
        "13": [1],              // colSpanTable
        "15": { "1": "1", "2": "1" },  // 1 row × 1 col
    };
}

// ── parseGoogleSpreadsheetCompactTableJson — style extraction ─────────────────

describe('parseGoogleSpreadsheetCompactTableJson — date format extraction', () => {
    // Standard typeCode 5 (date) with 'dddd' format string (already documented).
    it('extracts customFormat "dddd" for typeCode 5', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 5, "2": "dddd" } });
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells).toHaveLength(1);
        expect(cells[0].raw).toBe('45782');
        expect(cells[0].cellStyle?.customFormat).toBe('dddd');
        expect(cells[0].cellStyle?.numberFormat).toBe('date');
    });

    // Google Sheets may encode custom date-only formats (like DDDD) with a
    // typeCode outside the documented range.  The fix ensures the format string
    // is not silently dropped in that case.
    it('preserves customFormat "dddd" for unknown typeCode 6', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 6, "2": "dddd" } });
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells).toHaveLength(1);
        expect(cells[0].raw).toBe('45782');
        expect(cells[0].cellStyle?.customFormat).toBe('dddd');
    });

    it('preserves customFormat "DDDD" (uppercase) for unknown typeCode', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 8, "2": "DDDD" } });
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells[0].cellStyle?.customFormat).toBe('DDDD');
    });

    it('extracts customFormat for other date patterns — "mmm yyyy"', () => {
        // typeCode 5, format 'mmm" "yyyy' (from documented examples)
        const json = makeSingleNumericCell(45782, { "3": { "1": 5, "2": 'mmm" "yyyy' } });
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells[0].cellStyle?.customFormat).toBe('mmm" "yyyy');
        expect(cells[0].cellStyle?.numberFormat).toBe('date');
    });

    it('returns no customFormat when style has no format entry', () => {
        const json = makeSingleNumericCell(45782, {});
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells[0].cellStyle?.customFormat).toBeUndefined();
    });

    it('returns no customFormat when unknown typeCode has no format string', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 99 } });
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells[0].cellStyle?.customFormat).toBeUndefined();
    });
});

// ── Full pipeline: compact-table JSON → displayed cell value ──────────────────

describe('Google Sheets paste pipeline — date serial + custom format → display', () => {
    // 45782 = Monday 2025-05-05
    it('displays "Monday" for serial 45782 with typeCode-5 dddd format', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 5, "2": "dddd" } });
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Monday');
    });

    it('displays "Monday" for serial 45782 with unknown-typeCode dddd format', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 6, "2": "dddd" } });
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Monday');
    });

    it('displays "Monday" for serial 45782 with uppercase DDDD format', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 5, "2": "DDDD" } });
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Monday');
    });

    // 45783 = Tuesday 2025-05-06
    it('displays "Tuesday" for serial 45783 with dddd format', () => {
        const json = makeSingleNumericCell(45783, { "3": { "1": 5, "2": "dddd" } });
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Tuesday');
    });

    it('displays "Mon" for serial 45782 with ddd (abbreviated) format', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 5, "2": "ddd" } });
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Mon');
    });

    it('displays "2025-05-05" for serial 45782 with yyyy-mm-dd format', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 5, "2": "yyyy-mm-dd" } });
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('2025-05-05');
    });

    it('displays "May 2025" for serial 45782 with mmmm yyyy format', () => {
        const json = makeSingleNumericCell(45782, { "3": { "1": 5, "2": "mmmm yyyy" } });
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('May 2025');
    });

    // Without any format the raw serial should be returned unchanged.
    it('displays raw serial when no custom format is set', () => {
        const json = makeSingleNumericCell(45782, {});
        const [cell] = parseGoogleSpreadsheetCompactTableJson(json);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('45782');
    });
});

// ── parseGoogleSheetsHtml — HTML clipboard parsing ────────────────────────────

/**
 * Builds minimal Google Sheets HTML clipboard content (text/html) with
 * data-sheets-value / data-sheets-numberformat attributes on each <td>.
 *
 * value type 1 = number (field "3"), type 2 = string (field "2").
 */
function makeSheetsHtml(cells: Array<{
    value: { type: 1; num: number } | { type: 2; str: string };
    format?: { typeCode: number; fmt: string };
    displayText?: string;
}>): string {
    const tds = cells.map(c => {
        const valObj = c.value.type === 1
            ? JSON.stringify({ '1': 1, '3': c.value.num })
            : JSON.stringify({ '1': 2, '2': c.value.str });
        const fmtAttr = c.format
            ? ` data-sheets-numberformat="${JSON.stringify({ '1': c.format.typeCode, '2': c.format.fmt, '3': 1 }).replace(/"/g, '&quot;')}"`
            : '';
        const display = c.displayText ?? (c.value.type === 2 ? c.value.str : String(c.value.num));
        return `<td data-sheets-value="${valObj.replace(/"/g, '&quot;')}"${fmtAttr}>${display}</td>`;
    });
    return `<google-sheets-html-origin><table><tr>${tds.join('')}</tr></table>`;
}

// ── parseGoogleSheetsHtml — colspan / rowspan handling ────────────────────────

describe('parseGoogleSheetsHtml — colspan and rowspan', () => {
    it('assigns correct column positions when first td has colspan > 1', () => {
        // A header "May 26" spans 7 columns; the next row has 7 individual cells.
        const html = [
            '<google-sheets-html-origin><table>',
            '<tr><td colspan="7" data-sheets-value=\'{"1":2,"2":"May 26"}\'>May 26</td></tr>',
            '<tr>',
            ...[0,1,2,3,4,5,6].map(i =>
                `<td data-sheets-value='{"1":1,"3":${45782+i}}' data-sheets-numberformat='{"1":5,"2":"dddd","3":1}'>${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}</td>`
            ),
            '</tr>',
            '</table>',
        ].join('');

        const cells = parseGoogleSheetsHtml(html);

        // Header cell
        const header = cells.find(c => c.row === 0 && c.col === 0);
        expect(header?.raw).toBe('May 26');
        expect(header?.colSpan).toBe(7);

        // Day-name cells: should be at row=1, col=0..6
        for (let i = 0; i < 7; i++) {
            const cell = cells.find(c => c.row === 1 && c.col === i);
            expect(cell?.raw).toBe(String(45782 + i));
            expect(cell?.cellStyle?.customFormat).toBe('dddd');
        }
    });

    it('skips rowspan-covered positions in subsequent rows', () => {
        // Row 0: title spanning 2 rows × 7 cols.
        // Row 1: covered — no tds.
        // Row 2: 7 individual cells.
        const html = [
            '<google-sheets-html-origin><table>',
            '<tr><td rowspan="2" colspan="7" data-sheets-value=\'{"1":2,"2":"May 26"}\'>May 26</td></tr>',
            '<tr></tr>', // row 1 entirely covered
            '<tr>',
            ...[0,1,2,3,4,5,6].map(i =>
                `<td data-sheets-value='{"1":1,"3":${45782+i}}' data-sheets-numberformat='{"1":5,"2":"dddd","3":1}'>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</td>`
            ),
            '</tr>',
            '</table>',
        ].join('');

        const cells = parseGoogleSheetsHtml(html);

        const header = cells.find(c => c.row === 0 && c.col === 0);
        expect(header?.raw).toBe('May 26');
        expect(header?.colSpan).toBe(7);
        expect(header?.rowSpan).toBe(2);

        // Day-name cells land at row 2 (correct — not shifted to row 1)
        for (let i = 0; i < 7; i++) {
            const cell = cells.find(c => c.row === 2 && c.col === i);
            expect(cell).toBeDefined();
            expect(cell?.raw).toBe(String(45782 + i));
        }
        // No cells at row 1 (covered by rowspan)
        expect(cells.filter(c => c.row === 1)).toHaveLength(0);
    });

    it('handles mid-row colspan: cells after a merged td get correct col positions', () => {
        // Row: A(col 0) | B-C merged(cols 1-2, colspan=2) | D(col 3)
        const html = [
            '<google-sheets-html-origin><table><tr>',
            '<td data-sheets-value=\'{"1":2,"2":"A"}\'>A</td>',
            '<td colspan="2" data-sheets-value=\'{"1":2,"2":"BC"}\'>BC</td>',
            '<td data-sheets-value=\'{"1":2,"2":"D"}\'>D</td>',
            '</tr></table>',
        ].join('');

        const cells = parseGoogleSheetsHtml(html);
        expect(cells.find(c => c.col === 0)?.raw).toBe('A');
        expect(cells.find(c => c.col === 1)?.raw).toBe('BC');
        expect(cells.find(c => c.col === 1)?.colSpan).toBe(2);
        expect(cells.find(c => c.col === 3)?.raw).toBe('D');
        // No cell at col 2 (covered by colspan)
        expect(cells.find(c => c.col === 2)).toBeUndefined();
    });

    it('full calendar-like pipeline: header + rowspan + day serials display as day names', () => {
        const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        const html = [
            '<google-sheets-html-origin><table>',
            '<tr><td rowspan="2" colspan="7" data-sheets-value=\'{"1":2,"2":"May 26"}\'>May 26</td></tr>',
            '<tr></tr>',
            '<tr>',
            ...dayNames.map((_, i) =>
                `<td data-sheets-value='{"1":1,"3":${45782+i}}' data-sheets-numberformat='{"1":5,"2":"dddd","3":1}'>${dayNames[i]}</td>`
            ),
            '</tr>',
            '</table>',
        ].join('');

        const cells = parseGoogleSheetsHtml(html);
        for (let i = 0; i < 7; i++) {
            const cell = cells.find(c => c.row === 2 && c.col === i)!;
            expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe(dayNames[i]);
        }
    });
});

// ── HTML filter removes compact-table covered cells ───────────────────────────
// Simulates the enrichment logic inside useClipboard: compact-table cells that
// are absent from the HTML (because HTML's occupied-map skipped them as covered
// by a merge) should be dropped so the paste loop doesn't overwrite the
// mergeAnchor entries the anchor cell creates.

describe('enrichment filter: covered cells are dropped when HTML is the authority', () => {
    it('filters out compact-table cells that HTML omits due to rowspan', () => {
        // HTML: 2×2 table where (0,0) has rowspan=2 colspan=2 → only (0,0) is returned.
        // Must include at least one data-sheets-* attribute so the parser doesn't bail early.
        const html = [
            '<google-sheets-html-origin><table data-sheets-root="1">',
            '<tr><td rowspan="2" colspan="2" data-sheets-value=\'{"1":2,"2":"David"}\'>David</td></tr>',
            '<tr></tr>',
            '</table>',
        ].join('');
        const htmlCells = parseGoogleSheetsHtml(html);
        // HTML produces only (0,0)
        expect(htmlCells).toHaveLength(1);
        expect(htmlCells[0].row).toBe(0);
        expect(htmlCells[0].col).toBe(0);
        expect(htmlCells[0].colSpan).toBe(2);
        expect(htmlCells[0].rowSpan).toBe(2);
    });

    it('parseGoogleSheetsHtml preserves HTML span attributes for anchor cell', () => {
        // The span attrs on the anchor must survive so the paste loop knows the merge size.
        const html = [
            '<google-sheets-html-origin><table data-sheets-root="1">',
            '<tr>',
            '<td rowspan="2" colspan="3" data-sheets-value=\'{"1":2,"2":"Header"}\' style="text-align:center;">Header</td>',
            '</tr>',
            '<tr></tr>',
            '<tr>',
            '<td data-sheets-value=\'{"1":2,"2":"A"}\'>A</td>',
            '<td data-sheets-value=\'{"1":2,"2":"B"}\'>B</td>',
            '<td data-sheets-value=\'{"1":2,"2":"C"}\'>C</td>',
            '</tr>',
            '</table>',
        ].join('');
        const cells = parseGoogleSheetsHtml(html);
        const anchor = cells.find(c => c.row === 0 && c.col === 0);
        expect(anchor?.colSpan).toBe(3);
        expect(anchor?.rowSpan).toBe(2);
        expect(anchor?.cellStyle?.textAlign).toBe('center');
        // Cells in row 1 should be absent (covered by rowspan)
        expect(cells.filter(c => c.row === 1)).toHaveLength(0);
        // Row 2 cells should be present
        expect(cells.filter(c => c.row === 2)).toHaveLength(3);
    });
});

// ── parseGoogleSheetsHtml — inline CSS visual style extraction ────────────────

describe('parseGoogleSheetsHtml — inline CSS style extraction', () => {
    it('extracts backgroundColor from inline style', () => {
        const html = '<google-sheets-html-origin><table><tr>'
            + '<td data-sheets-value=\'{"1":2,"2":"May 26"}\' style="background-color:#4472c4;color:#ffffff;">May 26</td>'
            + '</tr></table>';
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].cellStyle?.backgroundColor).toBe('#4472c4');
        expect(cells[0].cellStyle?.color).toBe('#ffffff');
    });

    it('extracts fontWeight bold from inline style', () => {
        const html = '<google-sheets-html-origin><table><tr>'
            + '<td data-sheets-value=\'{"1":2,"2":"Hello"}\' style="font-weight:bold;">Hello</td>'
            + '</tr></table>';
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].cellStyle?.fontWeight).toBe('bold');
    });

    it('extracts fontWeight bold from numeric weight 700', () => {
        const html = '<google-sheets-html-origin><table><tr>'
            + '<td data-sheets-value=\'{"1":2,"2":"Hello"}\' style="font-weight:700;">Hello</td>'
            + '</tr></table>';
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].cellStyle?.fontWeight).toBe('bold');
    });

    it('merges CSS visual style with number format — numberFormat takes precedence', () => {
        // A cell that is both date-formatted (dddd) and has a background colour.
        const html = '<google-sheets-html-origin><table><tr>'
            + `<td data-sheets-value='{"1":1,"3":45782}' `
            + `data-sheets-numberformat='{"1":5,"2":"dddd","3":1}' `
            + `style="background-color:#ffd966;font-weight:bold;">Monday</td>`
            + '</tr></table>';
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].raw).toBe('45782');
        expect(cells[0].cellStyle?.customFormat).toBe('dddd');
        expect(cells[0].cellStyle?.numberFormat).toBe('date');
        expect(cells[0].cellStyle?.backgroundColor).toBe('#ffd966');
        expect(cells[0].cellStyle?.fontWeight).toBe('bold');
    });
});

describe('parseGoogleSheetsHtml — value and format extraction', () => {
    it('extracts numeric value and dddd custom format from HTML', () => {
        const html = makeSheetsHtml([{
            value: { type: 1, num: 45782 },
            format: { typeCode: 5, fmt: 'dddd' },
            displayText: 'Monday',
        }]);
        const cells = parseGoogleSheetsHtml(html);
        expect(cells).toHaveLength(1);
        expect(cells[0].raw).toBe('45782');
        expect(cells[0].cellStyle?.customFormat).toBe('dddd');
        expect(cells[0].cellStyle?.numberFormat).toBe('date');
    });

    it('extracts string value when Google Sheets sends display text for DDDD', () => {
        // Google Sheets may send the already-formatted string "Monday" as a string value.
        const html = makeSheetsHtml([{
            value: { type: 2, str: 'Monday' },
            format: { typeCode: 5, fmt: 'dddd' },
            displayText: 'Monday',
        }]);
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].raw).toBe('Monday');
        expect(cells[0].cellStyle?.customFormat).toBe('dddd');
    });

    it('falls back to td text content when no data-sheets-value present', () => {
        const html = '<table><tr><td data-sheets-numberformat="&quot;test&quot;">Hello</td></tr></table>';
        // data-sheets-numberformat is malformed but data-sheets-* is absent from value
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].raw).toBe('Hello');
    });

    it('returns empty array for non-Google-Sheets HTML', () => {
        const html = '<table><tr><td>plain</td></tr></table>';
        expect(parseGoogleSheetsHtml(html)).toHaveLength(0);
    });

    it('handles multiple cells in a row', () => {
        const html = makeSheetsHtml([
            { value: { type: 1, num: 45782 }, format: { typeCode: 5, fmt: 'dddd' }, displayText: 'Monday' },
            { value: { type: 2, str: 'hello' } },
        ]);
        const cells = parseGoogleSheetsHtml(html);
        expect(cells).toHaveLength(2);
        expect(cells[0].raw).toBe('45782');
        expect(cells[1].raw).toBe('hello');
        expect(cells[1].cellStyle).toBeUndefined();
    });
});

describe('parseGoogleSheetsHtml — full pipeline: HTML → display value', () => {
    it('displays "Monday" from HTML with numeric serial + dddd format', () => {
        const html = makeSheetsHtml([{
            value: { type: 1, num: 45782 },
            format: { typeCode: 5, fmt: 'dddd' },
            displayText: 'Monday',
        }]);
        const [cell] = parseGoogleSheetsHtml(html);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Monday');
    });

    it('displays "Monday" from HTML with string value "Monday" + dddd format', () => {
        const html = makeSheetsHtml([{
            value: { type: 2, str: 'Monday' },
            format: { typeCode: 5, fmt: 'dddd' },
            displayText: 'Monday',
        }]);
        const [cell] = parseGoogleSheetsHtml(html);
        // The string "Monday" is already the correct display value.
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Monday');
    });

    it('displays "Tuesday" from HTML with serial 45783 + dddd format', () => {
        const html = makeSheetsHtml([{
            value: { type: 1, num: 45783 },
            format: { typeCode: 5, fmt: 'dddd' },
            displayText: 'Tuesday',
        }]);
        const [cell] = parseGoogleSheetsHtml(html);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Tuesday');
    });

    it('displays "Mon" from HTML with serial 45782 + ddd format', () => {
        const html = makeSheetsHtml([{
            value: { type: 1, num: 45782 },
            format: { typeCode: 5, fmt: 'ddd' },
            displayText: 'Mon',
        }]);
        const [cell] = parseGoogleSheetsHtml(html);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('Mon');
    });

    it('displays "2025-05-05" from HTML with serial + yyyy-mm-dd format', () => {
        const html = makeSheetsHtml([{
            value: { type: 1, num: 45782 },
            format: { typeCode: 5, fmt: 'yyyy-mm-dd' },
        }]);
        const [cell] = parseGoogleSheetsHtml(html);
        expect(formatCellValue(cell.raw ?? '', cell.cellStyle)).toBe('2025-05-05');
    });
});

// ── Multi-cell paste — formats survive alongside other cell properties ─────────

describe('parseGoogleSpreadsheetCompactTableJson — multi-cell with mixed formats', () => {
    it('correctly extracts date format for each cell in a two-cell row', () => {
        const json = {
            "2": [195, 195],       // two VALUE_CODE cells
            "3": {
                "1": [1, 2],       // NUMBER_TYPE, then STRING_TYPE
                "3": [45782],      // one number: serial
                "4": ["hello"],    // one string
            },
            "4": [
                { "3": { "1": 5, "2": "dddd" } },  // style 0: date format
                {},                                  // style 1: no format
            ],
            "5": [0, 1],           // cell 0 → style 0, cell 1 → style 1
            "8": [],
            "9": [],
            "12": [-2, 1],         // both cells rowSpan=1
            "13": [-2, 1],         // both cells colSpan=1
            "15": { "1": "1", "2": "2" },  // 1 row × 2 cols
        };
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells).toHaveLength(2);

        // First cell: numeric date with dddd format → Monday
        expect(cells[0].raw).toBe('45782');
        expect(cells[0].cellStyle?.customFormat).toBe('dddd');
        expect(formatCellValue(cells[0].raw ?? '', cells[0].cellStyle)).toBe('Monday');

        // Second cell: plain string, no format
        expect(cells[1].raw).toBe('hello');
        expect(cells[1].cellStyle?.customFormat).toBeUndefined();
    });
});

// ── parseGoogleSheetsHtml — verticalAlign from inline CSS ────────────────────

describe('parseGoogleSheetsHtml — verticalAlign', () => {
    it('extracts verticalAlign:middle from inline style', () => {
        const html = '<google-sheets-html-origin><table><tr>'
            + '<td data-sheets-value=\'{"1":2,"2":"David"}\' style="vertical-align:middle;">David</td>'
            + '</tr></table>';
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].cellStyle?.verticalAlign).toBe('middle');
    });

    it('extracts verticalAlign:bottom from inline style', () => {
        const html = '<google-sheets-html-origin><table><tr>'
            + '<td data-sheets-value=\'{"1":2,"2":"X"}\' style="vertical-align:bottom;">X</td>'
            + '</tr></table>';
        const cells = parseGoogleSheetsHtml(html);
        expect(cells[0].cellStyle?.verticalAlign).toBe('bottom');
    });
});

// ── parseGoogleSpreadsheetCompactTableJson — merge anchors ───────────────────

describe('parseGoogleSpreadsheetCompactTableJson — merge anchor handling', () => {
    it('marks covered cells with mergeAnchor and the anchor cell gets correct colSpan/rowSpan', () => {
        // 2-row × 2-col grid, first cell is a 2×2 merge anchor.
        // Compact-table encodes: rowSpan [2,-7,1] and colSpan [2,-7,1] for 4 cells.
        const json = {
            "2": [195, 0, 0, 0],    // VALUE at [0], BLANK at [1-3]
            "3": {
                "1": [2],            // valuesIndex: STRING_TYPE (only one value)
                "3": [],
                "4": ["David"],
            },
            "4": [{}],               // one style entry (empty)
            "5": [0, 0, 0, 0],       // all cells use style 0
            "8": [],
            "9": [],
            "12": [2, -3, 1],        // rowSpan: cell 0 = 2, cells 1-3 = 1
            "13": [2, -3, 1],        // colSpan: cell 0 = 2, cells 1-3 = 1
            "15": { "1": "2", "2": "2" },  // 2 rows × 2 cols
        };
        const cells = parseGoogleSpreadsheetCompactTableJson(json);
        expect(cells).toHaveLength(4);

        // Anchor cell
        const anchor = cells.find(c => c.id === 'R[0]C[0]');
        expect(anchor?.raw).toBe('David');
        expect(anchor?.colSpan).toBe(2);
        expect(anchor?.rowSpan).toBe(2);
        expect(anchor?.mergeAnchor).toBeUndefined();

        // Covered cells should all reference the anchor
        const covered = cells.filter(c => c.id !== 'R[0]C[0]');
        expect(covered).toHaveLength(3);
        for (const c of covered) {
            expect(c.mergeAnchor).toBe('R[0]C[0]');
        }
    });
});
