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
    ZAxis,
} from 'recharts';
import type { CellProps } from '../types';
import type { ChartDef } from './chartTypes';
import { extractChartData, CHART_COLORS } from './chartUtils';

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

function NoData() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 13 }}>
            No data
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

// ── ChartRenderer ─────────────────────────────────────────────────────────────

export function ChartRenderer({ def, data, width, height }: ChartRendererProps) {
    const { labels, datasets } = extractChartData(def, data);
    const legendProps = getLegendProps(def.legendPosition);
    const grid = def.showGridlines ? <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /> : null;

    const chartData = buildRechartsData(labels, datasets);
    const isEmpty = datasets.length === 0 || labels.length === 0;

    const containerStyle: React.CSSProperties = {
        background: def.backgroundColor || '#ffffff',
        width: width ?? '100%',
        height: height ?? '100%',
    };

    if (isEmpty) {
        return <div style={containerStyle}><NoData /></div>;
    }

    // ── Column chart ──────────────────────────────────────────────────────────
    if (def.type === 'column') {
        return (
            <div style={containerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 16, bottom: 8, left: 0 }}
                        style={{ background: def.plotAreaColor || 'transparent' }}>
                        {grid}
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        {legendProps && <Legend {...legendProps} />}
                        {datasets.map((ds, i) => (
                            <Bar key={ds.name} dataKey={ds.name}
                                fill={ds.color ?? CHART_COLORS[i % CHART_COLORS.length]}>
                                {def.showDataLabels && <LabelList dataKey={ds.name} position="top" style={{ fontSize: 10 }} />}
                            </Bar>
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }

    // ── Bar chart (horizontal) ────────────────────────────────────────────────
    if (def.type === 'bar') {
        return (
            <div style={containerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={chartData} margin={{ top: 20, right: 24, bottom: 8, left: 8 }}>
                        {grid}
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={80} />
                        <Tooltip />
                        {legendProps && <Legend {...legendProps} />}
                        {datasets.map((ds, i) => (
                            <Bar key={ds.name} dataKey={ds.name}
                                fill={ds.color ?? CHART_COLORS[i % CHART_COLORS.length]}>
                                {def.showDataLabels && <LabelList dataKey={ds.name} position="right" style={{ fontSize: 10 }} />}
                            </Bar>
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }

    // ── Line chart ────────────────────────────────────────────────────────────
    if (def.type === 'line') {
        return (
            <div style={containerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 20, right: 16, bottom: 8, left: 0 }}>
                        {grid}
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        {legendProps && <Legend {...legendProps} />}
                        {datasets.map((ds, i) => (
                            <Line key={ds.name} type="monotone" dataKey={ds.name}
                                stroke={ds.color ?? CHART_COLORS[i % CHART_COLORS.length]}
                                dot={{ r: 3 }} activeDot={{ r: 5 }}>
                                {def.showDataLabels && <LabelList dataKey={ds.name} position="top" style={{ fontSize: 10 }} />}
                            </Line>
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        );
    }

    // ── Area chart ────────────────────────────────────────────────────────────
    if (def.type === 'area') {
        return (
            <div style={containerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 20, right: 16, bottom: 8, left: 0 }}>
                        {grid}
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        {legendProps && <Legend {...legendProps} />}
                        {datasets.map((ds, i) => {
                            const color = ds.color ?? CHART_COLORS[i % CHART_COLORS.length];
                            return (
                                <Area key={ds.name} type="monotone" dataKey={ds.name}
                                    stroke={color} fill={color} fillOpacity={0.3}>
                                    {def.showDataLabels && <LabelList dataKey={ds.name} position="top" style={{ fontSize: 10 }} />}
                                </Area>
                            );
                        })}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        );
    }

    // ── Pie chart ─────────────────────────────────────────────────────────────
    if (def.type === 'pie' || def.type === 'donut') {
        // Use first dataset's values, labels as category names
        const firstDs = datasets[0];
        if (!firstDs) return <div style={containerStyle}><NoData /></div>;
        const pieData = labels.map((label, i) => ({ name: label, value: firstDs.data[i] ?? 0 }));
        const innerRadius = def.type === 'donut' ? '55%' : 0;

        return (
            <div style={containerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%" cy="50%"
                            outerRadius="75%"
                            innerRadius={innerRadius}
                            label={def.showDataLabels
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                ? (props: any) => `${props.name} ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`
                                : undefined}
                            labelLine={def.showDataLabels}
                        >
                            {pieData.map((entry, i) => (
                                <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip />
                        {legendProps && <Legend {...legendProps} />}
                    </PieChart>
                </ResponsiveContainer>
            </div>
        );
    }

    // ── Scatter plot ──────────────────────────────────────────────────────────
    if (def.type === 'scatter') {
        // Use first dataset as X values, second as Y values, or single dataset with index as X
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

        return (
            <div style={containerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 16, bottom: 8, left: 0 }}>
                        {grid}
                        <XAxis dataKey="x" type="number" name={datasets[0]?.name ?? 'X'} tick={{ fontSize: 11 }} />
                        <YAxis dataKey="y" type="number" name={datasets[1]?.name ?? 'Y'} tick={{ fontSize: 11 }} />
                        <ZAxis range={[40, 40]} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        {legendProps && <Legend {...legendProps} />}
                        <Scatter
                            name={datasets[0]?.name ?? 'Data'}
                            data={scatterData}
                            fill={datasets[0]?.color ?? CHART_COLORS[0]}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        );
    }

    // ── Combo chart (first series as bars, rest as lines) ─────────────────────
    if (def.type === 'combo') {
        return (
            <div style={containerStyle}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 20, right: 16, bottom: 8, left: 0 }}>
                        {grid}
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        {legendProps && <Legend {...legendProps} />}
                        {datasets.map((ds, i) => {
                            const color = ds.color ?? CHART_COLORS[i % CHART_COLORS.length];
                            // Per-series override or: first series = bar, rest = lines
                            const seriesDef = def.series.find(s => s.name === ds.name);
                            const seriesType = seriesDef?.chartType ?? (i === 0 ? 'column' : 'line');
                            if (seriesType === 'line' || seriesType === 'area') {
                                return (
                                    <Line key={ds.name} type="monotone" dataKey={ds.name}
                                        stroke={color} dot={{ r: 3 }}>
                                        {def.showDataLabels && <LabelList dataKey={ds.name} position="top" style={{ fontSize: 10 }} />}
                                    </Line>
                                );
                            }
                            return (
                                <Bar key={ds.name} dataKey={ds.name} fill={color}>
                                    {def.showDataLabels && <LabelList dataKey={ds.name} position="top" style={{ fontSize: 10 }} />}
                                </Bar>
                            );
                        })}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        );
    }

    return <div style={containerStyle}><NoData /></div>;
}
