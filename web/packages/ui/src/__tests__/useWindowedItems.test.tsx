import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { File } from 'lucide-react';
import { autoFillColumns, computeWindow } from '../components/display/useWindowedItems';
import { FileGrid, type GridItem } from '../components/display/FileGrid';

describe('computeWindow', () => {
  const base = { count: 1000, columns: 1, stride: 44, viewport: 880, overscanRows: 4 };

  it('renders the first screenful plus overscan at the top', () => {
    const w = computeWindow({ ...base, scrolledInto: 0 });
    expect(w).toEqual({ start: 0, end: 24, padTop: 0, padBottom: (1000 - 24) * 44 });
  });

  it('keeps the total height constant while scrolling, so the scrollbar does not jump', () => {
    for (const scrolledInto of [0, 1000, 12_345, 30_000, 43_120]) {
      const w = computeWindow({ ...base, scrolledInto });
      const rendered = (w.end - w.start) * 44;
      expect(w.padTop + rendered + w.padBottom).toBe(1000 * 44);
    }
  });

  it('covers the viewport wherever it is', () => {
    const scrolledInto = 20_000;
    const w = computeWindow({ ...base, scrolledInto });
    expect(w.start * 44).toBeLessThanOrEqual(scrolledInto);
    expect(w.end * 44).toBeGreaterThanOrEqual(scrolledInto + base.viewport);
  });

  it('starts at the top when the list begins below the scroller edge', () => {
    // Drive's grid sits under the page header, so it starts out "scrolled into" negatively.
    const w = computeWindow({ ...base, scrolledInto: -300 });
    expect(w.start).toBe(0);
    expect(w.padTop).toBe(0);
  });

  it('windows whole rows of a grid, never part of one', () => {
    const w = computeWindow({ ...base, columns: 6, stride: 198, scrolledInto: 5_000 });
    expect(w.start % 6).toBe(0);
    expect(w.end % 6 === 0 || w.end === 1000).toBe(true);
  });

  it('ends exactly at the last item, with no padding below it, at the bottom of the list', () => {
    const w = computeWindow({ ...base, scrolledInto: 1000 * 44 - 880 });
    expect(w.end).toBe(1000);
    expect(w.padBottom).toBe(0);
  });

  it('renders everything when it cannot measure', () => {
    expect(computeWindow({ ...base, stride: 0, scrolledInto: 0 })).toEqual({ start: 0, end: 1000, padTop: 0, padBottom: 0 });
    expect(computeWindow({ ...base, viewport: 0, scrolledInto: 0 })).toEqual({ start: 0, end: 1000, padTop: 0, padBottom: 0 });
  });
});

describe('autoFillColumns', () => {
  it('matches repeat(auto-fill, minmax(180px, 1fr)) with a 12px gap', () => {
    expect(autoFillColumns(1000, 180, 12)).toBe(5); // 5×180 + 4×12 = 948 ≤ 1000; 6 would need 1140
    expect(autoFillColumns(1140, 180, 12)).toBe(6);
    expect(autoFillColumns(100, 180, 12)).toBe(1);  // never zero columns
  });
});

describe('FileGrid with a long listing', () => {
  const items: GridItem[] = Array.from({ length: 300 }, (_, i) => ({
    id: `f${i}`,
    name: `file-${String(i).padStart(3, '0')}.txt`,
    kind: 'file',
    icon: File,
    iconColor: '#000',
  }));

  it('renders every item where layout cannot be measured, in every view', () => {
    // jsdom reports every size as 0, which is the "cannot measure" case: the
    // grid must fall back to rendering everything rather than an empty window.
    for (const mode of ['large', 'small', 'list'] as const) {
      const { unmount } = render(
        <FileGrid items={items} onItemClick={vi.fn()} sortBy="name" sortDir="asc" onSortChange={vi.fn()} defaultViewMode={mode} />,
      );
      expect(screen.getAllByRole('listitem')).toHaveLength(300);
      unmount();
    }
  });

  it('puts the footer after the items, where an infinite-scroll sentinel belongs', () => {
    render(
      <FileGrid
        items={items}
        onItemClick={vi.fn()}
        sortBy="name"
        sortDir="asc"
        onSortChange={vi.fn()}
        footer={<div data-testid="sentinel" />}
      />,
    );
    const list = screen.getByRole('list');
    const sentinel = screen.getByTestId('sentinel');
    expect(list.contains(sentinel)).toBe(false);
    expect(list.compareDocumentPosition(sentinel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
