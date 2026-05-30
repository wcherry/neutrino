'use client';

import React from 'react';
import {
    ResponsiveContainer,
    BarChart, Bar,
    LineChart, Line,
    AreaChart, Area,
    PieChart, Pie, Cell,
    ScatterChart, Scatter,
    ComposedChart,
    XAxis, YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    LabelList,
    Label,
    ZAxis,
    Treemap,
} from 'recharts';
import type { CellProps } from '../types';
import type { ChartDef, AxisConfig, DataLabelConfig } from './chartTypes';
import {
    extractChartData,
    CHART_COLORS,
    computeHistogramBins,
    computeWaterfallBars,
    normalize100Percent,
    makeTickFormatter,
    buildTreemapData,
} from './chartUtils';
import { getTheme } from './chartThemes';
import featureFlags from '@/lib/featureFlags';

interface ChartRendererProps {
    def: ChartDef;
    data: Map<string, CellProps>;
    width?: number;
    height?: number;
}

// ── Legend position mapper ────────────────────────────────────────────────────

function getLegendProps(position: ChartDef['legendPosition']): object | null {
    if (position === 'hidden') return null;
    const base = { wrapperStyle: { fontSize: 12, paddingTop: 4, paddingBottom: 4 } };
    switch (position) {
        case 'top':    return { ...base, verticalAlign: 'top' as const,    align: 'center' as const };
        case 'bottom': return { ...base, verticalAlign: 'bottom' as const, align: 'center' as const };
        case 'left':   return { ...base, verticalAlign: 'middle' as const, align: 'left' as const,  layout: 'vertical' as const };
        case 'right':  return { ...base, verticalAlign: 'middle' as const, align: 'right' as const, layout: 'vertical' as const };
        default:       return base;
    }
}

// ── No data fallback ──────────────────────────────────────────────────────────

function NoData({ message }: { message?: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 13, textAlign: 'center', padding: 12 }}>
            {message ?? 'No data'}
        </div>
    );
}

// ── Shared chart data builder ─────────────────────────────────────────────────

function buildRechartsData(labels: string[], datasets: { name: string; data: number[]; color?: string }[]) {
    return labels.map((label, i) => {
        const entry: Record<string, string | number> = { label };
        datasets.forEach(ds => { entry[ds.name] = ds.data[i] ?? 0; });
        return entry;
    });
}

// ── YAxis domain helper ───────────────────────────────────────────────────────

function getYAxisDomain(axisConfig?: AxisConfig): [number | string, number | string] {
    const min = axisConfig?.min !== undefined ? axisConfig.min : 'auto';
    const max = axisConfig?.max !== undefined ? axisConfig.max : 'auto';
    return [min, max];
}

// ── Data label position mapper ────────────────────────────────────────────────

function getLabelPosition(cfg?: DataLabelConfig): string {
    if (!cfg) return 'top';
    switch (cfg.position) {
        case 'top':     return 'top';
        case 'bottom':  return 'bottom';
        case 'inside':  return 'insideTop';
        case 'center':  return 'center';
        case 'outside': return 'top';
        default:        return 'top';
    }
}

// ── Sunburst custom SVG renderer ──────────────────────────────────────────────

interface SunburstProps {
    labels: string[];
    values: number[];
    colors: string[];
    showLabels: boolean;
    axisTextColor: string;
}

