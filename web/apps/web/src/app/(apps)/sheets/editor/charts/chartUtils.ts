import type { CellProps } from '../types';
import { alphaToNum, numToAlpha } from '../utils';
import type { ChartDef, ChartSeries, AxisConfig } from './chartTypes';

const MAX_CHART_ROWS = 1000;

export const CHART_COLORS = [
    '#4285f4', '#ea4335', '#fbbc04', '#34a853',
    '#ff6d00', '#46bdc6', '#7c4dff', '#e91e63',
];

// ── Range parsing ─────────────────────────────────────────────────────────────

export type ParsedRange = {
    startCol: number;   // 1-based
    startRow: number;   // 1-based
    endCol: number;
    endRow: number;
};

export function parseRange(range: string): ParsedRange | null {
    // Support "A1:D10" or "A1" (single cell)
    const upper = range.trim().toUpperCase();
    const m = upper.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) return null;
    const startCol = alphaToNum(m[1]);
    const startRow = parseInt(m[2], 10);
    const endCol = m[3] ? alphaToNum(m[3]) : startCol;
    const endRow = m[4] ? parseInt(m[4], 10) : startRow;
    if (isNaN(startRow) || isNaN(endRow)) return null;
    return {
        startCol: Math.min(startCol, endCol),
        startRow: Math.min(startRow, endRow),
        endCol: Math.max(startCol, endCol),
        endRow: Math.max(startRow, endRow),
    };
}

// ── Cell value helpers ────────────────────────────────────────────────────────

export function getCellValue(data: Map<string, CellProps>, id: string): string {
    const cell = data.get(id);
    return cell?.value ?? cell?.raw ?? '';
}

function isNumeric(v: string): boolean {
    return v.trim() !== '' && !isNaN(Number(v.replace(/[$,%]/g, '')));
}

// ── Auto-detect chart config ──────────────────────────────────────────────────

export function autoDetectChartConfig(
    dataRange: string,
    data: Map<string, CellProps>,
): Pick<ChartDef, 'hasHeaders' | 'seriesInRows' | 'series'> {
    const range = parseRange(dataRange);
    if (!range) {
        return { hasHeaders: true, seriesInRows: false, series: [] };
    }

    const { startCol, startRow, endCol } = range;

    // Check if the first row looks like headers (non-numeric values in data columns)
    const firstRowSecondCell = getCellValue(data, `${numToAlpha(startCol + 1)}${startRow}`);
    const hasHeaders = firstRowSecondCell !== '' && !isNumeric(firstRowSecondCell);

    // Build series array: one series per data column (column-oriented by default)
    const series: ChartSeries[] = [];
    const dataStartCol = startCol + 1; // first col is categories

    for (let c = dataStartCol; c <= endCol; c++) {
        const headerRow = startRow;
        const headerCell = hasHeaders
            ? getCellValue(data, `${numToAlpha(c)}${headerRow}`)
            : `Series ${c - dataStartCol + 1}`;
        const dataStartRow = hasHeaders ? startRow + 1 : startRow;
        const endRow = Math.min(range.endRow, dataStartRow + MAX_CHART_ROWS - 1);
        series.push({
            name: headerCell || `Series ${c - dataStartCol + 1}`,
            dataRange: `${numToAlpha(c)}${dataStartRow}:${numToAlpha(c)}${endRow}`,
            color: CHART_COLORS[(c - dataStartCol) % CHART_COLORS.length],
        });
    }

    return { hasHeaders, seriesInRows: false, series };
}

// ── Extract chart data ────────────────────────────────────────────────────────

export type ChartDataset = {
    name: string;
    data: number[];
    color?: string;
};

export type ExtractedChartData = {
    labels: string[];
    datasets: ChartDataset[];
};

export function extractChartData(
    def: ChartDef,
    data: Map<string, CellProps>,
): ExtractedChartData {
    const range = parseRange(def.dataRange);
    if (!range) return { labels: [], datasets: [] };

    const { startCol, startRow, endCol, endRow: rawEndRow } = range;
    const endRow = Math.min(rawEndRow, startRow + MAX_CHART_ROWS);

    if (def.seriesInRows) {
        return extractSeriesInRows(def, data, { startCol, startRow, endCol, endRow });
    } else {
        return extractSeriesInCols(def, data, { startCol, startRow, endCol, endRow });
    }
}

function extractSeriesInCols(
    def: ChartDef,
    data: Map<string, CellProps>,
    { startCol, startRow, endCol, endRow }: ParsedRange,
): ExtractedChartData {
    const dataStartRow = def.hasHeaders ? startRow + 1 : startRow;
    const catCol = startCol;
    const dataStartCol = startCol + 1;

    // Category labels from first column
    const labels: string[] = [];
    for (let r = dataStartRow; r <= endRow; r++) {
        labels.push(getCellValue(data, `${numToAlpha(catCol)}${r}`) || `Row ${r}`);
    }

    // Series: one per data column
    const datasets: ChartDataset[] = [];
    let colorIdx = 0;
    for (let c = dataStartCol; c <= endCol; c++) {
        const seriesName = def.hasHeaders
            ? getCellValue(data, `${numToAlpha(c)}${startRow}`) || `Series ${c - dataStartCol + 1}`
            : `Series ${c - dataStartCol + 1}`;

        // Find matching series def for color
        const matchedSeries = def.series.find(s => s.name === seriesName);
        const color = matchedSeries?.color ?? CHART_COLORS[colorIdx % CHART_COLORS.length];
        colorIdx++;

        const values: number[] = [];
        for (let r = dataStartRow; r <= endRow; r++) {
            const raw = getCellValue(data, `${numToAlpha(c)}${r}`);
            values.push(isNumeric(raw) ? Number(raw.replace(/[$,%]/g, '')) : 0);
        }
        datasets.push({ name: seriesName, data: values, color });
    }

    return { labels, datasets };
}

