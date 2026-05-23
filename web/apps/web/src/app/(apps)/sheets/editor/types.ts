export type ClipboardCell = {
    relRow: number;  // 0-based row offset from top-left of the copied range
    relCol: number;  // 0-based col offset
    raw: string;     // formula-encoded raw value (cell refs replaced by [dC][dR])
    cellStyle?: CellStyle;
};

export type ClipboardData = {
    isCut: boolean;
    cells: ClipboardCell[];
};

export type CellStyle = {
    fontFamily?: string;
    fontSize?: string;
    fontWeight?: 'bold' | 'normal';
    fontStyle?: 'italic' | 'normal';
    textDecoration?: 'none' | 'line-through';
    color?: string;
    backgroundColor?: string;
    textAlign?: 'left' | 'center' | 'right';
    borderStyle?: 'none' | 'thin' | 'medium' | 'thick';
    numberFormat?: 'number' | 'currency' | 'percent' | 'date';
    decimalPlaces?: number;
    customFormat?: string;
    wrapMode?: 'overflow' | 'wrap' | 'clip';
};

export type SavedCell = {
    id: string;
    raw?: string;
    /** Pre-computed display value. Formulas store their evaluated result here so
     *  the embed API can serve display values without re-evaluating formulas. */
    value?: string;
    cellStyle?: CellStyle;
    colSpan?: number,      // columns this cell spans (>1 = merge anchor)
    rowSpan?: number,      // rows this cell spans (>1 = merge anchor)
    mergeAnchor?: string,  // anchor cell id when this cell is merged into another
};

export type SheetData = {
    name?: string;
    color?: string | null;
    cells: Record<string, SavedCell>;
    colWidths?: Record<string, number>;  // 0-based col index (as string key) → pixel width
    rowHeights?: Record<string, number>; // 0-based row index (as string key) → pixel height
};

export type SheetFile = {
    sheets: SheetData[];
};

export type CellProps = {
    value?: string,
    id: string,
    raw?: string,
    edit: boolean,
    deps?: string[],       // cells this cell's formula references
    dependents?: string[], // cells whose formulas reference this cell
    cellStyle?: CellStyle,
    colSpan?: number,      // columns this cell spans (>1 = merge anchor)
    rowSpan?: number,      // rows this cell spans (>1 = merge anchor)
    mergeAnchor?: string,  // anchor cell id when this cell is merged into another
};