function SunburstChart({ labels, values, colors, showLabels, axisTextColor }: SunburstProps) {
    const total = values.reduce((s, v) => s + Math.abs(v), 0);
    if (total === 0) return <NoData />;

    const cx = 150, cy = 150, outerR = 120, innerR = 60;
    let angle = -Math.PI / 2;
    const slices = labels.map((label, i) => {
        const value = Math.abs(values[i] ?? 0);
        const sweep = (value / total) * 2 * Math.PI;
        const startAngle = angle;
        angle += sweep;
        const endAngle = angle;
        const midAngle = startAngle + sweep / 2;
        return { label, value, startAngle, endAngle, midAngle, color: colors[i % colors.length] };
    });

    return (
        <svg viewBox="0 0 300 300" width="100%" height="100%">
            {slices.map((s, i) => {
                const x1 = cx + outerR * Math.cos(s.startAngle);
                const y1 = cy + outerR * Math.sin(s.startAngle);
                const x2 = cx + outerR * Math.cos(s.endAngle);
                const y2 = cy + outerR * Math.sin(s.endAngle);
                const ix1 = cx + innerR * Math.cos(s.startAngle);
                const iy1 = cy + innerR * Math.sin(s.startAngle);
                const ix2 = cx + innerR * Math.cos(s.endAngle);
                const iy2 = cy + innerR * Math.sin(s.endAngle);
                const largeArc = s.endAngle - s.startAngle > Math.PI ? 1 : 0;
                const d = [
                    `M ${ix1} ${iy1}`,
                    `L ${x1} ${y1}`,
                    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
                    `L ${ix2} ${iy2}`,
                    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1}`,
                    'Z',
                ].join(' ');
                const lx = cx + (outerR + 16) * Math.cos(s.midAngle);
                const ly = cy + (outerR + 16) * Math.sin(s.midAngle);
                return (
                    <g key={i}>
                        <path d={d} fill={s.color} stroke="#fff" strokeWidth={1.5} />
                        {showLabels && s.endAngle - s.startAngle > 0.25 && (
                            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                                fontSize={10} fill={axisTextColor}>
                                {s.label}
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

// ── ChartRenderer ─────────────────────────────────────────────────────────────

export function ChartRenderer({ def, data, width, height }: ChartRendererProps) {
    const { labels, datasets } = extractChartData(def, data);
    const legendProps = getLegendProps(def.legendPosition);

    // Resolve theme (Phase 2 feature-flagged)
    const theme = featureFlags.sheetsChartsPhase2 ? getTheme(def.theme) : null;
    const palette = theme ? theme.colors : CHART_COLORS;
    const bgColor = def.backgroundColor || (theme?.backgroundColor ?? '#ffffff');
    const plotColor = def.plotAreaColor || (theme?.plotAreaColor ?? 'transparent');
    const gridColor = theme?.gridlineColor ?? '#e5e7eb';
    const axisTextColor = theme?.axisColor ?? '#6b7280';
    const textColor = theme?.textColor ?? '#1a1a1a';

    const grid = def.showGridlines ? <CartesianGrid strokeDasharray="3 3" stroke={gridColor} /> : null;
    const isEmpty = datasets.length === 0 || labels.length === 0;

    const containerStyle: React.CSSProperties = {
        background: bgColor,
        width: width ?? '100%',
        height: height ?? '100%',
        display: 'flex',
        flexDirection: 'column',
    };

    const titleEl = def.title ? (
        <div style={{ textAlign: 'center', padding: '6px 12px 2px', fontSize: 13, fontWeight: 600, color: textColor, flexShrink: 0 }}>
            {def.title}
        </div>
    ) : null;

    const wrap = (inner: React.ReactNode) => (
        <div style={containerStyle}>
            {titleEl}
            <div style={{ flex: 1, minHeight: 0 }}>
                {inner}
            </div>
        </div>
    );

    // Axis label helpers
    const xLabel = def.xAxisTitle ? <Label value={def.xAxisTitle} position="insideBottom" offset={-4} style={{ fontSize: 11, fill: axisTextColor }} /> : null;
    const yLabel = def.yAxisTitle ? <Label value={def.yAxisTitle} angle={-90} position="insideLeft" style={{ fontSize: 11, fill: axisTextColor }} /> : null;

    // Phase 2: axis config
    const yDomain = featureFlags.sheetsChartsPhase2 ? getYAxisDomain(def.yAxis) : (['auto', 'auto'] as [string, string]);
    const yTickFormatter = featureFlags.sheetsChartsPhase2 ? makeTickFormatter(def.yAxis) : undefined;
    const xTickFormatter = featureFlags.sheetsChartsPhase2 ? makeTickFormatter(def.xAxis) : undefined;
    const yScaleType = featureFlags.sheetsChartsPhase2 && def.yAxis?.logScale ? 'log' as const : 'linear' as const;
    const yReversed = featureFlags.sheetsChartsPhase2 && (def.yAxis?.reversed ?? false);

    // Phase 2: data label config
    const dlCfg = featureFlags.sheetsChartsPhase2 ? def.dataLabel : undefined;
    const showDL = dlCfg ? dlCfg.show : def.showDataLabels;
    const dlPosition = getLabelPosition(dlCfg);
    const dlStyle: React.CSSProperties = {
        fontSize: dlCfg?.fontSize ?? 10,
        fill: dlCfg?.color ?? axisTextColor,
    };

    // Filter invisible series (Phase 2)
    const visibleDatasets = featureFlags.sheetsChartsPhase2
        ? datasets.filter(ds => {
            const serDef = def.series.find(s => s.name === ds.name);
            return serDef?.visible !== false;
          })
        : datasets;

    const getSeriesDef = (name: string) => def.series.find(s => s.name === name);

    // Shared YAxis props for Phase 2 axis config
    const yAxisBaseProps = featureFlags.sheetsChartsPhase2 ? {
        domain: yDomain,
        tickFormatter: yTickFormatter,
        scale: yScaleType,
        reversed: yReversed,
    } : {};

    if (isEmpty) {
        return wrap(<NoData />);
    }

    // ── Column chart ──────────────────────────────────────────────────────────
    if (def.type === 'column') {
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buildRechartsData(labels, visibleDatasets)}
                    margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}
                    style={{ background: plotColor }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }} tickFormatter={xTickFormatter}>{xLabel}</XAxis>
                    <YAxis tick={{ fontSize: 11, fill: axisTextColor }} {...yAxisBaseProps}>{yLabel}</YAxis>
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                    {visibleDatasets.map((ds, i) => (
                        <Bar key={ds.name} dataKey={ds.name}
                            fill={ds.color ?? palette[i % palette.length]}>
                            {showDL && <LabelList dataKey={ds.name} position={dlPosition as 'top'} style={dlStyle} />}
                        </Bar>
                    ))}
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── Bar chart (horizontal) ────────────────────────────────────────────────
    if (def.type === 'bar') {
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={buildRechartsData(labels, visibleDatasets)}
                    margin={{ top: 8, right: 24, bottom: def.xAxisTitle ? 28 : 8, left: 8 }}>
                    {grid}
                    <XAxis type="number" tick={{ fontSize: 11, fill: axisTextColor }} tickFormatter={yTickFormatter}>{xLabel}</XAxis>
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }} width={80}>{yLabel}</YAxis>
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                    {visibleDatasets.map((ds, i) => (
                        <Bar key={ds.name} dataKey={ds.name}
                            fill={ds.color ?? palette[i % palette.length]}>
                            {showDL && <LabelList dataKey={ds.name} position="right" style={dlStyle} />}
                        </Bar>
                    ))}
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── Line chart ────────────────────────────────────────────────────────────
    if (def.type === 'line') {
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={buildRechartsData(labels, visibleDatasets)}
                    margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }} tickFormatter={xTickFormatter}>{xLabel}</XAxis>
                    <YAxis tick={{ fontSize: 11, fill: axisTextColor }} {...yAxisBaseProps}>{yLabel}</YAxis>
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                    {visibleDatasets.map((ds, i) => {
                        const sd = getSeriesDef(ds.name);
                        const strokeWidth = featureFlags.sheetsChartsPhase2 ? (sd?.lineThickness ?? 2) : 2;
                        const markerSize = featureFlags.sheetsChartsPhase2 ? (sd?.markerSize ?? 3) : 3;
                        const showMarker = !featureFlags.sheetsChartsPhase2 || (sd?.markerStyle ?? 'circle') !== 'none';
                        return (
                            <Line key={ds.name} type="monotone" dataKey={ds.name}
                                stroke={ds.color ?? palette[i % palette.length]}
                                strokeWidth={strokeWidth}
                                dot={showMarker ? { r: markerSize } : false}
                                activeDot={showMarker ? { r: markerSize + 2 } : false}>
                                {showDL && <LabelList dataKey={ds.name} position={dlPosition as 'top'} style={dlStyle} />}
                            </Line>
                        );
                    })}
                </LineChart>
            </ResponsiveContainer>
        );
    }

    // ── Area chart ────────────────────────────────────────────────────────────
    if (def.type === 'area') {
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={buildRechartsData(labels, visibleDatasets)}
                    margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }} tickFormatter={xTickFormatter}>{xLabel}</XAxis>
                    <YAxis tick={{ fontSize: 11, fill: axisTextColor }} {...yAxisBaseProps}>{yLabel}</YAxis>
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                    {visibleDatasets.map((ds, i) => {
                        const color = ds.color ?? palette[i % palette.length];
                        const sd = getSeriesDef(ds.name);
                        const strokeWidth = featureFlags.sheetsChartsPhase2 ? (sd?.lineThickness ?? 2) : 2;
                        return (
                            <Area key={ds.name} type="monotone" dataKey={ds.name}
                                stroke={color} fill={color} fillOpacity={0.3} strokeWidth={strokeWidth}>
                                {showDL && <LabelList dataKey={ds.name} position={dlPosition as 'top'} style={dlStyle} />}
                            </Area>
                        );
                    })}
                </AreaChart>
            </ResponsiveContainer>
        );
    }

    // ── Pie chart ─────────────────────────────────────────────────────────────
    if (def.type === 'pie' || def.type === 'donut') {
        const firstDs = visibleDatasets[0];
        if (!firstDs) return wrap(<NoData />);
        const pieData = labels.map((label, i) => ({ name: label, value: firstDs.data[i] ?? 0 }));
        const innerRadius = def.type === 'donut' ? '55%' : 0;

        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%" cy="50%"
                        outerRadius="75%"
                        innerRadius={innerRadius}
                        label={showDL ? (props: { name?: string; percent?: number }) => `${props.name ?? ''} ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%` : undefined}
                        labelLine={showDL}
                    >
                        {pieData.map((entry, i) => (
                            <Cell key={`cell-${i}`} fill={palette[i % palette.length]} />
                        ))}
                    </Pie>
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                </PieChart>
            </ResponsiveContainer>
        );
    }

    // ── Scatter plot ──────────────────────────────────────────────────────────
    if (def.type === 'scatter') {
        const scatterData: { x: number; y: number }[] = [];
        if (datasets.length >= 2) {
            const xDs = datasets[0];
            const yDs = datasets[1];
            xDs.data.forEach((xVal, i) => {
                scatterData.push({ x: xVal, y: yDs.data[i] ?? 0 });
            });
        } else if (datasets.length === 1) {
            datasets[0].data.forEach((yVal, i) => {
                scatterData.push({ x: i + 1, y: yVal });
            });
        }

        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}>
                    {grid}
                    <XAxis dataKey="x" type="number" name={datasets[0]?.name ?? 'X'} tick={{ fontSize: 11, fill: axisTextColor }}>{xLabel}</XAxis>
                    <YAxis dataKey="y" type="number" name={datasets[1]?.name ?? 'Y'} tick={{ fontSize: 11, fill: axisTextColor }}>{yLabel}</YAxis>
                    <ZAxis range={[40, 40]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    {legendProps && <Legend {...legendProps} />}
                    <Scatter
                        name={datasets[0]?.name ?? 'Data'}
                        data={scatterData}
                        fill={datasets[0]?.color ?? palette[0]}
                    />
                </ScatterChart>
            </ResponsiveContainer>
        );
    }

    // ── Combo chart ───────────────────────────────────────────────────────────
    if (def.type === 'combo') {
        const hasSecondaryAxis = featureFlags.sheetsChartsPhase2 &&
            visibleDatasets.some(ds => getSeriesDef(ds.name)?.yAxisId === 'right');
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={buildRechartsData(labels, visibleDatasets)}
                    margin={{ top: 8, right: hasSecondaryAxis ? 40 : 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }}>{xLabel}</XAxis>
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: axisTextColor }} {...yAxisBaseProps}>{yLabel}</YAxis>
                    {hasSecondaryAxis && (
                        <YAxis yAxisId="right" orientation="right"
                            tick={{ fontSize: 11, fill: axisTextColor }}
                            domain={getYAxisDomain(def.y2Axis)}
                            tickFormatter={makeTickFormatter(def.y2Axis)} />
                    )}
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                    {visibleDatasets.map((ds, i) => {
                        const color = ds.color ?? palette[i % palette.length];
                        const seriesDef = def.series.find(s => s.name === ds.name);
                        const seriesType = seriesDef?.chartType ?? (i === 0 ? 'column' : 'line');
                        const yAxisId = featureFlags.sheetsChartsPhase2 ? (seriesDef?.yAxisId ?? 'left') : 'left';
                        const strokeWidth = featureFlags.sheetsChartsPhase2 ? (seriesDef?.lineThickness ?? 2) : 2;
                        if (seriesType === 'line' || seriesType === 'area') {
                            return (
                                <Line key={ds.name} type="monotone" dataKey={ds.name}
                                    stroke={color} strokeWidth={strokeWidth} dot={{ r: 3 }} yAxisId={yAxisId}>
                                    {showDL && <LabelList dataKey={ds.name} position={dlPosition as 'top'} style={dlStyle} />}
                                </Line>
                            );
                        }
                        return (
                            <Bar key={ds.name} dataKey={ds.name} fill={color} yAxisId={yAxisId}>
                                {showDL && <LabelList dataKey={ds.name} position={dlPosition as 'top'} style={dlStyle} />}
                            </Bar>
                        );
                    })}
                </ComposedChart>
            </ResponsiveContainer>
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 2 chart types — only rendered when sheetsChartsPhase2 flag is on
    // ═══════════════════════════════════════════════════════════════════════════

    if (!featureFlags.sheetsChartsPhase2) {
        return wrap(<NoData message="Phase 2 charts require the sheetsChartsPhase2 feature flag" />);
    }

    // ── Stacked Column ────────────────────────────────────────────────────────
    if (def.type === 'stacked-column') {
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buildRechartsData(labels, visibleDatasets)}
                    margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}
                    style={{ background: plotColor }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }}>{xLabel}</XAxis>
                    <YAxis tick={{ fontSize: 11, fill: axisTextColor }} {...yAxisBaseProps}>{yLabel}</YAxis>
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                    {visibleDatasets.map((ds, i) => (
                        <Bar key={ds.name} dataKey={ds.name} stackId="stack"
                            fill={ds.color ?? palette[i % palette.length]}>
                            {showDL && <LabelList dataKey={ds.name} position="center" style={dlStyle} />}
                        </Bar>
                    ))}
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── Stacked Bar (horizontal) ──────────────────────────────────────────────
    if (def.type === 'stacked-bar') {
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={buildRechartsData(labels, visibleDatasets)}
                    margin={{ top: 8, right: 24, bottom: def.xAxisTitle ? 28 : 8, left: 8 }}>
                    {grid}
                    <XAxis type="number" tick={{ fontSize: 11, fill: axisTextColor }}>{xLabel}</XAxis>
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }} width={80}>{yLabel}</YAxis>
                    <Tooltip />
                    {legendProps && <Legend {...legendProps} />}
                    {visibleDatasets.map((ds, i) => (
                        <Bar key={ds.name} dataKey={ds.name} stackId="stack"
                            fill={ds.color ?? palette[i % palette.length]}>
                            {showDL && <LabelList dataKey={ds.name} position="center" style={dlStyle} />}
                        </Bar>
                    ))}
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── 100% Stacked Column ───────────────────────────────────────────────────
    if (def.type === 'stacked-column-100') {
        const normalizedDatasets = normalize100Percent(visibleDatasets);
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buildRechartsData(labels, normalizedDatasets)}
                    margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}
                    style={{ background: plotColor }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }}>{xLabel}</XAxis>
                    <YAxis tick={{ fontSize: 11, fill: axisTextColor }} domain={[0, 100]}
                        tickFormatter={(v: number) => `${v}%`}>{yLabel}</YAxis>
                    <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                    {legendProps && <Legend {...legendProps} />}
                    {normalizedDatasets.map((ds, i) => (
                        <Bar key={ds.name} dataKey={ds.name} stackId="stack"
                            fill={ds.color ?? palette[i % palette.length]}>
                            {showDL && (
                                <LabelList dataKey={ds.name} position="center" style={dlStyle}
                                    formatter={(v) => `${Number(v).toFixed(0)}%`} />
                            )}
                        </Bar>
                    ))}
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── 100% Stacked Bar (horizontal) ─────────────────────────────────────────
    if (def.type === 'stacked-bar-100') {
        const normalizedDatasets = normalize100Percent(visibleDatasets);
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={buildRechartsData(labels, normalizedDatasets)}
                    margin={{ top: 8, right: 24, bottom: def.xAxisTitle ? 28 : 8, left: 8 }}>
                    {grid}
                    <XAxis type="number" tick={{ fontSize: 11, fill: axisTextColor }}
                        domain={[0, 100]} tickFormatter={(v: number) => `${v}%`}>{xLabel}</XAxis>
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }} width={80}>{yLabel}</YAxis>
                    <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                    {legendProps && <Legend {...legendProps} />}
                    {normalizedDatasets.map((ds, i) => (
                        <Bar key={ds.name} dataKey={ds.name} stackId="stack"
                            fill={ds.color ?? palette[i % palette.length]}>
                            {showDL && (
                                <LabelList dataKey={ds.name} position="center" style={dlStyle}
                                    formatter={(v) => `${Number(v).toFixed(0)}%`} />
                            )}
                        </Bar>
                    ))}
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── Bubble Chart ──────────────────────────────────────────────────────────
    if (def.type === 'bubble') {
        if (datasets.length < 2) {
            return wrap(<NoData message="Bubble chart needs at least 2 columns (X and Y values)" />);
        }
        const bubbleData = datasets[0].data.map((xVal, i) => ({
            x: xVal,
            y: datasets[1]?.data[i] ?? 0,
            z: datasets[2] ? Math.abs(datasets[2].data[i] ?? 0) : 10,
        }));
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}>
                    {grid}
                    <XAxis dataKey="x" type="number" name={datasets[0]?.name ?? 'X'}
                        tick={{ fontSize: 11, fill: axisTextColor }} tickFormatter={xTickFormatter}>{xLabel}</XAxis>
                    <YAxis dataKey="y" type="number" name={datasets[1]?.name ?? 'Y'}
                        tick={{ fontSize: 11, fill: axisTextColor }} {...yAxisBaseProps}>{yLabel}</YAxis>
                    <ZAxis dataKey="z" range={[20, 400]} name={datasets[2]?.name ?? 'Size'} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    {legendProps && <Legend {...legendProps} />}
                    <Scatter name={datasets[0]?.name ?? 'Data'} data={bubbleData}
                        fill={datasets[0]?.color ?? palette[0]} fillOpacity={0.7} />
                </ScatterChart>
            </ResponsiveContainer>
        );
    }

    // ── Histogram ─────────────────────────────────────────────────────────────
    if (def.type === 'histogram') {
        if (datasets.length === 0) return wrap(<NoData />);
        const rawValues = datasets[0].data;
        const bins = computeHistogramBins(rawValues, 10);
        const histData = bins.map(b => ({ label: b.label, count: b.count }));
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histData}
                    margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 36 : 20, left: 0 }}
                    barCategoryGap="2%"
                    style={{ background: plotColor }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: axisTextColor }} angle={-30} textAnchor="end">{xLabel}</XAxis>
                    <YAxis tick={{ fontSize: 11, fill: axisTextColor }} allowDecimals={false}>{yLabel}</YAxis>
                    <Tooltip />
                    <Bar dataKey="count" fill={datasets[0]?.color ?? palette[0]} name="Frequency">
                        {showDL && <LabelList dataKey="count" position="top" style={dlStyle} />}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── Candlestick ───────────────────────────────────────────────────────────
    if (def.type === 'candlestick') {
        if (datasets.length < 4) {
            return wrap(<NoData message="Candlestick requires 4 data columns: Open, High, Low, Close" />);
        }
        const [openDs, highDs, lowDs, closeDs] = datasets;
        const candleData = labels.map((label, i) => ({
            label,
            open: openDs.data[i] ?? 0,
            high: highDs.data[i] ?? 0,
            low: lowDs.data[i] ?? 0,
            close: closeDs.data[i] ?? 0,
        }));

        const allVals = candleData.flatMap(d => [d.open, d.high, d.low, d.close]);
        const yMin = Math.min(...allVals);
        const yMax = Math.max(...allVals);
        const yRange = yMax - yMin || 1;
        const candleWidth = Math.max(16, Math.min(40, 400 / Math.max(candleData.length, 1)));
        const viewW = candleData.length * (candleWidth + 8) + 80;

        return wrap(
            <div style={{ width: '100%', height: '100%', background: plotColor, overflow: 'auto' }}>
                <svg width="100%" height="100%" viewBox={`0 0 ${viewW} 260`}
                    preserveAspectRatio="xMidYMid meet">
                    {/* Gridlines */}
                    {def.showGridlines && [0, 0.25, 0.5, 0.75, 1].map(pct => {
                        const y = 20 + pct * 200;
                        return (
                            <line key={pct} x1={55} y1={y}
                                x2={viewW - 10} y2={y}
                                stroke={gridColor} strokeWidth={0.5} />
                        );
                    })}
                    {candleData.map((d, i) => {
                        const x = 60 + i * (candleWidth + 8) + candleWidth / 2;
                        const toY = (v: number) => 20 + ((yMax - v) / yRange) * 200;
                        const openY = toY(d.open);
                        const closeY = toY(d.close);
                        const highY = toY(d.high);
                        const lowY = toY(d.low);
                        const bullish = d.close >= d.open;
                        const color = bullish ? '#22c55e' : '#ef4444';
                        const bodyTop = Math.min(openY, closeY);
                        const bodyH = Math.max(Math.abs(closeY - openY), 2);

                        return (
                            <g key={i}>
                                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={1.5} />
                                <rect x={x - candleWidth / 3} y={bodyTop} width={candleWidth * 2 / 3} height={bodyH}
                                    fill={color} stroke={color} strokeWidth={1} />
                                <text x={x} y={235} textAnchor="middle" fontSize={9} fill={axisTextColor}>{d.label}</text>
                            </g>
                        );
                    })}
                    {/* Y axis ticks */}
                    {[0, 0.25, 0.5, 0.75, 1].map(pct => {
                        const v = yMax - pct * yRange;
                        const y = 20 + pct * 200;
                        return (
                            <text key={pct} x={50} y={y + 4} textAnchor="end" fontSize={9} fill={axisTextColor}>
                                {v.toFixed(1)}
                            </text>
                        );
                    })}
                    {def.yAxisTitle && (
                        <text transform="rotate(-90)" x={-120} y={15} textAnchor="middle" fontSize={10} fill={axisTextColor}>
                            {def.yAxisTitle}
                        </text>
                    )}
                </svg>
            </div>
        );
    }

    // ── Waterfall ─────────────────────────────────────────────────────────────
    if (def.type === 'waterfall') {
        if (datasets.length === 0) return wrap(<NoData />);
        const bars = computeWaterfallBars(labels, datasets[0].data);
        const allVals = bars.flatMap(b => [b.start, b.end]);
        const minV = Math.min(0, ...allVals);
        const maxV = Math.max(0, ...allVals);

        const waterfallData = bars.map(b => ({
            label: b.label,
            invisible: Math.min(b.start, b.end),
            value: Math.abs(b.end - b.start),
            isTotal: b.isTotal,
            positive: b.value >= 0,
        }));

        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterfallData}
                    margin={{ top: 8, right: 16, bottom: def.xAxisTitle ? 28 : 8, left: 0 }}
                    style={{ background: plotColor }}>
                    {grid}
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisTextColor }}>{xLabel}</XAxis>
                    <YAxis tick={{ fontSize: 11, fill: axisTextColor }} domain={[minV, maxV]}>{yLabel}</YAxis>
                    <Tooltip
                        formatter={(value, name, props) => {
                            if (name === 'invisible') return null;
                            const pl = (props?.payload ?? {}) as { isTotal?: boolean; positive?: boolean; value?: number };
                            const actualValue = pl.isTotal ? pl.value : (pl.positive ? pl.value : -(pl.value ?? 0));
                            return [actualValue, 'Value'];
                        }}
                    />
                    {legendProps && <Legend {...legendProps} />}
                    <Bar dataKey="invisible" stackId="w" fill="transparent" stroke="none" legendType="none" />
                    <Bar dataKey="value" stackId="w"
                        fill={palette[0]}
                        shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { isTotal?: boolean; positive?: boolean } }) => {
                            const { x = 0, y = 0, width: w = 0, height: h = 0, payload } = props;
                            const color = payload?.isTotal ? palette[3] : (payload?.positive ? palette[0] : '#ef4444');
                            return <rect x={x} y={y} width={w} height={h} fill={color} />;
                        }}
                    >
                        {showDL && <LabelList dataKey="value" position="top" style={dlStyle} />}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // ── Treemap ───────────────────────────────────────────────────────────────
    if (def.type === 'treemap') {
        const treemapData = buildTreemapData(labels, visibleDatasets);
        if (treemapData.length === 0) return wrap(<NoData />);
        const coloredData = treemapData.map((node, i) => ({
            ...node,
            fill: node.color ?? palette[i % palette.length],
        }));

        function TreemapCell(props: { x?: number; y?: number; width?: number; height?: number; name?: string; value?: number; fill?: string }) {
            const { x = 0, y = 0, width, height, name, value, fill: cellFill } = props;
            if (!width || !height || width < 10 || height < 10) return null;
            return (
                <g>
                    <rect x={x} y={y} width={width} height={height}
                        fill={cellFill ?? palette[0]} stroke="#fff" strokeWidth={2} />
                    {width > 40 && height > 20 && (
                        <text x={x + width / 2} y={y + height / 2 - (height > 36 ? 8 : 0)}
                            textAnchor="middle" fontSize={11} fill="#fff" fontWeight={500}>
                            {name}
                        </text>
                    )}
                    {width > 40 && height > 36 && (
                        <text x={x + width / 2} y={y + height / 2 + 10}
                            textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.85)">
                            {value}
                        </text>
                    )}
                </g>
            );
        }
        return wrap(
            <ResponsiveContainer width="100%" height="100%">
                <Treemap
                    data={coloredData}
                    dataKey="value"
                    aspectRatio={4 / 3}
                    content={<TreemapCell />}
                />
            </ResponsiveContainer>
        );
    }

    // ── Sunburst ──────────────────────────────────────────────────────────────
    if (def.type === 'sunburst') {
        const firstDs = visibleDatasets[0];
        if (!firstDs) return wrap(<NoData />);
        return wrap(
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: plotColor }}>
                <SunburstChart
                    labels={labels}
                    values={firstDs.data}
                    colors={palette}
                    showLabels={showDL}
                    axisTextColor={axisTextColor}
                />
            </div>
        );
    }

    return wrap(<NoData />);
}
