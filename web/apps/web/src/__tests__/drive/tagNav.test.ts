/**
 * Unit tests for the sidebar's Tags section, which orders tags by usage.
 */

import { describe, it, expect } from 'vitest';
import { MAX_SIDEBAR_TAGS, tagNavSection } from '@/lib/tagNav';
import type { Tag } from '@neutrino/api-drive';

function tag(id: string, name: string, fileCount: number): Tag {
  return { id, name, fileCount, createdAt: '2026-01-01T00:00:00' };
}

describe('tagNavSection', () => {
  it('orders tags by usage, most used first', () => {
    const section = tagNavSection([
      tag('t1', 'travel', 2),
      tag('t2', 'taxes', 9),
      tag('t3', 'recipes', 5),
    ]);

    expect(section.items.map((i) => i.label)).toEqual([
      'taxes',
      'recipes',
      'travel',
      'All tags',
    ]);
  });

  it('breaks count ties alphabetically so the order is stable', () => {
    const section = tagNavSection([
      tag('t1', 'zebra', 3),
      tag('t2', 'apple', 3),
      tag('t3', 'mango', 3),
    ]);

    expect(section.items.slice(0, 3).map((i) => i.label)).toEqual([
      'apple',
      'mango',
      'zebra',
    ]);
  });

  it('shows the file count as a badge', () => {
    const section = tagNavSection([tag('t1', 'taxes', 4)]);
    expect(section.items[0].badge).toBe(4);
    expect(section.items[0].href).toBe('/drive/tag?id=t1');
  });

  it('sorts unused tags last rather than hiding them', () => {
    const section = tagNavSection([tag('t1', 'unused', 0), tag('t2', 'taxes', 1)]);

    expect(section.items.map((i) => i.label)).toEqual(['taxes', 'unused', 'All tags']);
    expect(section.items.at(-1)?.href).toBe('/drive/tags');
  });

  it('omits the badge for an unused tag rather than showing a zero', () => {
    const section = tagNavSection([tag('t1', 'unused', 0)]);
    expect(section.items[0].badge).toBeUndefined();
  });

  it('still offers a Tags entry when the user has none, so it stays reachable', () => {
    const section = tagNavSection([]);

    expect(section.items.map((i) => i.label)).toEqual(['Tags']);
    expect(section.items[0].href).toBe('/drive/tags');
    // A lone item reads better without a section heading above it.
    expect(section.label).toBeUndefined();
  });

  it('tolerates a server response without fileCount', () => {
    const legacy = [{ id: 't1', name: 'taxes', createdAt: '2026-01-01T00:00:00' }] as Tag[];
    const section = tagNavSection(legacy);

    expect(section.items.map((i) => i.label)).toEqual(['taxes', 'All tags']);
  });

  it('caps the inline list and still appends All tags', () => {
    const many = Array.from({ length: MAX_SIDEBAR_TAGS + 5 }, (_, i) =>
      tag(`t${i}`, `tag-${i}`, 100 - i),
    );
    const section = tagNavSection(many);

    expect(section.items).toHaveLength(MAX_SIDEBAR_TAGS + 1);
    expect(section.items.at(-1)?.label).toBe('All tags');
  });
});
