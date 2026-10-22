import { describe, it, expect } from 'vitest';
import { lttbIndices, peakIndices, thinForDisplay, MAX_DRAWN_BARS, MAX_DRAWN_POINTS } from '@/app/(apps)/sheets/editor/charts/chartUtils';

describe('chart thinning for display', () => {
  it('leaves a chart that fits alone', () => {
    const chart = { labels: ['a', 'b'], datasets: [{ name: 's', data: [1, 2] }] };
    expect(thinForDisplay('column', chart)).toBe(chart);
  });

  it('keeps both ends of a curve and its extremes', () => {
    const y = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 50) * 10);
    y[613] = 500; // a spike the shape must keep
    const keep = lttbIndices(y, 100);
    expect(keep).toHaveLength(100);
    expect(keep[0]).toBe(0);
    expect(keep[keep.length - 1]).toBe(999);
    expect(keep).toContain(613);
    expect([...keep].sort((p, q) => p - q)).toEqual(keep);
  });

  it('keeps the tallest bar of each run, negative ones included', () => {
    const y = Array.from({ length: 30 }, () => 1);
    y[4] = 9;
    y[17] = -12;
    expect(peakIndices(y, 3)).toEqual([4, 17, 20]);
  });

  it('thins every series by the same rows, and leaves pies alone', () => {
    const n = 500;
    const chart = {
      labels: Array.from({ length: n }, (_, i) => `r${i}`),
      datasets: [
        { name: 'a', data: Array.from({ length: n }, (_, i) => i) },
        { name: 'b', data: Array.from({ length: n }, (_, i) => n - i) },
      ],
    };
    const bars = thinForDisplay('column', chart);
    // Two series of bars share the budget.
    expect(bars.labels).toHaveLength(MAX_DRAWN_BARS / 2);
    const rows = bars.labels.map(l => Number(l.slice(1)));
    expect(bars.datasets[0].data).toEqual(rows);
    expect(bars.datasets[1].data).toEqual(rows.map(r => n - r));
    expect(thinForDisplay('line', chart).labels.length).toBeLessThanOrEqual(MAX_DRAWN_POINTS);
    expect(thinForDisplay('pie', chart)).toBe(chart);
  });
});
