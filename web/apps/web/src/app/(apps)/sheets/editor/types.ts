export type ClipboardCell = {
    relRow: number;  // 0-based row offset from top-left of the copied range
    relCol: number;  // 0-based col offset
    raw: string;     // formula-encoded raw value (cell refs replaced by [dC][dR])
    cellStyle?: CellStyle;
};

// A CF rule clipped to the copied selection, expressed in relative coordinates.
export type ClipboardCFRule = {
    relRowMin: number;
    relColMin: number;
    relRowMax: number;
    relColMax: number;
    rule: CFRuleSpec;
};

export type ClipboardData = {
    isCut: boolean;
    cells: ClipboardCell[];
    cfRules?: ClipboardCFRule[];
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
    verticalAlign?: 'top' | 'middle' | 'bottom';
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

// ── Conditional Formatting types ──────────────────────────────────────────────

export type CFStyle = {
    backgroundColor?: string;
    color?: string;
    fontWeight?: 'bold' | 'normal';
    fontStyle?: 'italic' | 'normal';
    textDecoration?: 'underline' | 'none';
};

export type CFConditionType =
    | 'greaterThan' | 'lessThan' | 'equalTo' | 'notEqualTo'
    | 'between' | 'containsText' | 'isEmpty' | 'isNotEmpty'
    | 'dateIsToday' | 'dateIsTomorrow' | 'dateIsPastDue'
    | 'dateIsNextWeek' | 'dateIsThisMonth';

export type CFSingleColorRule = {
    kind: 'singleColor';
    condition: CFConditionType;
    value?: string;
    value2?: string;
    format: CFStyle;
};

export type CFColorScaleRule = {
    kind: 'colorScale';
    minColor: string;
    maxColor: string;
    midColor?: string;
};

export type CFDataBarRule = {
    kind: 'dataBar';
    color: string;
    gradient: boolean;
};

export type CFIconSetRule = {
    kind: 'iconSet';
    iconSet: 'trafficLights' | 'arrows' | 'ratings';
};

export type CFDuplicatesRule = {
    kind: 'duplicates' | 'uniques';
    format: CFStyle;
};

export type CFTopBottomRule = {
    kind: 'topBottom';
    direction: 'top' | 'bottom';
    type: 'n' | 'percent';
    value: number;
    format: CFStyle;
    // item 22: when true, only consider visible (non-filtered) rows
    visibleOnly?: boolean;
};

export type CFAverageRule = {
    kind: 'average';
    direction: 'above' | 'below';
    format: CFStyle;
    // item 22: when true, only consider visible (non-filtered) rows
    visibleOnly?: boolean;
};

export type CFFormulaRule = {
    kind: 'formula';
    formula: string;
    format: CFStyle;
};

// item 15: progress bar with explicit min/max range
export type CFProgressBarRule = {
    kind: 'progressBar';
    minValue: number;
    maxValue: number;
    color: string;
    showLabel: boolean;
};

// item 16: status indicator built-in templates
export type CFStatusIndicatorTemplate = 'projectStatus' | 'priority' | 'approval';
export type CFStatusIndicatorRule = {
    kind: 'statusIndicator';
    template: CFStatusIndicatorTemplate;
};

// item 14: heat map — advanced color scale with presets
export type CFHeatMapPreset = 'financial' | 'performance' | 'temperature';
export type CFHeatMapRule = {
    kind: 'heatMap';
    preset: CFHeatMapPreset;
    lowColor: string;
    midColor?: string;
    highColor: string;
};

// item 18: theme-aware formatting — semantic color tokens
export type CFThemeToken = 'success' | 'warning' | 'danger' | 'info';
export type CFThemeColorRule = {
    kind: 'themeColor';
    condition: CFConditionType;
    value?: string;
    value2?: string;
    token: CFThemeToken;
};

// item 19: named variable reference
export type CFVariableRule = {
    kind: 'variable';
    variableName: string;
};

export type CFRuleSpec =
    | CFSingleColorRule | CFColorScaleRule | CFDataBarRule | CFIconSetRule
    | CFDuplicatesRule | CFTopBottomRule | CFAverageRule | CFFormulaRule
    | CFProgressBarRule | CFStatusIndicatorRule | CFHeatMapRule
    | CFThemeColorRule | CFVariableRule;

export type CFRule = {
    id: string;
    range: string;
    rule: CFRuleSpec;
    // item 13: stop processing further rules for a cell once this rule fires
    stopIfTrue?: boolean;
};

// item 19: named reusable rule definition
export type CFVariable = {
    name: string;
    description?: string;
    rule: Exclude<CFRuleSpec, CFVariableRule>;
};

// item 20: saved rule template (stored in localStorage)
export type CFTemplate = {
    id: string;
    name: string;
    rules: Array<{ range: string; rule: CFRuleSpec; stopIfTrue?: boolean }>;
};

export type SheetData = {
    name?: string;
    color?: string | null;
    cells: Record<string, SavedCell>;
    colWidths?: Record<string, number>;  // 0-based col index (as string key) → pixel width
    rowHeights?: Record<string, number>; // 0-based row index (as string key) → pixel height
    charts?: import('./charts/chartTypes').ChartDef[];
    conditionalFormats?: CFRule[];
    cfVariables?: CFVariable[];          // item 19: named reusable rules
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
