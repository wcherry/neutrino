/**
 * Tests for the Keep → note conversion (`lib/takeout/keep.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  convertKeepNote,
  keepNoteTitle,
  keepNoteToBlocks,
  looksLikeKeepNote,
  parseKeepNote,
  UNTITLED,
  type KeepNote,
} from '@/lib/takeout/keep';
// The Markdown parser this conversion goes through is the note format itself —
// it lives with the editor, and `notes/noteMarkdown.test.ts` covers it.
import { parseBlocks, serializeBlocks } from '@/app/(apps)/notes/editor/noteMarkdown';
import { KEEP_LIST_NOTE_ITEMS, KEEP_LIST_NOTE_JSON } from './fixtures/keepNotes';

describe('parseKeepNote', () => {
  it('parses a real Takeout list note', () => {
    const note = parseKeepNote(KEEP_LIST_NOTE_JSON);
    expect(note).not.toBeNull();
    expect(note!.title).toBe('Traits of a really good developer');
    expect(note!.isArchived).toBe(true);
    expect(note!.listContent).toHaveLength(13);
  });

  it('returns null for JSON that is not a Keep note', () => {
    expect(parseKeepNote('{"foo":"bar"}')).toBeNull();
    expect(parseKeepNote('[1,2,3]')).toBeNull();
  });

  it('returns null for text that is not JSON', () => {
    expect(parseKeepNote('<html></html>')).toBeNull();
  });
});

describe('looksLikeKeepNote', () => {
  it('recognises a note with only text', () => {
    expect(looksLikeKeepNote({ textContent: 'hi' })).toBe(true);
  });

  it('recognises an empty note by its Keep-only fields', () => {
    expect(looksLikeKeepNote({ title: '', isTrashed: false, createdTimestampUsec: 1 })).toBe(true);
  });

  it('rejects other objects', () => {
    expect(looksLikeKeepNote({ name: 'a photo', width: 10 })).toBe(false);
    expect(looksLikeKeepNote(null)).toBe(false);
    expect(looksLikeKeepNote('text')).toBe(false);
  });
});

describe('convertKeepNote — the real list note', () => {
  const converted = convertKeepNote(parseKeepNote(KEEP_LIST_NOTE_JSON)!);

  it('keeps the note title', () => {
    expect(converted.title).toBe('Traits of a really good developer');
  });

  it('turns every list item into an unchecked task', () => {
    expect(converted.blocks).toHaveLength(13);
    expect(converted.blocks.every((b) => b.type === 'task')).toBe(true);
    expect(converted.blocks.every((b) => b.checked === false)).toBe(true);
  });

  it('carries the item text across, trimmed', () => {
    expect(converted.blocks.map((b) => b.content)).toEqual(KEEP_LIST_NOTE_ITEMS);
  });

  it('gives every block a distinct id', () => {
    expect(new Set(converted.blocks.map((b) => b.id)).size).toBe(converted.blocks.length);
  });

  it('serialises to the Markdown a note stores', () => {
    expect(converted.content).toBe(serializeBlocks(converted.blocks));
    // Round-trips: what the importer writes is what the editor reads back.
    expect(parseBlocks(converted.content)).toMatchObject(
      converted.blocks.map(({ id: _id, ...rest }) => rest)
    );
  });
});

describe('keepNoteToBlocks — checklists', () => {
  it('preserves the checked state of each item', () => {
    const note: KeepNote = {
      listContent: [
        { text: 'done', isChecked: true },
        { text: 'todo', isChecked: false },
      ],
    };
    expect(keepNoteToBlocks(note)).toMatchObject([
      { type: 'task', content: 'done', checked: true },
      { type: 'task', content: 'todo', checked: false },
    ]);
  });

  it('treats a missing isChecked as unchecked', () => {
    expect(keepNoteToBlocks({ listContent: [{ text: 'x' }] })[0].checked).toBe(false);
  });
});

describe('keepNoteToBlocks — trailing sections', () => {
  it('lists annotations as links', () => {
    const blocks = keepNoteToBlocks({
      textContent: 'See this',
      annotations: [{ title: 'Example', url: 'https://example.com' }],
    });
    expect(blocks).toMatchObject([
      { type: 'paragraph', content: 'See this' },
      { type: 'paragraph', content: '**Links**' },
      { type: 'bullet', content: 'Example — https://example.com' },
    ]);
  });

  it('ignores annotations with no URL', () => {
    expect(keepNoteToBlocks({ textContent: 'x', annotations: [{ title: 'no url' }] })).toHaveLength(1);
  });

  it('records attachment filenames, which are not imported', () => {
    const blocks = keepNoteToBlocks({
      textContent: 'x',
      attachments: [{ filePath: 'a.jpg' }, { filePath: 'b.png' }],
    });
    expect(blocks[1].content).toBe('**Attachments (not imported):** a.jpg, b.png');
  });

  it('records labels, which have no folder equivalent', () => {
    const blocks = keepNoteToBlocks({ textContent: 'x', labels: [{ name: 'work' }, { name: 'ideas' }] });
    expect(blocks[1].content).toBe('**Labels:** work, ideas');
  });

  it('adds nothing when those fields are empty', () => {
    expect(keepNoteToBlocks({ textContent: 'x', labels: [], attachments: [], annotations: [] })).toHaveLength(1);
  });

  it('always leaves at least one block for the cursor', () => {
    expect(keepNoteToBlocks({})).toMatchObject([{ type: 'paragraph', content: '' }]);
  });
});

describe('keepNoteTitle', () => {
  const titleOf = (note: KeepNote) => keepNoteTitle(note, keepNoteToBlocks(note));

  it('uses the note title when there is one', () => {
    expect(titleOf({ title: '  Shopping  ', textContent: 'milk' })).toBe('Shopping');
  });

  it('falls back to the first line, as Keep itself displays', () => {
    expect(titleOf({ textContent: 'Call the plumber\nabout the sink' })).toBe('Call the plumber');
  });

  it('strips inline markdown out of a derived title', () => {
    expect(titleOf({ textContent: '# Weekly plan' })).toBe('Weekly plan');
  });

  it('truncates a long first line', () => {
    const title = titleOf({ textContent: 'x'.repeat(200) });
    expect(title).toHaveLength(61);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to a placeholder for an empty note', () => {
    expect(titleOf({})).toBe(UNTITLED);
    expect(titleOf({ textContent: '   ' })).toBe(UNTITLED);
  });

  it('flattens characters that cannot go in a file name', () => {
    expect(titleOf({ title: 'Q1/Q2\nplanning' })).toBe('Q1-Q2 planning');
  });
});
