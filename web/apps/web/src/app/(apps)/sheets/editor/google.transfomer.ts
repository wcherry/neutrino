import type { CellStyle } from './types';
import { alphaToNum, numToAlpha } from './utils';

/* # Google Sheets Clipboard Internal Format
## application/x-vnd.google-spreadsheet-compact-table+json

# Notes
* Negative number denote a repeat count, for example -3 would mean to take the next value and apply it to the next 3 items

### Sections
1 = version
2.0
  [-count, code] | [code]  
3 = data table
3.1 = types => 1=number, 2=string
3.3 = numbers indexed++
3.4 = strings indexed++
4 = styles
5 = [-count, op] | [op] op: styles, 
8 = functions
9 = [-count, op] | [op] op: functions
12 =  [-count, rows] | [rows] rowSpan
13 =  [-count, cols] | [cols] colSpan
15.1= rows
15.2= columns

### Codes
195 - value (in section 3)
203 - formula (in section 8)

## Parser
```
start at section 2
for rows(15.1)
  for cols(15.2)
  if code = 195 => index section 3.1
    if 1 => next from numbers
    if 2 => next from strings
  if code = 203 => index section 9
    functions[value]
```    
*/

const UNUSED_CODE = 0;
const UNKNOWN1_CODE =193;
const BLANK_CODE =194;
const VALUE_CODE = 195;
const FUNCTION_CODE = 203;
const NUMBER_TYPE = 1;
const STRING_TYPE = 2;
const UNKNOWN1_TYPE = 4;   //FORNOW: Not sure what makes this different from a STRING_TYPE

export type ClipData = {
    id: string,
    row: number,
    col: number
    raw: string,
    cellStyle?: CellStyle,
    colSpan?: number,      // columns this cell spans (>1 = merge anchor)
    rowSpan?: number,      // rows this cell spans (>1 = merge anchor)
    mergeAnchor?: string,  // anchor cell id when this cell is merged into another
}

