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
        default: return {};
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
    while((indexVal = indexReader.next()) != null) {
        index++;
        let raw;
        let value;

        // console.log(`INDEX: ${index} IndexVal: ${indexVal}`);

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
            const index = functionsIndexReader.next();
            raw = functionsTable[parseInt(index)];   // TODO: Might not be required
            valuesIndexReader.next();
            value = numbersIndexReader.next();
        } else {
            console.error("Unknown index value: ", indexVal);
            throw Error("Unknown index value: ", indexVal);
        }

        const indexSty = stylesIndexReader.next();
        const cellStyle = tanslateStyle(indexSty!=null ? stylesTable[indexSty] : undefined);
        const rowSpan: number = rowSpanIndexReader.next();
        const colSpan: number = colSpanIndexReader.next();
        const row = Math.floor(index/columnCount);
        const col = index%columnCount;
        const id = `R[${row}]C[${col}]`

        cells.push({
            id, raw, value, edit: false, deps: [], cellStyle, row, col, rowSpan,  colSpan,
        })

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

export function fixRealtiveFormulas(raw: string, currentRow: number, currentCol: number) {
    if(raw && raw.startsWith("=")){
        const matcher = RegExp(/R\[(-?\d+)\]C\[(-?\d+)\]/);
        let match = raw.match(matcher);
        while(match){
            const string = match[0];
            const row = parseInt(match[1])+currentRow;
            const col = parseInt(match[2])+currentCol;
            raw = raw.replaceAll(string, `${numToAlpha(col)}${row}`);
            match = raw.match(matcher);
        }
    }
    return raw;
}
