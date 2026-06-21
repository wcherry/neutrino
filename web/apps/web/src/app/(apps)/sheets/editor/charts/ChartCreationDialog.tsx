'use client';

import React, { useState, useMemo } from 'react';
import {
    BarChart2, BarChartHorizontal, LineChart, AreaChart,
    PieChart, Circle, ScatterChart, Layers, X,
} from 'lucide-react';
import type { CellProps } from '../types';
import type { ChartDef, ChartType } from './chartTypes';
import { ChartRenderer } from './ChartRenderer';
import { autoDetectChartConfig, generateChartId } from './chartUtils';
import styles from './charts.module.css';

interface ChartCreationDialogProps {
    initialRange: string;
    data: Map<string, CellProps>;
    onConfirm: (def: ChartDef) => void;
    onClose: () => void;
}

const P1_CHART_TYPES: { type: ChartType; label: string; Icon: React.ElementType }[] = [
    { type: 'column',  label: 'Column',  Icon: BarChart2 },
    { type: 'bar',     label: 'Bar',     Icon: BarChartHorizontal },
    { type: 'line',    label: 'Line',    Icon: LineChart },
    { type: 'area',    label: 'Area',    Icon: AreaChart },
    { type: 'pie',     label: 'Pie',     Icon: PieChart },
    { type: 'donut',   label: 'Donut',   Icon: Circle },
    { type: 'scatter', label: 'Scatter', Icon: ScatterChart },
    { type: 'combo',   label: 'Combo',   Icon: Layers },
];

const P2_CHART_TYPES: { type: ChartType; label: string; Icon: React.ElementType }[] = [
    { type: 'stacked-column',     label: 'Stacked Col', Icon: BarChart2 },
    { type: 'stacked-bar',        label: 'Stacked Bar', Icon: BarChartHorizontal },
    { type: 'stacked-column-100', label: '100% Col',    Icon: BarChart2 },
    { type: 'stacked-bar-100',    label: '100% Bar',    Icon: BarChartHorizontal },
    { type: 'bubble',             label: 'Bubble',      Icon: Circle },
    { type: 'histogram',          label: 'Histogram',   Icon: BarChart2 },
    { type: 'candlestick',        label: 'Candlestick', Icon: LineChart },
    { type: 'waterfall',          label: 'Waterfall',   Icon: BarChart2 },
    { type: 'treemap',            label: 'Treemap',     Icon: Layers },
    { type: 'sunburst',           label: 'Sunburst',    Icon: PieChart },
];

export function ChartCreationDialog({
    initialRange,
    data,
    onConfirm,
    onClose,
}: ChartCreationDialogProps) {
    const [chartType, setChartType] = useState<ChartType>('column');
    const [dataRange, setDataRange] = useState(initialRange);
    const [hasHeaders, setHasHeaders] = useState(true);
    const [seriesInRows, setSeriesInRows] = useState(false);

    const allChartTypes = [...P1_CHART_TYPES, ...P2_CHART_TYPES];

    // Build a live preview ChartDef from current dialog state.
    const previewDef = useMemo<ChartDef>(() => {
        const detected = autoDetectChartConfig(dataRange, data);
        return {
            id: 'preview',
            type: chartType,
            dataRange,
            hasHeaders,
            seriesInRows,
            series: detected.series,
            x: 0, y: 0, w: 480, h: 300,
            title: '',
            xAxisTitle: '',
            yAxisTitle: '',
            legendPosition: 'bottom',
            showDataLabels: false,
            showGridlines: true,
            backgroundColor: '#ffffff',
            plotAreaColor: 'transparent',
        };
    }, [chartType, dataRange, hasHeaders, seriesInRows, data]);

    function handleConfirm() {
        const detected = autoDetectChartConfig(dataRange, data);
        const def: ChartDef = {
            id: generateChartId(),
            type: chartType,
            dataRange,
            hasHeaders,
            seriesInRows,
            series: detected.series,
            // Default position: offset from top-left so it doesn't cover the header row
            x: 200,
            y: 60,
            w: 480,
            h: 320,
            title: '',
            xAxisTitle: '',
            yAxisTitle: '',
            legendPosition: 'bottom',
            showDataLabels: false,
            showGridlines: true,
            backgroundColor: '#ffffff',
            plotAreaColor: 'transparent',
        };
        onConfirm(def);
    }

    return (
        <div className={styles.dialogOverlay} onMouseDown={onClose}>
            <div className={styles.dialogBox} onMouseDown={e => e.stopPropagation()}>
                <div className={styles.dialogHeader}>
                    <span className={styles.dialogTitle}>Insert Chart</span>
                    <button className={styles.dialogClose} onClick={onClose} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>

                <div className={styles.dialogBody}>
                    {/* Left panel */}
                    <div className={styles.dialogLeft}>
                        <div className={styles.fieldGroup}>
                            <div className={styles.fieldLabel}>Chart Type</div>
                            <div className={styles.chartTypePicker}>
                                {allChartTypes.map(({ type, label, Icon }) => (
                                    <button
                                        key={type}
                                        className={`${styles.chartTypeBtn} ${chartType === type ? styles.chartTypeBtnActive : ''}`}
                                        onClick={() => setChartType(type)}
                                    >
                                        <Icon size={18} />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.fieldGroup}>
                            <div className={styles.fieldLabel}>Data Range</div>
                            <input
                                className={styles.fieldInput}
                                value={dataRange}
                                onChange={e => setDataRange(e.target.value)}
                                placeholder="e.g. A1:D10"
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label className={styles.checkboxRow}>
                                <input
                                    type="checkbox"
                                    checked={hasHeaders}
                                    onChange={e => setHasHeaders(e.target.checked)}
                                />
                                Has headers
                            </label>
                            <label className={styles.checkboxRow}>
                                <input
                                    type="checkbox"
                                    checked={seriesInRows}
                                    onChange={e => setSeriesInRows(e.target.checked)}
                                />
                                Series in rows
                            </label>
                        </div>
                    </div>

                    {/* Right panel: live preview */}
                    <div className={styles.dialogRight}>
                        <div className={styles.dialogPreviewLabel}>Preview</div>
                        <div className={styles.dialogPreview}>
                            <ChartRenderer def={previewDef} data={data} />
                        </div>
                    </div>
                </div>

                <div className={styles.dialogFooter}>
                    <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
                    <button className={styles.btnPrimary} data-testid="insert-chart-submit" onClick={handleConfirm}>Insert Chart</button>
                </div>
            </div>
        </div>
    );
}
