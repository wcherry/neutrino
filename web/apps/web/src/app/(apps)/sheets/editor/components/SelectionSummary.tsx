'use client';

import React, { useMemo } from 'react';
import { usePreference } from '@neutrino/preferences';
import type { CellProps } from '../types';
import type { CellSet } from '../cellSet';
import styles from '../page.module.css';

/** Sum, average and count of the numbers in a selection — what the tab bar shows in the new looks. */
export function summarize(data: Map<string, CellProps>, selected: CellSet): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  const add = (cell: CellProps | undefined) => {
    const text = cell?.value ?? '';
    if (text === '' || cell?.raw === undefined) return;
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    count += 1;
    sum += n;
  };
  // Whichever is smaller is walked: a selected row is MAX_COLS cells, a sheet holds what it holds.
  if (selected.size <= data.size) {
    for (const id of selected) add(data.get(id));
  } else {
    for (const [id, cell] of data) if (selected.has(id)) add(cell);
  }
  return { count, sum };
}

const format = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * The running Sum for the selection (look-and-feel roadmap §5, Sheets), beside the sheet tabs.
 * Only in the new looks, and only once two or more numbers are selected.
 */
export function SelectionSummary({ data, selectedCells }: { data: Map<string, CellProps>; selectedCells: CellSet }) {
  const [look] = usePreference('appearance.look');
  const newLook = look !== 'classic';
  const summary = useMemo(
    () => (newLook && selectedCells.size > 1 ? summarize(data, selectedCells) : null),
    [newLook, data, selectedCells],
  );
  if (!summary || summary.count < 2) return null;
  return (
    <div className={styles.selectionSummary} aria-live="polite">
      <span>Sum <strong>{format(summary.sum)}</strong></span>
      <span>Average <strong>{format(summary.sum / summary.count)}</strong></span>
      <span>Count <strong>{summary.count.toLocaleString()}</strong></span>
    </div>
  );
}
