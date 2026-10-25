import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FileItem } from '@/lib/api';
import { QUICK_ACCESS_LIMIT, quickAccessEntries } from '@/hooks/useQuickAccess';

vi.mock('@/lib/api', () => ({ storageApi: { getThumbnailUrl: () => null }, filesystemApi: {} }));

import { QuickAccess } from '@/app/(apps)/drive/QuickAccess';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function file(id: string, daysAgo: number): FileItem {
  return {
    id,
    name: `${id}.docx`,
    sizeBytes: 1,
    mimeType: 'text/plain',
    folderId: null,
    isStarred: false,
    createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
    updatedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    coverThumbnailUrl: null,
    contentVersion: 1,
  };
}

describe('quickAccessEntries', () => {
  it('lists files edited inside the window first, then starred files in their order', () => {
    const recent = [file('a', 1), file('b', 5), file('old', 20)];
    const starred = [file('s1', 40), file('s2', 60)];
    expect(quickAccessEntries(recent, starred, 7, NOW).map((e) => [e.file.id, e.reason])).toEqual([
      ['a', 'recent'],
      ['b', 'recent'],
      ['s1', 'starred'],
      ['s2', 'starred'],
    ]);
  });

  it('widens with the setting', () => {
    const recent = [file('a', 1), file('old', 20)];
    expect(quickAccessEntries(recent, [], 3, NOW).map((e) => e.file.id)).toEqual(['a']);
    expect(quickAccessEntries(recent, [], 30, NOW).map((e) => e.file.id)).toEqual(['a', 'old']);
  });

  it('lists a file once, as recent, when it is also starred', () => {
    const entries = quickAccessEntries([file('a', 1)], [file('a', 1), file('s', 9)], 7, NOW);
    expect(entries.map((e) => [e.file.id, e.reason])).toEqual([['a', 'recent'], ['s', 'starred']]);
  });

  it(`stops at ${QUICK_ACCESS_LIMIT}`, () => {
    const recent = Array.from({ length: 8 }, (_, i) => file(`r${i}`, 1));
    const starred = Array.from({ length: 8 }, (_, i) => file(`s${i}`, 50));
    const entries = quickAccessEntries(recent, starred, 7, NOW);
    expect(QUICK_ACCESS_LIMIT).toBe(12);
    expect(entries).toHaveLength(QUICK_ACCESS_LIMIT);
    expect(entries.at(-1)?.file.id).toBe('s3');
  });
});

describe('QuickAccess', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ file: file(`f${i}`, 1), reason: 'recent' as const }));

  function overflow(row: HTMLElement, { scrollLeft }: { scrollLeft: number }) {
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 800 });
    row.scrollLeft = scrollLeft;
    fireEvent.scroll(row);
  }

  it('shows every card in one row', () => {
    render(<QuickAccess entries={entries} loading={false} onOpen={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(12);
  });

  it('shows both arrows when the row overflows, disabling the one with nothing on its side', () => {
    render(<QuickAccess entries={entries} loading={false} onOpen={vi.fn()} />);
    // Nothing overflows in jsdom until told otherwise, and then neither arrow is drawn.
    expect(screen.queryByRole('button', { name: /Scroll Quick access/ })).toBeNull();

    const row = screen.getByTestId('quick-access-row');
    row.scrollBy = vi.fn();
    const left = () => screen.getByRole('button', { name: 'Scroll Quick access left' }) as HTMLButtonElement;
    const right = () => screen.getByRole('button', { name: 'Scroll Quick access right' }) as HTMLButtonElement;

    overflow(row, { scrollLeft: 0 });
    expect(left().disabled).toBe(true);
    expect(right().disabled).toBe(false);
    fireEvent.click(right());
    expect(row.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));

    overflow(row, { scrollLeft: 400 });
    expect(left().disabled).toBe(false);
    expect(right().disabled).toBe(true);
  });

  it('marks a starred entry', () => {
    render(<QuickAccess entries={[{ file: file('s', 50), reason: 'starred' }]} loading={false} onOpen={vi.fn()} />);
    expect(screen.getByLabelText('Starred')).toBeTruthy();
  });
});
