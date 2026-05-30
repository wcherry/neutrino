'use client';

import React from 'react';
import type { CellProps } from '../types';
import type { ChartDef } from './chartTypes';
import { ChartFrame } from './ChartFrame';
import styles from './charts.module.css';

interface ChartLayerProps {
    charts: ChartDef[];
    data: Map<string, CellProps>;
    selectedChartId: string | null;
    onSelectChart: (id: string | null) => void;
    onUpdateChart: (id: string, patch: Partial<ChartDef>) => void;
    onDeleteChart: (id: string) => void;
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export function ChartLayer({
    charts,
    data,
    selectedChartId,
    onSelectChart,
    onUpdateChart,
    onDeleteChart,
    containerRef,
}: ChartLayerProps) {
    if (charts.length === 0) return null;

    return (
        <div
            className={styles.chartLayer}
            // Click on the backdrop (not on a frame) deselects
            onMouseDown={() => onSelectChart(null)}
        >
            {charts.map(def => (
                <ChartFrame
                    key={def.id}
                    def={def}
                    data={data}
                    isSelected={selectedChartId === def.id}
                    onSelect={() => onSelectChart(def.id)}
                    onUpdate={(patch) => onUpdateChart(def.id, patch)}
                    onDelete={() => onDeleteChart(def.id)}
                    containerRef={containerRef}
                />
            ))}
        </div>
    );
}
