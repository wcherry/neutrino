/**
 * Unit tests for Phase 2 chart utilities:
 * - computeHistogramBins
 * - computeWaterfallBars
 * - normalize100Percent
 * - makeTickFormatter
 * - buildTreemapData
 * - getTheme (chartThemes)
 */

import { describe, it, expect } from 'vitest';
import {
    computeHistogramBins,
    computeWaterfallBars,
    normalize100Percent,
    makeTickFormatter,
    buildTreemapData,
} from '../../app/(apps)/sheets/editor/charts/chartUtils';
import { getTheme, CHART_THEMES } from '../../app/(apps)/sheets/editor/charts/chartThemes';

// ── computeHistogramBins ──────────────────────────────────────────────────────

describe('computeHistogramBins', () => {
    it('returns empty array for empty input', () => {
        expect(computeHistogramBins([])).toEqual([]);
    });

    it('returns a single bin when all values are equal', () => {
        const bins = computeHistogramBins([5, 5, 5], 10);
        expect(bins).toHaveLength(1);
        expect(bins[0].count).toBe(3);
        expect(bins[0].label).toBe('5');
    });

    it('distributes values across the requested number of bins', () => {
        const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const bins = computeHistogramBins(values, 5);
        expect(bins).toHaveLength(5);
        // Total count across all bins must equal input length
        const total = bins.reduce((s, b) => s + b.count, 0);
        expect(total).toBe(values.length);
    });

    it('defaults to 10 bins', () => {
        const values = Array.from({ length: 100 }, (_, i) => i);
        const bins = computeHistogramBins(values);
        expect(bins).toHaveLength(10);
    });

    it('bin labels include the range with a dash separator', () => {
        const bins = computeHistogramBins([0, 5, 10], 2);
        expect(bins[0].label).toContain('–');
    });

    it('each bin has min < max (except single-bin edge case)', () => {
        const bins = computeHistogramBins([10, 20, 30, 40, 50], 5);
        bins.forEach(bin => {
            expect(bin.max).toBeGreaterThanOrEqual(bin.min);
        });
    });
});

// ── computeWaterfallBars ──────────────────────────────────────────────────────

describe('computeWaterfallBars', () => {
    it('returns a Total bar appended at the end', () => {
        const bars = computeWaterfallBars(['A', 'B'], [10, 20]);
        expect(bars[bars.length - 1].label).toBe('Total');
        expect(bars[bars.length - 1].isTotal).toBe(true);
    });

    it('running total is correct for positive values', () => {
        const bars = computeWaterfallBars(['Jan', 'Feb', 'Mar'], [100, 50, -30]);
        expect(bars[0].end).toBe(100);
        expect(bars[1].end).toBe(150);
        expect(bars[2].end).toBe(120);
        const total = bars[bars.length - 1];
        expect(total.end).toBe(120);
        expect(total.value).toBe(120);
    });

    it('each bar start equals the previous bar end', () => {
        const bars = computeWaterfallBars(['A', 'B', 'C'], [10, -5, 8]);
        // Non-total bars only
        const dataBars = bars.slice(0, -1);
        expect(dataBars[0].start).toBe(0);
        expect(dataBars[1].start).toBe(dataBars[0].end);
        expect(dataBars[2].start).toBe(dataBars[1].end);
    });

    it('handles empty labels/values', () => {
        const bars = computeWaterfallBars([], []);
        // Only the Total bar
        expect(bars).toHaveLength(1);
        expect(bars[0].isTotal).toBe(true);
        expect(bars[0].end).toBe(0);
    });

    it('isTotal is false for all non-total bars', () => {
        const bars = computeWaterfallBars(['X', 'Y'], [1, 2]);
        bars.slice(0, -1).forEach(b => expect(b.isTotal).toBe(false));
    });
});

// ── normalize100Percent ───────────────────────────────────────────────────────

