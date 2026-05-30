// Chart data model for Neutrino Sheets Phase 1 charting.

export type ChartType =
    | 'column'
    | 'bar'
    | 'line'
    | 'area'
    | 'pie'
    | 'donut'
    | 'scatter'
    | 'combo';

export type LegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'hidden';

export type ChartSeries = {
    name: string;
    dataRange: string;    // e.g. "B2:B10"
    color?: string;
    chartType?: ChartType; // per-series override for combo charts
};

export type ChartDef = {
    id: string;
    type: ChartType;
    dataRange: string;    // source range e.g. "A1:D10"
    hasHeaders: boolean;
    seriesInRows: boolean;
    series: ChartSeries[];
    // Position in pixels from top-left of grid content area
    x: number;
    y: number;
    w: number;
    h: number;
    // Formatting
    title: string;
    xAxisTitle: string;
    yAxisTitle: string;
    legendPosition: LegendPosition;
    showDataLabels: boolean;
    showGridlines: boolean;
    backgroundColor: string;
    plotAreaColor: string;
};
