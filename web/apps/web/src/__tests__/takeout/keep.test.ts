/**
 * Tests for the Keep → note conversion (`lib/takeout/keep.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  convertKeepNote,
  keepNoteTitle,
  keepNoteToBlocks,
  looksLikeKeepNote,
  markdownToBlocks,
  parseKeepNote,
  UNTITLED,
  type KeepNote,
} from '@/lib/takeout/keep';
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

  it('serialises to the Block[] JSON a note stores', () => {
    expect(JSON.parse(converted.content)).toEqual(converted.blocks);
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

describe('markdownToBlocks', () => {
  it('makes one paragraph per line', () => {
    expect(markdownToBlocks('one\ntwo')).toMatchObject([
      { type: 'paragraph', content: 'one' },
      { type: 'paragraph', content: 'two' },
    ]);
  });

  it('drops blank lines rather than emitting empty blocks', () => {
    expect(markdownToBlocks('one\n\n\ntwo')).toHaveLength(2);
  });

  it('recognises bullets, including Keep’s bullet character', () => {
    expect(markdownToBlocks('- a\n* b\n• c')).toMatchObject([
      { type: 'bullet', content: 'a' },
      { type: 'bullet', content: 'b' },
      { type: 'bullet', content: 'c' },
    ]);
  });

  it('recognises numbered items written either way', () => {
    expect(markdownToBlocks('1. a\n2) b')).toMatchObject([
      { type: 'numbered', content: 'a' },
      { type: 'numbered', content: 'b' },
    ]);
  });

  it('recognises tasks and reads their checkbox', () => {
    expect(markdownToBlocks('- [ ] open\n- [x] shut\n- [X] shut too')).toMatchObject([
      { type: 'task', content: 'open', checked: false },
      { type: 'task', content: 'shut', checked: true },
      { type: 'task', content: 'shut too', checked: true },
    ]);
  });

  it('prefers a task over a bullet when both could match', () => {
    expect(markdownToBlocks('- [ ] a')[0].type).toBe('task');
  });

  it('recognises blockquotes', () => {
    expect(markdownToBlocks('> quoted')).toMatchObject([{ type: 'blockquote', content: 'quoted' }]);
  });

  it('collects a fenced block into one code block', () => {
    expect(markdownToBlocks('before\n```\nline 1\nline 2\n```\nafter')).toMatchObject([
      { type: 'paragraph', content: 'before' },
      { type: 'code', content: 'line 1\nline 2' },
      { type: 'paragraph', content: 'after' },
    ]);
  });

  it('keeps the lines of an unterminated fence', () => {
    expect(markdownToBlocks('```\nstill mine')).toMatchObject([{ type: 'code', content: 'still mine' }]);
  });

  it('does not re-parse markdown inside a code block', () => {
    expect(markdownToBlocks('```\n- not a bullet\n```')).toMatchObject([
      { type: 'code', content: '- not a bullet' },
    ]);
  });

  it('renders a heading as a bold paragraph, the closest the editor has', () => {
    expect(markdownToBlocks('## Heading')).toMatchObject([
      { type: 'paragraph', content: '**Heading**' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(markdownToBlocks('')).toEqual([]);
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
