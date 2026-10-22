import { describe, it, expect } from 'vitest';
import { EDITOR_TOOLBARS, resolveToolbar } from '@/lib/editorToolbars';

const tools = [
  { id: 'a', label: 'A', caption: 'A' },
  { id: 'b', label: 'B', caption: 'B' },
  { id: 'c', label: 'C', caption: 'C' },
  { id: 'd', label: 'D', caption: 'D' },
];

describe('resolveToolbar', () => {
  it('is the default order, nothing hidden and no labels when nothing is stored', () => {
    expect(resolveToolbar(tools, null)).toEqual({ order: ['a', 'b', 'c', 'd'], hidden: new Set(), labels: false });
  });

  it('keeps the stored order and drops ids the editor no longer has', () => {
    const r = resolveToolbar(tools, { order: ['c', 'gone', 'a', 'b', 'd', 'a'], hidden: ['b', 'gone'], labels: true });
    expect(r.order).toEqual(['c', 'a', 'b', 'd']);
    expect([...r.hidden]).toEqual(['b']);
    expect(r.labels).toBe(true);
  });

  it('puts a tool added since the layout was saved after the tool it follows by default', () => {
    // Saved before `c` existed, with `b` moved to the front: `c` still comes straight after `b`.
    expect(resolveToolbar(tools, { order: ['b', 'a', 'd'] }).order).toEqual(['b', 'c', 'a', 'd']);
    // A new first tool goes first.
    expect(resolveToolbar(tools, { order: ['b', 'c', 'd'] }).order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('survives a stored value of the wrong shape', () => {
    expect(resolveToolbar(tools, { order: 'abc' as unknown as string[], hidden: [1, 'a'] as unknown as string[] }))
      .toEqual({ order: ['a', 'b', 'c', 'd'], hidden: new Set(['a']), labels: false });
  });
});

describe('the toolbar catalog', () => {
  it('names every tool once per editor, with a label and a caption', () => {
    for (const [editor, { tools: list }] of Object.entries(EDITOR_TOOLBARS)) {
      const ids = list.map(t => t.id);
      expect(new Set(ids).size, editor).toBe(ids.length);
      for (const t of list) expect(t.label && t.caption, `${editor}.${t.id}`).toBeTruthy();
    }
  });
});
