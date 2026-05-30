'use client';

import React, { useState } from 'react';
import {
    BarChart2, BarChartHorizontal, LineChart, AreaChart,
    PieChart, Circle, ScatterChart, Layers, X, Trash2,
} from 'lucide-react';
import { ColorPickerPopover } from '@neutrino/ui';
import type { CellProps } from '../types';
import type {
    ChartDef, ChartType, LegendPosition, AxisConfig,
    DataLabelConfig, DataLabelType, DataLabelPosition,
    AxisNumberFormat, MarkerStyle,
} from './chartTypes';
import { autoDetectChartConfig } from './chartUtils';
import { CHART_THEMES } from './chartThemes';
import featureFlags from '@/lib/featureFlags';
import styles from './charts.module.css';

interface ChartEditorPanelProps {
    def: ChartDef;
    data: Map<string, CellProps>;
    onUpdate: (patch: Partial<ChartDef>) => void;
    onDelete: () => void;
    onClose: () => void;
}

// Phase 1 chart types
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

// Phase 2 chart types
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

const LEGEND_POSITIONS: { pos: LegendPosition; label: string }[] = [
    { pos: 'top',    label: 'Top' },
    { pos: 'bottom', label: 'Bottom' },
    { pos: 'left',   label: 'Left' },
    { pos: 'right',  label: 'Right' },
    { pos: 'hidden', label: 'Hidden' },
];