describe('normalize100Percent', () => {
    it('makes each column sum to 100', () => {
        const datasets = [
            { name: 'A', data: [10, 20], color: '#000' },
            { name: 'B', data: [40, 80], color: '#fff' },
        ];
        const result = normalize100Percent(datasets);
        // Column 0: 10+40=50 → A=20%, B=80%
        expect(result[0].data[0]).toBeCloseTo(20);
        expect(result[1].data[0]).toBeCloseTo(80);
        // Column 1: 20+80=100 → A=20%, B=80%
        expect(result[0].data[1]).toBeCloseTo(20);
        expect(result[1].data[1]).toBeCloseTo(80);
    });

    it('handles zero-total columns by outputting 0', () => {
        const datasets = [
            { name: 'A', data: [0, 10] },
            { name: 'B', data: [0, 10] },
        ];
        const result = normalize100Percent(datasets);
        expect(result[0].data[0]).toBe(0);
        expect(result[1].data[0]).toBe(0);
    });

    it('preserves dataset names and colors', () => {
        const datasets = [
            { name: 'Series1', data: [30, 70], color: '#aabbcc' },
        ];
        const result = normalize100Percent(datasets);
        expect(result[0].name).toBe('Series1');
        expect(result[0].color).toBe('#aabbcc');
    });

    it('values are clamped to 2 decimal places at most', () => {
        const datasets = [
            { name: 'A', data: [1] },
            { name: 'B', data: [2] },
        ];
        const result = normalize100Percent(datasets);
        // 1/(1+2) * 100 = 33.33...
        const v = result[0].data[0];
        expect(v.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    });
});

// ── makeTickFormatter ─────────────────────────────────────────────────────────

describe('makeTickFormatter', () => {
    it('returns undefined when axisConfig is undefined', () => {
        expect(makeTickFormatter(undefined)).toBeUndefined();
    });

    it('returns undefined for numberFormat="default"', () => {
        expect(makeTickFormatter({ numberFormat: 'default' })).toBeUndefined();
    });

    it('formats as currency with default symbol', () => {
        const fmt = makeTickFormatter({ numberFormat: 'currency', decimalPlaces: 2 });
        expect(fmt).toBeDefined();
        expect(fmt!(1234.5)).toBe('$1234.50');
    });

    it('formats as currency with custom symbol', () => {
        const fmt = makeTickFormatter({ numberFormat: 'currency', currencySymbol: '€', decimalPlaces: 0 });
        expect(fmt!(99)).toBe('€99');
    });

    it('formats as percentage', () => {
        const fmt = makeTickFormatter({ numberFormat: 'percentage', decimalPlaces: 1 });
        expect(fmt!(0.5)).toBe('0.5%');
        expect(fmt!(100)).toBe('100.0%');
    });

    it('formats as number with decimal places', () => {
        const fmt = makeTickFormatter({ numberFormat: 'number', decimalPlaces: 3 });
        expect(fmt!(3.14159)).toBe('3.142');
    });

    it('defaults decimal places to 0', () => {
        const fmt = makeTickFormatter({ numberFormat: 'number' });
        expect(fmt!(42.7)).toBe('43');
    });
});

// ── buildTreemapData ──────────────────────────────────────────────────────────

describe('buildTreemapData', () => {
    it('returns empty array when no datasets', () => {
        expect(buildTreemapData(['A', 'B'], [])).toEqual([]);
    });

    it('maps labels to nodes with values from first dataset', () => {
        const datasets = [{ name: 'Sales', data: [100, 200, 50], color: '#123456' }];
        const nodes = buildTreemapData(['Jan', 'Feb', 'Mar'], datasets);
        expect(nodes).toHaveLength(3);
        expect(nodes[0]).toEqual({ name: 'Jan', value: 100, color: '#123456' });
        expect(nodes[1]).toEqual({ name: 'Feb', value: 200, color: '#123456' });
        expect(nodes[2]).toEqual({ name: 'Mar', value: 50,  color: '#123456' });
    });

    it('takes absolute values (negatives become positive)', () => {
        const datasets = [{ name: 'D', data: [-50, 80] }];
        const nodes = buildTreemapData(['X', 'Y'], datasets);
        expect(nodes[0].value).toBe(50);
        expect(nodes[1].value).toBe(80);
    });

    it('uses the first dataset only', () => {
        const datasets = [
            { name: 'A', data: [10] },
            { name: 'B', data: [999] },
        ];
        const nodes = buildTreemapData(['Item'], datasets);
        expect(nodes[0].value).toBe(10);
    });
});

// ── getTheme ──────────────────────────────────────────────────────────────────

describe('getTheme', () => {
    it('returns the default theme when called with no argument', () => {
        const t = getTheme();
        expect(t.name).toBe('default');
    });

    it('returns the default theme for an unknown name', () => {
        const t = getTheme('nonexistent-theme');
        expect(t.name).toBe('default');
    });

    it('returns the correct named theme', () => {
        const dark = getTheme('dark');
        expect(dark.name).toBe('dark');
        expect(dark.backgroundColor).toBe('#1e1e2e');
    });

    it('all built-in themes have exactly 8 colors', () => {
        Object.values(CHART_THEMES).forEach(theme => {
            expect(theme.colors).toHaveLength(8);
        });
    });

    it('all built-in themes have required fields', () => {
        Object.values(CHART_THEMES).forEach(theme => {
            expect(typeof theme.backgroundColor).toBe('string');
            expect(typeof theme.plotAreaColor).toBe('string');
            expect(typeof theme.gridlineColor).toBe('string');
            expect(typeof theme.axisColor).toBe('string');
            expect(typeof theme.textColor).toBe('string');
            expect(typeof theme.displayName).toBe('string');
        });
    });

    it('all 5 expected theme names are present', () => {
        const names = Object.keys(CHART_THEMES);
        expect(names).toContain('default');
        expect(names).toContain('dark');
        expect(names).toContain('pastel');
        expect(names).toContain('corporate');
        expect(names).toContain('colorblind');
    });
});
