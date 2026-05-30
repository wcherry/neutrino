/**
 * Unit tests for FootnoteExtension helpers.
 *
 * Covers:
 *   - FootnoteRegistry stores and retrieves footnote text by id
 *   - getFootnoteItems returns correctly numbered items in document order
 *   - getFootnoteItems returns empty array when no footnotes exist
 *   - getFootnoteItems ignores non-footnote nodes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FootnoteRegistry, getFootnoteItems } from '../../lib/extensions/FootnoteExtension';
import type { Editor } from '@tiptap/react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(nodes: { type: string; attrs?: Record<string, unknown> }[]) {
  return {
    descendants: (cb: (node: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void) => {
      for (const node of nodes) {
        const r = cb({ type: { name: node.type }, attrs: node.attrs ?? {} });
        if (r === false) break;
      }
    },
  };
}

function makeEditor(nodes: { type: string; attrs?: Record<string, unknown> }[]): Editor {
  return {
    state: { doc: makeDoc(nodes) },
  } as unknown as Editor;
}

// ---------------------------------------------------------------------------
// FootnoteRegistry
// ---------------------------------------------------------------------------

describe('FootnoteRegistry', () => {
  beforeEach(() => {
    FootnoteRegistry.clear();
  });

  it('stores and retrieves text by id', () => {
    FootnoteRegistry.set('fn-1', 'First footnote');
    expect(FootnoteRegistry.get('fn-1')).toBe('First footnote');
  });

  it('returns undefined for unknown id', () => {
    expect(FootnoteRegistry.get('not-there')).toBeUndefined();
  });

  it('overwrites existing entry on re-set', () => {
    FootnoteRegistry.set('fn-1', 'original');
    FootnoteRegistry.set('fn-1', 'updated');
    expect(FootnoteRegistry.get('fn-1')).toBe('updated');
  });
});

// ---------------------------------------------------------------------------
// getFootnoteItems
// ---------------------------------------------------------------------------

describe('getFootnoteItems', () => {
  beforeEach(() => {
    FootnoteRegistry.clear();
  });

  it('returns empty array when document has no footnote nodes', () => {
    const editor = makeEditor([
      { type: 'paragraph' },
      { type: 'heading', attrs: { level: 1 } },
    ]);
    expect(getFootnoteItems(editor)).toHaveLength(0);
  });

  it('returns one item for a single footnote', () => {
    FootnoteRegistry.set('fn-a', 'A note');
    const editor = makeEditor([
      { type: 'paragraph' },
      { type: 'footnote', attrs: { id: 'fn-a' } },
    ]);
    const items = getFootnoteItems(editor);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ id: 'fn-a', number: 1, text: 'A note' });
  });

  it('assigns sequential numbers in document order', () => {
    FootnoteRegistry.set('fn-1', 'Note one');
    FootnoteRegistry.set('fn-2', 'Note two');
    FootnoteRegistry.set('fn-3', 'Note three');
    const editor = makeEditor([
      { type: 'footnote', attrs: { id: 'fn-1' } },
      { type: 'paragraph' },
      { type: 'footnote', attrs: { id: 'fn-2' } },
      { type: 'footnote', attrs: { id: 'fn-3' } },
    ]);
    const items = getFootnoteItems(editor);
    expect(items).toHaveLength(3);
    expect(items[0].number).toBe(1);
    expect(items[1].number).toBe(2);
    expect(items[2].number).toBe(3);
  });

  it('returns empty string for footnote with no registry entry', () => {
    const editor = makeEditor([
      { type: 'footnote', attrs: { id: 'fn-unknown' } },
    ]);
    const items = getFootnoteItems(editor);
    expect(items[0].text).toBe('');
  });

  it('ignores non-footnote nodes', () => {
    FootnoteRegistry.set('fn-x', 'Only note');
    const editor = makeEditor([
      { type: 'heading', attrs: { level: 2 } },
      { type: 'paragraph' },
      { type: 'table' },
      { type: 'footnote', attrs: { id: 'fn-x' } },
      { type: 'blockquote' },
    ]);
    const items = getFootnoteItems(editor);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('fn-x');
  });
});
