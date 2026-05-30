// Chart data model for Neutrino Sheets Phase 1 + Phase 2 charting.

export type ChartType =
    | 'column'
    | 'bar'
    | 'line'
    | 'area'
    | 'pie'
    | 'donut'
    | 'scatter'
    | 'combo'
    // Phase 2
    | 'stacked-column'
    | 'stacked-bar'
    | 'stacked-column-100'
    | 'stacked-bar-100'
    | 'bubble'
    | 'histogram'
    | 'candlestick'
    | 'waterfall'
    | 'treemap'
    | 'sunburst';

export type LegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'hidden';

// Phase 2: axis configuration
export type AxisNumberFormat = 'default' | 'currency' | 'percentage' | 'number';

export type AxisConfig = {
    min?: number;
    max?: number;
    tickInterval?: number;
    logScale?: boolean;
    reversed?: boolean;
    dateAxis?: boolean;
    numberFormat?: AxisNumberFormat;
    currencySymbol?: string;
    decimalPlaces?: number;
};

// Phase 2: data label configuration
export type DataLabelType = 'value' | 'percentage' | 'category' | 'custom';
export type DataLabelPosition = 'top' | 'bottom' | 'inside' | 'outside' | 'center';

export type DataLabelConfig = {
    show: boolean;
    type: DataLabelType;
    customText?: string;
    position: DataLabelPosition;
    fontSize?: number;
    color?: string;
};

// Phase 2: marker styles for line/area/scatter
export type MarkerStyle = 'circle' | 'square' | 'triangle' | 'diamond' | 'none';

export type ChartSeries = {
    name: string;
    dataRange: string;    // e.g. "B2:B10"
    color?: string;
    chartType?: ChartType; // per-series override for combo charts
    // Phase 2
    lineThickness?: number;
    markerStyle?: MarkerStyle;
    markerSize?: number;
    visible?: boolean;
    yAxisId?: 'left' | 'right';
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
    // Phase 2
    xAxis?: AxisConfig;
    yAxis?: AxisConfig;
    y2Axis?: AxisConfig;
    dataLabel?: DataLabelConfig;
    theme?: string;
};
