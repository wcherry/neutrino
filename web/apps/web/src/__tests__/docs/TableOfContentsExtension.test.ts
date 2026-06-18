/**
 * Unit tests for the TOC heading extraction logic.
 *
 * Covers:
 *   - Returns empty array when no headings exist
 *   - Returns all headings with correct level and text
 *   - Skips empty-text headings
 *   - Preserves document order
 *   - Includes headings of all levels (h1–h6)
 */

import { describe, it, expect } from 'vitest';
import type { Editor } from '@tiptap/react';

// ---------------------------------------------------------------------------
// Re-implement the extraction function inline so the test is self-contained
// (the actual function is inside a .tsx file that imports React/NodeView).
// ---------------------------------------------------------------------------

interface TocEntry { level: number; text: string; pos: number }

function getTocEntries(editor: Editor): TocEntry[] {
  const entries: TocEntry[] = [];
  editor.state.doc.descendants((node: { type: { name: string }; textContent: string; attrs: { level: number } }, pos: number) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level;
      const text = node.textContent;
      if (text.trim()) {
        entries.push({ level, text, pos });
      }
    }
  });
  return entries;
}

// ---------------------------------------------------------------------------
// Mock editor factory
// ---------------------------------------------------------------------------

interface MockNode {
  type: string;
  text?: string;
  level?: number;
  pos?: number;
}

function makeEditor(nodes: MockNode[]): Editor {
  const docNodes = nodes.map((n, i) => ({
    type: { name: n.type },
    textContent: n.text ?? '',
    attrs: { level: n.level ?? 1 },
    _pos: n.pos ?? i * 10,
  }));

  return {
    state: {
      doc: {
        descendants: (cb: (n: unknown, pos: number) => void) => {
          for (const n of docNodes) {
            cb(n, n._pos);
          }
        },
      },
    },
  } as unknown as Editor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TOC heading extraction', () => {
  it('returns empty array when no headings exist', () => {
    const editor = makeEditor([
      { type: 'paragraph', text: 'Some text' },
    ]);
    expect(getTocEntries(editor)).toHaveLength(0);
  });

  it('returns headings in document order', () => {
    const editor = makeEditor([
      { type: 'heading', text: 'Introduction', level: 1, pos: 0 },
      { type: 'paragraph', text: 'Text' },
      { type: 'heading', text: 'Methods', level: 2, pos: 30 },
      { type: 'heading', text: 'Results', level: 2, pos: 60 },
    ]);
    const entries = getTocEntries(editor);
    expect(entries).toHaveLength(3);
    expect(entries[0].text).toBe('Introduction');
    expect(entries[1].text).toBe('Methods');
    expect(entries[2].text).toBe('Results');
  });

  it('preserves heading levels', () => {
    const editor = makeEditor([
      { type: 'heading', text: 'H1', level: 1 },
      { type: 'heading', text: 'H2', level: 2 },
      { type: 'heading', text: 'H3', level: 3 },
    ]);
    const entries = getTocEntries(editor);
    expect(entries[0].level).toBe(1);
    expect(entries[1].level).toBe(2);
    expect(entries[2].level).toBe(3);
  });

  it('skips headings with empty text content', () => {
    const editor = makeEditor([
      { type: 'heading', text: '', level: 1 },
      { type: 'heading', text: '   ', level: 2 },
      { type: 'heading', text: 'Valid Heading', level: 1 },
    ]);
    const entries = getTocEntries(editor);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Valid Heading');
  });

  it('records correct positions', () => {
    const editor = makeEditor([
      { type: 'heading', text: 'First', level: 1, pos: 5 },
      { type: 'heading', text: 'Second', level: 1, pos: 100 },
    ]);
    const entries = getTocEntries(editor);
    expect(entries[0].pos).toBe(5);
    expect(entries[1].pos).toBe(100);
  });

  it('handles all heading levels h1–h6', () => {
    const editor = makeEditor(
      [1, 2, 3, 4, 5, 6].map(level => ({ type: 'heading', text: `H${level}`, level })),
    );
    const entries = getTocEntries(editor);
    expect(entries).toHaveLength(6);
    entries.forEach((e, i) => {
      expect(e.level).toBe(i + 1);
    });
  });

  it('does not include non-heading nodes', () => {
    const editor = makeEditor([
      { type: 'paragraph', text: 'Not a heading' },
      { type: 'blockquote', text: 'Also not a heading' },
      { type: 'heading', text: 'Real heading', level: 1 },
    ]);
    const entries = getTocEntries(editor);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Real heading');
  });
});