function createIndexReader(table : any[]) {
    let index = 0;
    let counter = 0;
    let total = 0;
    const reader = {
        next: () =>  {
            let value = null;
            if(!table || index>=table.length) return value;
            total++;
            if(counter == 0) {
                value = table[index];
                index++;
                if(value < 0) {
                    counter = -value;
                    value = table[index];
                    counter--;
                }
            } else {
                value = table[index];
                counter--;
                if(counter==0) index++;
            }
            return value;
        },
        index: total,
    };
    return reader;
}
/*
    fontWeight?: 'bold' | 'normal';
    fontStyle?: 'italic' | 'normal';
    color?: string;
    backgroundColor?: string;
    textAlign?: 'left' | 'center' | 'right';
    borderStyle?: 'none' | 'thin' | 'medium' | 'thick';
    numberFormat?: 'number' | 'currency' | 'percent' | 'date';
    decimalPlaces?: number;
    wrapMode?: 'overflow' | 'wrap' | 'clip';


    Italic          18:1
Bold            17:1
Strikethrough   19:1
Orange Text     14:{1: 2, 2: 16750848}      =>FF9900
Yellow BG       4:{1: 2, 2: 16776960}       =>FFFF00
$100.00         3:{1: 4, 2: '"$"#,##0.00'}
50.00%          3:{1: 3, 2: '0.00%', 3: 1}
Nov 2025        3:{1: 5, 2: 'mmm" "yyyy'}
Georgia font    15:'Georgia'
Left Just       Default
Right Just      9:2
Center Just     9:1
Top Align       10:0
Bottom Align    10:2
Center Align    Default
10.123456789    3:{1: 2, 2: '0.000000000', 3: 1}
10.12345679     3:{1: 2, 2: '0.00000000', 3: 1}
10.1235         3:{1: 2, 2: '0.0000', 3: 1}    

11:4 Wrapped text
11:3 Clipped text

7?


*/
function translateNumberFormat(fmtData: any): Partial<CellStyle> {
    if (fmtData == null) return {};
    // Simple number type marker with no format details
    if (fmtData === 1) return { numberFormat: 'number', decimalPlaces: 0 };
    const typeCode  = fmtData["1"];
    const fmtString = fmtData["2"] as string | undefined;
    if (!typeCode) return {};

    let numberFormat: CellStyle['numberFormat'];
    switch (typeCode) {
        case 2: numberFormat = 'number';   break; // number with custom decimal places
        case 3: numberFormat = 'percent';  break;
        case 4: numberFormat = 'currency'; break;
        case 5: numberFormat = 'date';     break;
        default:
            // Unknown typeCode — still preserve the format string so that custom
            // date patterns (e.g. 'dddd', 'DDDD') are not silently dropped when
            // Google Sheets uses a typeCode outside the documented range.
            if (fmtString) return { customFormat: fmtString };
            return {};
    }

    const result: Partial<CellStyle> = { numberFormat };
    if (fmtString) {
        result.customFormat = fmtString;
        const decimalMatch = fmtString.match(/\.([0#]+)/);
        if (decimalMatch) result.decimalPlaces = decimalMatch[1].length;
    }
    return result;
}

function tanslateStyle(data: any[]) : CellStyle {
    if(!data) return {} as CellStyle;
    return {
        fontFamily: data["15"] ? `${data["15"]}, sans-serif` : undefined,
        fontWeight: data["17"]===1 ? 'bold' : 'normal',
        fontStyle: data["18"]===1 ? 'italic' : 'normal',
        textDecoration: data["19"]===1 ? 'line-through' : 'none',
        color: toRGB(data["14"]?.["2"]),
        backgroundColor: toRGB(data["4"]?.["2"]),
        textAlign: data["9"]===1?'center' : (data["9"]===2?'right':'left'),
        borderStyle: 'none',
        wrapMode: data["11"]===4?'wrap' : (data["11"]===3?'clip':'overflow'),
        ...translateNumberFormat(data["3"]),
    } as CellStyle
}

function toRGB(color: number | undefined) : string | undefined {
    if(!color) return undefined;
    return `rgb(${(color>>16) & 0xFF},${(color>>8) & 0xFF},${color & 0xFF})`;
}

/**
 * Merges two partial cell styles for the Google Sheets paste pipeline.
 *
 * `override` wins on every key it *defines*, but — crucially — an `undefined`
 * value never clobbers a defined one. This matters because {@link tanslateStyle}
 * (the compact-table translator) emits every style key, using `undefined` when
 * the property is absent. A naive spread of the compact-table style over the
 * HTML style would therefore wipe out the background colours, text colours and
 * fonts that the (DOM-reliable) HTML parser extracted from inline CSS.
 *
 * We treat the HTML clipboard as authoritative and let the compact-table only
 * fill in gaps, so pass the compact-table style as `base` and the HTML style as
 * `override`.
 */
export function mergeCellStyles(
    base: Partial<CellStyle> | undefined,
    override: Partial<CellStyle> | undefined,
): Partial<CellStyle> {
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base ?? {})) if (v !== undefined) merged[k] = v;
    for (const [k, v] of Object.entries(override ?? {})) if (v !== undefined) merged[k] = v;
    return merged as Partial<CellStyle>;
}

export function parseGoogleSpreadsheetCompactTableJson(data : any[]) : ClipData[] {
    const cells : any[] = [];

    console.log("data: ", data);

    const indexTable = data["2"] || [] as number[];
    const valuesIndexTable = data["3"]?.["1"];
    const numbersTable = data["3"]?.["3"];
    const stringsTable = data["3"]?.["4"];
    const functionsTable = data["8"];
    const functionsIndexTable =data["9"];
    const stylesTable = data["4"];
    const stylesIndexTable = data["5"];

    // const rowCount = parseInt(data["15"]?.["1"] || 1);
    const columnCount = parseInt(data["15"]?.["2"] || 1);

    const rowSpanTable = data["12"];
    const colSpanTable = data["13"];

    const indexReader = createIndexReader(indexTable);
    const valuesIndexReader = createIndexReader(valuesIndexTable);
    const numbersIndexReader = createIndexReader(numbersTable);
    const stringsIndexReader = createIndexReader(stringsTable);
    const functionsIndexReader = createIndexReader(functionsIndexTable);
    const stylesIndexReader = createIndexReader(stylesIndexTable);
    const rowSpanIndexReader = createIndexReader(rowSpanTable);
    const colSpanIndexReader = createIndexReader(colSpanTable);

    try {
    let indexVal;
    let index = -1;
    // Tracks grid positions covered by a merge anchor so we can skip style reads
    // for those cells — the compact-table style section only encodes styles for
    // visible (non-covered) cells, one entry per visible cell in row-major order.
    const coveredSet = new Set<string>();
    while((indexVal = indexReader.next()) != null) {
        index++;
        let raw;
        let value;

        if(indexVal===UNUSED_CODE || indexVal===BLANK_CODE ) {
            // nothing;
        } else if(indexVal===VALUE_CODE) {
            const type = valuesIndexReader.next();
            if(type===NUMBER_TYPE) {
                raw = `${numbersIndexReader.next()}`;
            } else if(type===STRING_TYPE || type===UNKNOWN1_TYPE) {
                raw = stringsIndexReader.next();
            } else {
                console.error("Unknown type: ", type);
            }
            value = raw;

        } else if(indexVal===FUNCTION_CODE) {
            const fnIdx = functionsIndexReader.next();
            raw = functionsTable[parseInt(fnIdx)];
            valuesIndexReader.next();
            value = numbersIndexReader.next();
        } else {
            console.error("Unknown index value: ", indexVal);
            throw Error("Unknown index value: ", indexVal);
        }

        const row = Math.floor(index/columnCount);
        const col = index%columnCount;
        const rowSpan: number = rowSpanIndexReader.next();
        const colSpan: number = colSpanIndexReader.next();

        // If this cell is a merge anchor, register the cells it covers before
        // consuming a style entry — covered cells must not pull from the reader.
        if ((rowSpan ?? 1) > 1 || (colSpan ?? 1) > 1) {
            const rs = rowSpan ?? 1;
            const cs = colSpan ?? 1;
            for (let dr = 0; dr < rs; dr++) {
                for (let dc = 0; dc < cs; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    coveredSet.add(`${row+dr},${col+dc}`);
                }
            }
        }

        const isCovered = coveredSet.has(`${row},${col}`);
        const indexSty = isCovered ? null : stylesIndexReader.next();
        const cellStyle = tanslateStyle(indexSty != null ? stylesTable[indexSty] : undefined);
        const id = `R[${row}]C[${col}]`;

        cells.push({
            id, raw, value, edit: false, deps: [], cellStyle, row, col, rowSpan, colSpan,
        });

        console.log("CELL: ", cells[cells.length-1]);
    }

    // Mark cells covered by a merge anchor with mergeAnchor
    const cellMap = new Map<string, any>(cells.map((c: any) => [c.id, c]));
    for (const cell of cells) {
        if ((cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1) {
            const rs = cell.rowSpan ?? 1;
            const cs = cell.colSpan ?? 1;
            for (let dr = 0; dr < rs; dr++) {
                for (let dc = 0; dc < cs; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const coveredId = `R[${cell.row + dr}]C[${cell.col + dc}]`;
                    const covered = cellMap.get(coveredId);
                    if (covered) covered.mergeAnchor = cell.id;
                }
            }
        }
    }

    console.log("Cells: ", cells);
    return cells;
} catch(e) {
    console.log("ERROR: ",e);
    return [];
}
}

/**
 * Extracts a partial CellStyle from a CSS inline style string.
 * Handles properties that Google Sheets encodes in the td style attribute
 * (background-color, color, font-weight, font-style, text-align, font-family).
 */
function parseCssStyle(style: string): Partial<CellStyle> {
    const result: Partial<CellStyle> = {};
    for (const rule of style.split(';')) {
        const colon = rule.indexOf(':');
        if (colon < 0) continue;
        const prop = rule.slice(0, colon).trim().toLowerCase();
        const val  = rule.slice(colon + 1).trim();
        if (!val) continue;
        switch (prop) {
            case 'background-color':
                if (val !== 'transparent' && val !== 'inherit' && val !== 'initial') {
                    result.backgroundColor = val;
                }
                break;
            case 'color':
                if (val !== 'inherit' && val !== 'initial') result.color = val;
                break;
            case 'font-weight':
                result.fontWeight = (val === 'bold' || parseInt(val) >= 600) ? 'bold' : 'normal';
                break;
            case 'font-style':
                result.fontStyle = val.includes('italic') ? 'italic' : 'normal';
                break;
            case 'text-align':
                if (val === 'center' || val === 'right' || val === 'left') result.textAlign = val;
                break;
            case 'text-decoration':
                if (val.includes('line-through')) result.textDecoration = 'line-through';
                break;
            case 'font-family':
                result.fontFamily = val.replace(/['"]/g, '').split(',')[0].trim();
                break;
            case 'vertical-align':
                if (val === 'top' || val === 'middle' || val === 'bottom') result.verticalAlign = val;
                break;
        }
    }
    return result;
}

/**
 * Parses Google Sheets HTML clipboard data (text/html) to extract cell values,
 * number/date formats, and visual styles (colors, font).
 *
 * Google Sheets annotates every <td> with:
 *   data-sheets-value        — the underlying value (type + value fields)
 *   data-sheets-numberformat — the number/date format string
 *   style                    — inline CSS for visual formatting
 *
 * Colspan and rowspan attributes are respected so that cell positions in the
 * logical grid match Google Sheets' layout.
 *
 * This is the reliable fallback (and enrichment source) when the proprietary
 * compact-table JSON is not available or is missing format strings.
 */
export function parseGoogleSheetsHtml(html: string): ClipData[] {
    if (!html.includes('data-sheets-') || typeof DOMParser === 'undefined') return [];

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('tr'));
    if (rows.length === 0) return [];

    const cells: ClipData[] = [];
    // Track grid positions occupied by a rowspan from a previous row.
    // occupied.get(rowIdx) is the set of column indices covered by a prior span.
    const occupied = new Map<number, Set<number>>();

    const markOccupied = (r: number, c: number) => {
        if (!occupied.has(r)) occupied.set(r, new Set());
        occupied.get(r)!.add(c);
    };

    rows.forEach((tr, rowIdx) => {
        const tds = Array.from(tr.querySelectorAll('td, th'));
        let actualCol = 0;

        tds.forEach(td => {
            // Skip positions covered by a rowspan that started in a previous row.
            while (occupied.get(rowIdx)?.has(actualCol)) actualCol++;

            const colSpanAttr = Math.max(1, parseInt(td.getAttribute('colspan') ?? '1') || 1);
            const rowSpanAttr = Math.max(1, parseInt(td.getAttribute('rowspan') ?? '1') || 1);

            const valueAttr = td.getAttribute('data-sheets-value');
            const fmtAttr   = td.getAttribute('data-sheets-numberformat');
            const styleAttr = td.getAttribute('style');

            // Default to the visible text content of the cell.
            let raw: string = td.textContent?.trim() ?? '';

            // Prefer the structured value when available.
            // data-sheets-value: {"1": type, "2": string-value, "3": numeric-value}
            //   type 1 = number (value in "3")
            //   type 2 = string (value in "2")
            if (valueAttr) {
                try {
                    const v = JSON.parse(valueAttr);
                    if (v['1'] === 1 && v['3'] != null) {
                        // Number — preserve the raw serial so date formats can be applied.
                        raw = String(v['3']);
                    } else if (v['1'] === 2 && v['2'] != null) {
                        raw = String(v['2']);
                    }
                } catch { /* ignore */ }
            }

            // Build cellStyle from number format and inline CSS (merged).
            let cellStyle: Partial<CellStyle> = {};

            if (fmtAttr) {
                try {
                    const translated = translateNumberFormat(JSON.parse(fmtAttr));
                    cellStyle = { ...cellStyle, ...translated };
                } catch { /* ignore */ }
            }

            if (styleAttr) {
                const css = parseCssStyle(styleAttr);
                // CSS visual properties fill in what the number-format doesn't cover.
                // Number-format properties (numberFormat, customFormat, decimalPlaces) take
                // precedence if already set, since they carry more precise information.
                cellStyle = { ...css, ...cellStyle };
            }

            const id = `R[${rowIdx}]C[${actualCol}]`;
            cells.push({
                id,
                row: rowIdx,
                col: actualCol,
                raw,
                cellStyle: Object.keys(cellStyle).length > 0 ? cellStyle as CellStyle : undefined,
                ...(colSpanAttr > 1 ? { colSpan: colSpanAttr } : {}),
                ...(rowSpanAttr > 1 ? { rowSpan: rowSpanAttr } : {}),
            });

            // Mark all grid positions covered by this cell's span as occupied
            // so subsequent rows skip them correctly.
            for (let rdr = 0; rdr < rowSpanAttr; rdr++) {
                for (let rdc = 0; rdc < colSpanAttr; rdc++) {
                    if (rdr === 0 && rdc === 0) continue;
                    markOccupied(rowIdx + rdr, actualCol + rdc);
                }
            }

            actualCol += colSpanAttr;
        });
    });

    return cells;
}

export function fixRealtiveFormulas(raw: string, currentRow: number, currentCol: number) {
    if (raw && raw.startsWith("=")) {
        // Matches all R1C1-style ref forms: R[n]C[n] (relative), R1C1 (absolute), or mixed.
        // Group 2 = relative row offset (bracketed), group 3 = absolute row (no brackets).
        // Group 5 = relative col offset (bracketed), group 6 = absolute col (no brackets).
        raw = raw.replace(/R(\[(-?\d+)\]|(\d+))C(\[(-?\d+)\]|(\d+))/g,
            (_, _rp, relRow, absRow, _cp, relCol, absCol) => {
                const row = absRow !== undefined ? parseInt(absRow) : parseInt(relRow) + currentRow;
                const col = absCol !== undefined ? parseInt(absCol) : parseInt(relCol) + currentCol;
                const colStr = (absCol !== undefined ? '$' : '') + numToAlpha(col);
                const rowStr = (absRow !== undefined ? '$' : '') + row;
                return `${colStr}${rowStr}`;
            });
    }
    return raw;
}