function extractSeriesInRows(
    def: ChartDef,
    data: Map<string, CellProps>,
    { startCol, startRow, endCol, endRow }: ParsedRange,
): ExtractedChartData {
    const dataStartCol = def.hasHeaders ? startCol + 1 : startCol;
    const catRow = startRow;
    const dataStartRow = startRow + 1;

    // Category labels from first row
    const labels: string[] = [];
    for (let c = dataStartCol; c <= endCol; c++) {
        labels.push(getCellValue(data, `${numToAlpha(c)}${catRow}`) || `Col ${c}`);
    }

    const datasets: ChartDataset[] = [];
    let colorIdx = 0;
    for (let r = dataStartRow; r <= endRow; r++) {
        const seriesName = def.hasHeaders
            ? getCellValue(data, `${numToAlpha(startCol)}${r}`) || `Series ${r - dataStartRow + 1}`
            : `Series ${r - dataStartRow + 1}`;

        const matchedSeries = def.series.find(s => s.name === seriesName);
        const color = matchedSeries?.color ?? CHART_COLORS[colorIdx % CHART_COLORS.length];
        colorIdx++;

        const values: number[] = [];
        for (let c = dataStartCol; c <= endCol; c++) {
            const raw = getCellValue(data, `${numToAlpha(c)}${r}`);
            values.push(isNumeric(raw) ? Number(raw.replace(/[$,%]/g, '')) : 0);
        }
        datasets.push({ name: seriesName, data: values, color });
    }

    return { labels, datasets };
}

// ── ID generation ─────────────────────────────────────────────────────────────

export function generateChartId(): string {
    return `chart-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Histogram binning ─────────────────────────────────────────────────────────

export type HistogramBin = {
    label: string;
    count: number;
    min: number;
    max: number;
};

export function computeHistogramBins(values: number[], binCount: number = 10): HistogramBin[] {
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
        return [{ label: String(min), count: values.length, min, max }];
    }
    const binWidth = (max - min) / binCount;
    const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
        label: `${(min + i * binWidth).toFixed(1)}–${(min + (i + 1) * binWidth).toFixed(1)}`,
        count: 0,
        min: min + i * binWidth,
        max: min + (i + 1) * binWidth,
    }));
    for (const v of values) {
        const idx = Math.min(Math.floor((v - min) / binWidth), binCount - 1);
        bins[idx].count++;
    }
    return bins;
}

// ── Waterfall running totals ──────────────────────────────────────────────────

export type WaterfallBar = {
    label: string;
    start: number;
    end: number;
    value: number;
    isTotal: boolean;
};

export function computeWaterfallBars(labels: string[], values: number[]): WaterfallBar[] {
    const bars: WaterfallBar[] = [];
    let running = 0;
    labels.forEach((label, i) => {
        const value = values[i] ?? 0;
        const start = running;
        const end = running + value;
        running = end;
        bars.push({ label, start, end, value, isTotal: false });
    });
    // Add a total bar at the end
    bars.push({ label: 'Total', start: 0, end: running, value: running, isTotal: true });
    return bars;
}

// ── 100% stacked normalization ────────────────────────────────────────────────

export function normalize100Percent(datasets: ChartDataset[]): ChartDataset[] {
    const numPoints = datasets[0]?.data.length ?? 0;
    const totals: number[] = Array.from({ length: numPoints }, (_, i) =>
        datasets.reduce((sum, ds) => sum + Math.abs(ds.data[i] ?? 0), 0),
    );
    return datasets.map(ds => ({
        ...ds,
        data: ds.data.map((v, i) => {
            const total = totals[i];
            return total === 0 ? 0 : Math.round(((v / total) * 100) * 100) / 100;
        }),
    }));
}

// ── Axis tick formatter ───────────────────────────────────────────────────────

export function makeTickFormatter(axisConfig?: AxisConfig): ((value: number) => string) | undefined {
    if (!axisConfig?.numberFormat || axisConfig.numberFormat === 'default') {
        return undefined;
    }
    const decimals = axisConfig.decimalPlaces ?? 0;
    const symbol = axisConfig.currencySymbol ?? '$';
    return (v: number) => {
        switch (axisConfig.numberFormat) {
            case 'currency':   return `${symbol}${v.toFixed(decimals)}`;
            case 'percentage': return `${v.toFixed(decimals)}%`;
            case 'number':     return v.toFixed(decimals);
            default:           return String(v);
        }
    };
}

// ── Treemap/Sunburst data builder ─────────────────────────────────────────────

export type TreemapNode = {
    name: string;
    value: number;
    color?: string;
};

export function buildTreemapData(labels: string[], datasets: ChartDataset[]): TreemapNode[] {
    const firstDs = datasets[0];
    if (!firstDs) return [];
    return labels.map((name, i) => ({
        name,
        value: Math.abs(firstDs.data[i] ?? 0),
        color: firstDs.color,
    }));
}
