'use client';

import React, { useState } from 'react';
import {
    BarChart2, BarChartHorizontal, LineChart, AreaChart,
    PieChart, Circle, ScatterChart, Layers, X, Trash2,
} from 'lucide-react';
import { ColorPickerPopover } from '@neutrino/ui';
import type { CellProps } from '../types';
import type { ChartDef, ChartType, LegendPosition } from './chartTypes';
import { autoDetectChartConfig } from './chartUtils';
import styles from './charts.module.css';

interface ChartEditorPanelProps {
    def: ChartDef;
    data: Map<string, CellProps>;
    onUpdate: (patch: Partial<ChartDef>) => void;
    onDelete: () => void;
    onClose: () => void;
}

const CHART_TYPES: { type: ChartType; label: string; Icon: React.ElementType }[] = [
    { type: 'column',  label: 'Column',  Icon: BarChart2 },
    { type: 'bar',     label: 'Bar',     Icon: BarChartHorizontal },
    { type: 'line',    label: 'Line',    Icon: LineChart },
    { type: 'area',    label: 'Area',    Icon: AreaChart },
    { type: 'pie',     label: 'Pie',     Icon: PieChart },
    { type: 'donut',   label: 'Donut',   Icon: Circle },
    { type: 'scatter', label: 'Scatter', Icon: ScatterChart },
    { type: 'combo',   label: 'Combo',   Icon: Layers },
];

const LEGEND_POSITIONS: { pos: LegendPosition; label: string }[] = [
    { pos: 'top',    label: 'Top' },
    { pos: 'bottom', label: 'Bottom' },
    { pos: 'left',   label: 'Left' },
    { pos: 'right',  label: 'Right' },
    { pos: 'hidden', label: 'Hidden' },
];

export function ChartEditorPanel({ def, data, onUpdate, onDelete, onClose }: ChartEditorPanelProps) {
    const [localRange, setLocalRange] = useState(def.dataRange);

    function applyRange() {
        const detected = autoDetectChartConfig(localRange, data);
        onUpdate({
            dataRange: localRange,
            hasHeaders: detected.hasHeaders,
            seriesInRows: detected.seriesInRows,
            series: detected.series,
        });
    }

    return (
        <div className={styles.editorPanel}>
            <div className={styles.editorPanelHeader}>
                <span className={styles.editorPanelTitle}>Chart</span>
                <button className={styles.editorPanelClose} onClick={onClose} aria-label="Close chart editor">
                    <X size={15} />
                </button>
            </div>

            <div className={styles.editorPanelBody}>
                {/* Chart type */}
                <div className={styles.editorSection}>
                    <div className={styles.editorSectionTitle}>Type</div>
                    <div className={styles.chartTypePicker}>
                        {CHART_TYPES.map(({ type, label, Icon }) => (
                            <button
                                key={type}
                                className={`${styles.chartTypeBtn} ${def.type === type ? styles.chartTypeBtnActive : ''}`}
                                onClick={() => onUpdate({ type })}
                            >
                                <Icon size={15} />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Data */}
                <div className={styles.editorSection}>
                    <div className={styles.editorSectionTitle}>Data</div>
                    <div className={styles.fieldGroup}>
                        <div className={styles.fieldLabel}>Range</div>
                        <input
                            className={styles.fieldInput}
                            value={localRange}
                            onChange={e => setLocalRange(e.target.value)}
                            onBlur={applyRange}
                            onKeyDown={e => { if (e.key === 'Enter') applyRange(); }}
                            placeholder="e.g. A1:D10"
                        />
                    </div>
                    <label className={styles.checkboxRow}>
                        <input
                            type="checkbox"
                            checked={def.hasHeaders}
                            onChange={e => onUpdate({ hasHeaders: e.target.checked })}
                        />
                        Has headers
                    </label>
                    <label className={styles.checkboxRow}>
                        <input
                            type="checkbox"
                            checked={def.seriesInRows}
                            onChange={e => onUpdate({ seriesInRows: e.target.checked })}
                        />
                        Series in rows
                    </label>
                </div>

                {/* Title */}
                <div className={styles.editorSection}>
                    <div className={styles.editorSectionTitle}>Titles</div>
                    <div className={styles.fieldGroup}>
                        <div className={styles.fieldLabel}>Chart title</div>
                        <input
                            className={styles.fieldInput}
                            value={def.title}
                            onChange={e => onUpdate({ title: e.target.value })}
                            placeholder="Chart title"
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <div className={styles.fieldLabel}>X axis title</div>
                        <input
                            className={styles.fieldInput}
                            value={def.xAxisTitle}
                            onChange={e => onUpdate({ xAxisTitle: e.target.value })}
                            placeholder="X axis"
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <div className={styles.fieldLabel}>Y axis title</div>
                        <input
                            className={styles.fieldInput}
                            value={def.yAxisTitle}
                            onChange={e => onUpdate({ yAxisTitle: e.target.value })}
                            placeholder="Y axis"
                        />
                    </div>
                </div>

                {/* Legend */}
                <div className={styles.editorSection}>
                    <div className={styles.editorSectionTitle}>Legend</div>
                    <div className={styles.legendButtons}>
                        {LEGEND_POSITIONS.map(({ pos, label }) => (
                            <button
                                key={pos}
                                className={`${styles.legendBtn} ${def.legendPosition === pos ? styles.legendBtnActive : ''}`}
                                onClick={() => onUpdate({ legendPosition: pos })}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Labels & gridlines */}
                <div className={styles.editorSection}>
                    <div className={styles.editorSectionTitle}>Display</div>
                    <label className={styles.checkboxRow}>
                        <input
                            type="checkbox"
                            checked={def.showDataLabels}
                            onChange={e => onUpdate({ showDataLabels: e.target.checked })}
                        />
                        Show data labels
                    </label>
                    <label className={styles.checkboxRow}>
                        <input
                            type="checkbox"
                            checked={def.showGridlines}
                            onChange={e => onUpdate({ showGridlines: e.target.checked })}
                        />
                        Show gridlines
                    </label>
                </div>

                {/* Colors */}
                <div className={styles.editorSection}>
                    <div className={styles.editorSectionTitle}>Colors</div>
                    <div className={styles.colorRow}>
                        <span>Background</span>
                        <ColorPickerPopover
                            color={def.backgroundColor || '#ffffff'}
                            onChange={v => onUpdate({ backgroundColor: v })}
                        >
                            <button
                                className={styles.colorSwatch}
                                style={{ background: def.backgroundColor || '#ffffff' }}
                                aria-label="Background color"
                            />
                        </ColorPickerPopover>
                    </div>
                    <div className={styles.colorRow}>
                        <span>Plot area</span>
                        <ColorPickerPopover
                            color={def.plotAreaColor || '#ffffff'}
                            onChange={v => onUpdate({ plotAreaColor: v })}
                        >
                            <button
                                className={styles.colorSwatch}
                                style={{ background: def.plotAreaColor || '#ffffff' }}
                                aria-label="Plot area color"
                            />
                        </ColorPickerPopover>
                    </div>
                </div>

                {/* Delete */}
                <button className={styles.deleteBtn} onClick={onDelete}>
                    <Trash2 size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                    Delete Chart
                </button>
            </div>
        </div>
    );
}