// Chart types that have line/marker controls
const LINE_CHART_TYPES: ChartType[] = ['line', 'area', 'scatter', 'combo'];

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

    function updateYAxis(patch: Partial<AxisConfig>) {
        onUpdate({ yAxis: { ...def.yAxis, ...patch } });
    }

    function updateDataLabel(patch: Partial<DataLabelConfig>) {
        const current: DataLabelConfig = def.dataLabel ?? {
            show: def.showDataLabels,
            type: 'value',
            position: 'top',
        };
        onUpdate({ dataLabel: { ...current, ...patch } });
    }

    function updateSeriesColor(seriesName: string, color: string) {
        onUpdate({ series: def.series.map(s => s.name === seriesName ? { ...s, color } : s) });
    }

    function updateSeriesProp<K extends keyof import('./chartTypes').ChartSeries>(
        seriesName: string,
        key: K,
        value: import('./chartTypes').ChartSeries[K],
    ) {
        onUpdate({ series: def.series.map(s => s.name === seriesName ? { ...s, [key]: value } : s) });
    }

    const allChartTypes = featureFlags.sheetsChartsPhase2
        ? [...P1_CHART_TYPES, ...P2_CHART_TYPES]
        : P1_CHART_TYPES;

    const currentDataLabel: DataLabelConfig = def.dataLabel ?? {
        show: def.showDataLabels,
        type: 'value',
        position: 'top',
    };

    const isLineType = LINE_CHART_TYPES.includes(def.type);

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
                        {allChartTypes.map(({ type, label, Icon }) => (
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

                {/* Titles */}
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

                {/* Display (Phase 1 toggles) */}
                <div className={styles.editorSection}>
                    <div className={styles.editorSectionTitle}>Display</div>
                    <label className={styles.checkboxRow}>
                        <input
                            type="checkbox"
                            checked={def.showDataLabels}
                            onChange={e => {
                                onUpdate({ showDataLabels: e.target.checked });
                                updateDataLabel({ show: e.target.checked });
                            }}
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
                            showAlpha={true}
                        />
                    </div>
                    <div className={styles.colorRow}>
                        <span>Plot area</span>
                        <ColorPickerPopover
                            color={def.plotAreaColor || '#ffffff'}
                            onChange={v => onUpdate({ plotAreaColor: v })}
                        />
                    </div>
                </div>

                {/* Phase 2: Themes */}
                {featureFlags.sheetsChartsPhase2 && (
                    <div className={styles.editorSection}>
                        <div className={styles.editorSectionTitle}>Theme</div>
                        <div className={styles.themeGrid}>
                            {Object.values(CHART_THEMES).map(theme => (
                                <button
                                    key={theme.name}
                                    className={`${styles.themeBtn} ${(def.theme ?? 'default') === theme.name ? styles.themeBtnActive : ''}`}
                                    onClick={() => onUpdate({
                                        theme: theme.name,
                                        backgroundColor: theme.backgroundColor,
                                        plotAreaColor: theme.plotAreaColor,
                                    })}
                                >
                                    <div className={styles.themeSwatches}>
                                        {theme.colors.slice(0, 4).map((c, i) => (
                                            <div key={i} className={styles.themeSwatch} style={{ background: c }} />
                                        ))}
                                    </div>
                                    <span className={styles.themeLabel}>{theme.displayName}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Phase 2: Y Axis controls */}
                {featureFlags.sheetsChartsPhase2 && (
                    <div className={styles.editorSection}>
                        <div className={styles.editorSectionTitle}>Y Axis</div>
                        <div className={styles.twoColRow}>
                            <div className={styles.fieldGroup}>
                                <div className={styles.fieldLabel}>Min</div>
                                <input
                                    className={styles.fieldInput}
                                    type="number"
                                    placeholder="Auto"
                                    value={def.yAxis?.min ?? ''}
                                    onChange={e => updateYAxis({
                                        min: e.target.value === '' ? undefined : Number(e.target.value),
                                    })}
                                />
                            </div>
                            <div className={styles.fieldGroup}>
                                <div className={styles.fieldLabel}>Max</div>
                                <input
                                    className={styles.fieldInput}
                                    type="number"
                                    placeholder="Auto"
                                    value={def.yAxis?.max ?? ''}
                                    onChange={e => updateYAxis({
                                        max: e.target.value === '' ? undefined : Number(e.target.value),
                                    })}
                                />
                            </div>
                        </div>
                        <label className={styles.checkboxRow}>
                            <input
                                type="checkbox"
                                checked={def.yAxis?.logScale ?? false}
                                onChange={e => updateYAxis({ logScale: e.target.checked })}
                            />
                            Logarithmic scale
                        </label>
                        <label className={styles.checkboxRow}>
                            <input
                                type="checkbox"
                                checked={def.yAxis?.reversed ?? false}
                                onChange={e => updateYAxis({ reversed: e.target.checked })}
                            />
                            Reverse axis
                        </label>
                        <div className={styles.fieldGroup}>
                            <div className={styles.fieldLabel}>Number format</div>
                            <select
                                className={styles.fieldInput}
                                value={def.yAxis?.numberFormat ?? 'default'}
                                onChange={e => updateYAxis({ numberFormat: e.target.value as AxisNumberFormat })}
                            >
                                <option value="default">Default</option>
                                <option value="number">Number</option>
                                <option value="currency">Currency</option>
                                <option value="percentage">Percentage</option>
                            </select>
                        </div>
                        {def.yAxis?.numberFormat === 'currency' && (
                            <div className={styles.fieldGroup}>
                                <div className={styles.fieldLabel}>Currency symbol</div>
                                <input
                                    className={styles.fieldInput}
                                    value={def.yAxis?.currencySymbol ?? '$'}
                                    onChange={e => updateYAxis({ currencySymbol: e.target.value })}
                                    placeholder="$"
                                    maxLength={4}
                                />
                            </div>
                        )}
                        {def.yAxis?.numberFormat !== 'default' && def.yAxis?.numberFormat !== undefined && (
                            <div className={styles.fieldGroup}>
                                <div className={styles.fieldLabel}>Decimal places</div>
                                <input
                                    className={styles.fieldInput}
                                    type="number"
                                    min={0}
                                    max={6}
                                    value={def.yAxis?.decimalPlaces ?? 0}
                                    onChange={e => updateYAxis({ decimalPlaces: Number(e.target.value) })}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Phase 2: Series controls */}
                {featureFlags.sheetsChartsPhase2 && def.series.length > 0 && (
                    <div className={styles.editorSection}>
                        <div className={styles.editorSectionTitle}>Series</div>
                        {def.series.map(s => (
                            <div key={s.name} className={styles.seriesRow}>
                                <label className={styles.seriesVisibilityCheck} title="Show/hide series">
                                    <input
                                        type="checkbox"
                                        checked={s.visible !== false}
                                        onChange={e => updateSeriesProp(s.name, 'visible', e.target.checked)}
                                    />
                                </label>
                                <span className={styles.seriesName} title={s.name}>{s.name}</span>
                                <ColorPickerPopover
                                    color={s.color ?? '#4285f4'}
                                    onChange={v => updateSeriesColor(s.name, v)}
                                />
                                {isLineType && (
                                    <input
                                        className={styles.thicknessInput}
                                        type="number"
                                        min={1}
                                        max={8}
                                        title="Line thickness"
                                        value={s.lineThickness ?? 2}
                                        onChange={e => updateSeriesProp(s.name, 'lineThickness', Number(e.target.value))}
                                    />
                                )}
                            </div>
                        ))}
                        {isLineType && (
                            <div className={styles.fieldGroup} style={{ marginTop: 8 }}>
                                <div className={styles.fieldLabel}>Marker style (all series)</div>
                                <select
                                    className={styles.fieldInput}
                                    value={def.series[0]?.markerStyle ?? 'circle'}
                                    onChange={e => {
                                        const val = e.target.value as MarkerStyle;
                                        onUpdate({ series: def.series.map(s => ({ ...s, markerStyle: val })) });
                                    }}
                                >
                                    <option value="circle">Circle</option>
                                    <option value="square">Square</option>
                                    <option value="triangle">Triangle</option>
                                    <option value="diamond">Diamond</option>
                                    <option value="none">None</option>
                                </select>
                            </div>
                        )}
                    </div>
                )}

                {/* Phase 2: Data Labels config */}
                {featureFlags.sheetsChartsPhase2 && (
                    <div className={styles.editorSection}>
                        <div className={styles.editorSectionTitle}>Data Labels</div>
                        <label className={styles.checkboxRow}>
                            <input
                                type="checkbox"
                                checked={currentDataLabel.show}
                                onChange={e => {
                                    onUpdate({ showDataLabels: e.target.checked });
                                    updateDataLabel({ show: e.target.checked });
                                }}
                            />
                            Show labels
                        </label>
                        {currentDataLabel.show && (
                            <>
                                <div className={styles.fieldGroup}>
                                    <div className={styles.fieldLabel}>Label type</div>
                                    <select
                                        className={styles.fieldInput}
                                        value={currentDataLabel.type}
                                        onChange={e => updateDataLabel({ type: e.target.value as DataLabelType })}
                                    >
                                        <option value="value">Value</option>
                                        <option value="percentage">Percentage</option>
                                        <option value="category">Category</option>
                                        <option value="custom">Custom</option>
                                    </select>
                                </div>
                                {currentDataLabel.type === 'custom' && (
                                    <div className={styles.fieldGroup}>
                                        <div className={styles.fieldLabel}>Custom text</div>
                                        <input
                                            className={styles.fieldInput}
                                            value={currentDataLabel.customText ?? ''}
                                            onChange={e => updateDataLabel({ customText: e.target.value })}
                                            placeholder="Label text"
                                        />
                                    </div>
                                )}
                                <div className={styles.fieldGroup}>
                                    <div className={styles.fieldLabel}>Position</div>
                                    <select
                                        className={styles.fieldInput}
                                        value={currentDataLabel.position}
                                        onChange={e => updateDataLabel({ position: e.target.value as DataLabelPosition })}
                                    >
                                        <option value="top">Top</option>
                                        <option value="bottom">Bottom</option>
                                        <option value="center">Center</option>
                                        <option value="inside">Inside</option>
                                        <option value="outside">Outside</option>
                                    </select>
                                </div>
                                <div className={styles.fieldGroup}>
                                    <div className={styles.fieldLabel}>Font size</div>
                                    <input
                                        className={styles.fieldInput}
                                        type="number"
                                        min={8}
                                        max={18}
                                        value={currentDataLabel.fontSize ?? 10}
                                        onChange={e => updateDataLabel({ fontSize: Number(e.target.value) })}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Delete */}
                <button className={styles.deleteBtn} onClick={onDelete}>
                    <Trash2 size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                    Delete Chart
                </button>
            </div>
        </div>
    );
}
