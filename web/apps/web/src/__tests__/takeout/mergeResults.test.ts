/**
 * Merging a retry back into the run it belongs to
 * (`components/ImportRun/mergeResults.ts`).
 *
 * A retry re-runs a handful of files out of a run that may have had thousands,
 * so its summary cannot replace the one on screen — three items imported out of
 * five thousand would read as "3 imported". What it replaces is the rows it
 * actually attempted, and the counts follow from that.
 */

import { describe, it, expect } from 'vitest';
import { mergeResults, type ProductResult } from '@/components/ImportRun';
import type { ImportItem, ImportSummary } from '@/lib/takeout';

const summary = (items: ImportItem[], extra: Partial<ImportSummary> = {}): ImportSummary => ({
  total: items.length,
  imported: items.filter((i) => i.status === 'imported').length,
  skipped: items.filter((i) => i.status === 'skipped').length,
  failed: items.filter((i) => i.status === 'failed').length,
  items,
  folderId: null,
  cancelled: false,
  unencrypted: false,
  ...extra,
});

const imported = (file: string): ImportItem => ({ file, title: file, status: 'imported' });
const failed = (file: string, reason = 'HTTP 500'): ImportItem => ({
  file,
  title: file,
  status: 'failed',
  reason,
});

const notes = (items: ImportItem[], extra: Partial<ImportSummary> = {}): ProductResult => ({
  product: 'Notes',
  summary: summary(items, extra),
});

describe('mergeResults', () => {
  it('replaces the retried row and leaves every other one alone', () => {
    const before = [notes([imported('a.json'), failed('b.json'), imported('c.json')])];
    const after = [notes([imported('b.json')], { total: 1 })];

    const merged = mergeResults(before, after);

    expect(merged[0].summary.items.map((i) => [i.file, i.status])).toEqual([
      ['a.json', 'imported'],
      ['b.json', 'imported'],
      ['c.json', 'imported'],
    ]);
    // The reason went with the failure it explained.
    expect(merged[0].summary.items[1].reason).toBeUndefined();
  });

  it('moves the counts by what the retry changed, not by what it ran', () => {
    const before = [notes([imported('a.json'), failed('b.json'), failed('c.json')])];
    const after = [notes([imported('b.json'), failed('c.json', 'HTTP 413')], { total: 2 })];

    const merged = mergeResults(before, after).map((r) => r.summary);

    expect(merged[0].imported).toBe(2);
    expect(merged[0].failed).toBe(1);
    // The whole import is still three items; the retry was two of them.
    expect(merged[0].total).toBe(3);
  });

  it('keeps a product that was not retried exactly as it was', () => {
    const before: ProductResult[] = [
      notes([failed('a.json')]),
      { product: 'Photos', summary: summary([imported('x.jpg')]) },
    ];
    const after = [notes([imported('a.json')], { total: 1 })];

    const merged = mergeResults(before, after);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toBe(before[1]);
  });

  it('reports a retry that was stopped, and one this device could not encrypt', () => {
    const before = [notes([failed('a.json'), failed('b.json')])];

    const stopped = mergeResults(before, [notes([imported('a.json')], { cancelled: true })]);
    expect(stopped[0].summary.cancelled).toBe(true);

    const locked = mergeResults(before, [notes([], { unencrypted: true, cancelled: true })]);
    expect(locked[0].summary.unencrypted).toBe(true);
    // Nothing was written, so both failures are still failures.
    expect(locked[0].summary.failed).toBe(2);
  });

  it('stays stopped once the run was stopped, whatever the retry did', () => {
    const before = [notes([imported('a.json'), failed('b.json')], { cancelled: true })];
    const merged = mergeResults(before, [notes([imported('b.json')], { total: 1 })]);
    // Half the archive was never attempted; the retry does not change that.
    expect(merged[0].summary.cancelled).toBe(true);
  });

  it('keeps a row the retry reports for the first time', () => {
    // A runner may report a file the first pass never reached — appended
    // rather than dropped, so nothing the retry did goes unrecorded.
    const before = [notes([failed('a.json')])];
    const merged = mergeResults(before, [notes([imported('a.json'), imported('z.json')], { total: 2 })]);

    expect(merged[0].summary.items.map((i) => i.file)).toEqual(['a.json', 'z.json']);
    expect(merged[0].summary.imported).toBe(2);
  });
});
