/**
 * Tests for the note storage format (`notes/editor/noteMarkdown.ts`).
 *
 * A note is stored as Markdown, so the property that matters most is that
 * `parseBlocks` and `serializeBlocks` are inverses: every save re-reads what
 * the last one wrote, and a note that loses a table's sizing or a task's tick
 * on a round trip loses it permanently the moment it is saved again.
 *
 * The parser half of these cases came from `takeout/keep.test.ts`, which used
 * to own a second copy of this parser for the Keep importer.
 */

import { describe, it, expect } from 'vitest';
import {
  blocksToMarkdown,
  markdownToBlocks,
  parseBlocks,
  serializeBlocks,
  DEFAULT_COLUMN_WIDTH,
} from '@/app/(apps)/notes/editor/noteMarkdown';
import type { Block } from '@/app/(apps)/notes/editor/blockEditorTypes';

/** Blocks compare by shape: ids are regenerated on every parse. */
const shapeOf = (blocks: Block[]) => blocks.map(({ id: _id, ...rest }) => rest);

/** Parse → serialize → parse, which is what an open-and-save does. */
const roundTrip = (blocks: Block[]) => shapeOf(parseBlocks(serializeBlocks(blocks)));

describe('markdownToBlocks', () => {
  it('joins consecutive lines into one paragraph, as Markdown does', () => {
    expect(markdownToBlocks('one\ntwo')).toMatchObject([
      { type: 'paragraph', content: 'one\ntwo' },
    ]);
  });

  it('starts a new block at a blank line', () => {
    expect(markdownToBlocks('one\n\ntwo')).toMatchObject([
      { type: 'paragraph', content: 'one' },
      { type: 'paragraph', content: 'two' },
    ]);
  });

  it('drops blank lines rather than emitting empty blocks', () => {
    expect(markdownToBlocks('one\n\n\n\ntwo')).toHaveLength(2);
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
    expect(markdownToBlocks('before\n\n```\nline 1\nline 2\n```\n\nafter')).toMatchObject([
      { type: 'paragraph', content: 'before' },
      { type: 'code', content: 'line 1\nline 2' },
      { type: 'paragraph', content: 'after' },
    ]);
  });

  it('keeps the lines of an unterminated fence', () => {
    expect(markdownToBlocks('```\nstill mine')).toMatchObject([
      { type: 'code', content: 'still mine' },
    ]);
  });

  it('does not re-parse markdown inside a code block', () => {
    expect(markdownToBlocks('```\n- not a bullet\n```')).toMatchObject([
      { type: 'code', content: '- not a bullet' },
    ]);
  });

  it('keeps a heading as its own paragraph, prefix and all', () => {
    // The editor stores a heading as `## text` in a paragraph's content — see
    // `toggleHeadingPrefix` — so stripping the hashes here would demote every
    // heading to body text on the next save.
    expect(markdownToBlocks('## Heading\nbody')).toMatchObject([
      { type: 'paragraph', content: '## Heading' },
      { type: 'paragraph', content: 'body' },
    ]);
  });

  it('keeps a divider as its own paragraph', () => {
    expect(markdownToBlocks('above\n\n---\n\nbelow')).toMatchObject([
      { type: 'paragraph', content: 'above' },
      { type: 'paragraph', content: '---' },
      { type: 'paragraph', content: 'below' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(markdownToBlocks('')).toEqual([]);
  });
});

describe('parseBlocks', () => {
  it('gives an empty note one empty paragraph to put the cursor in', () => {
    expect(parseBlocks('')).toMatchObject([{ type: 'paragraph', content: '' }]);
    expect(parseBlocks('   \n\n')).toMatchObject([{ type: 'paragraph', content: '' }]);
  });

  it('reads a plain Markdown file written anywhere else', () => {
    // A `.md` uploaded to Drive is a note now, so the editor has to open one
    // it did not write.
    expect(parseBlocks('# Shopping\n\n- milk\n- eggs\n')).toMatchObject([
      { type: 'paragraph', content: '# Shopping' },
      { type: 'bullet', content: 'milk' },
      { type: 'bullet', content: 'eggs' },
    ]);
  });
});

describe('serializeBlocks', () => {
  it('writes an empty note as nothing at all', () => {
    expect(serializeBlocks([{ id: 'a', type: 'paragraph', content: '' }])).toBe('');
  });

  it('numbers an ordered list by its position in the run', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'numbered', content: 'first' },
      { id: 'b', type: 'numbered', content: 'second' },
      { id: 'c', type: 'paragraph', content: 'break' },
      { id: 'd', type: 'numbered', content: 'restarts' },
    ];
    expect(blocksToMarkdown(blocks)).toBe('1. first\n\n2. second\n\nbreak\n\n1. restarts\n');
  });

  it('lengthens the fence when the code itself holds backticks', () => {
    const blocks: Block[] = [{ id: 'a', type: 'code', content: '```\nnested\n```' }];
    const markdown = serializeBlocks(blocks);
    expect(markdown).toContain('````');
    expect(roundTrip(blocks)).toMatchObject([{ type: 'code', content: '```\nnested\n```' }]);
  });
});

describe('round trip', () => {
  it('preserves every block type', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'paragraph', content: '# Title' },
      { id: 'b', type: 'paragraph', content: 'Body with **bold** and a [[Wiki Link]].' },
      { id: 'c', type: 'bullet', content: 'a bullet' },
      { id: 'd', type: 'numbered', content: 'an item' },
      { id: 'e', type: 'task', content: 'done', checked: true },
      { id: 'f', type: 'task', content: 'not done', checked: false },
      { id: 'g', type: 'blockquote', content: 'quoted' },
      { id: 'h', type: 'code', content: 'const x = 1;' },
      { id: 'i', type: 'paragraph', content: '---' },
    ];
    expect(roundTrip(blocks)).toEqual(shapeOf(blocks));
  });

  it('preserves a paragraph that holds several lines', () => {
    const blocks: Block[] = [{ id: 'a', type: 'paragraph', content: 'line one\nline two' }];
    expect(roundTrip(blocks)).toEqual(shapeOf(blocks));
  });

  it('preserves a table’s cells', () => {
    const blocks: Block[] = [
      {
        id: 't',
        type: 'table',
        content: '',
        tableData: {
          columns: [
            { id: 'c1', width: DEFAULT_COLUMN_WIDTH },
            { id: 'c2', width: DEFAULT_COLUMN_WIDTH },
          ],
          rows: [
            { id: 'r1', cells: [{ id: 'a', content: 'Name' }, { id: 'b', content: 'Qty' }] },
            { id: 'r2', cells: [{ id: 'c', content: 'Apples' }, { id: 'd', content: '3' }] },
          ],
        },
      },
    ];
    const [table] = parseBlocks(serializeBlocks(blocks));
    expect(table.type).toBe('table');
    expect(table.tableData?.rows.map((r) => r.cells.map((c) => c.content))).toEqual([
      ['Name', 'Qty'],
      ['Apples', '3'],
    ]);
  });

  it('writes a plain table with no metadata comment', () => {
    const blocks: Block[] = [
      {
        id: 't',
        type: 'table',
        content: '',
        tableData: {
          columns: [{ id: 'c1', width: DEFAULT_COLUMN_WIDTH }],
          rows: [{ id: 'r1', cells: [{ id: 'a', content: 'only' }] }],
        },
      },
    ];
    expect(serializeBlocks(blocks)).toBe('| only |\n| --- |\n');
  });

  it('preserves column widths, row heights and the style preset', () => {
    const blocks: Block[] = [
      {
        id: 't',
        type: 'table',
        content: '',
        tableData: {
          columns: [
            { id: 'c1', width: 240 },
            { id: 'c2', width: DEFAULT_COLUMN_WIDTH },
          ],
          rows: [
            { id: 'r1', height: 48, cells: [{ id: 'a', content: 'h1' }, { id: 'b', content: 'h2' }] },
            { id: 'r2', cells: [{ id: 'c', content: 'x' }, { id: 'd', content: 'y' }] },
          ],
          style: { preset: 'blue-dark', headerRow: true, bandedRows: true },
        },
      },
    ];
    const [table] = parseBlocks(serializeBlocks(blocks));
    expect(table.tableData?.columns.map((c) => c.width)).toEqual([240, DEFAULT_COLUMN_WIDTH]);
    expect(table.tableData?.rows.map((r) => r.height)).toEqual([48, undefined]);
    expect(table.tableData?.style).toEqual({ preset: 'blue-dark', headerRow: true, bandedRows: true });
  });

  it('keeps a cell that contains a pipe or a newline', () => {
    const blocks: Block[] = [
      {
        id: 't',
        type: 'table',
        content: '',
        tableData: {
          columns: [{ id: 'c1', width: DEFAULT_COLUMN_WIDTH }],
          rows: [{ id: 'r1', cells: [{ id: 'a', content: 'a | b\nsecond line' }] }],
        },
      },
    ];
    const [table] = parseBlocks(serializeBlocks(blocks));
    expect(table.tableData?.rows[0].cells[0].content).toBe('a | b\nsecond line');
  });

  it('reads a table written without our metadata, at default sizing', () => {
    const [table] = parseBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(table.tableData?.columns).toMatchObject([
      { width: DEFAULT_COLUMN_WIDTH },
      { width: DEFAULT_COLUMN_WIDTH },
    ]);
    expect(table.tableData?.rows).toHaveLength(2);
  });

  it('ignores a metadata comment it cannot parse, keeping the rows', () => {
    const [table] = parseBlocks('<!-- neutrino:table {not json -->\n| a |\n| --- |\n| 1 |\n');
    expect(table.type).toBe('table');
    expect(table.tableData?.rows.map((r) => r.cells[0].content)).toEqual(['a', '1']);
  });

  it('is stable: a second save writes exactly what the first did', () => {
    const markdown = '# Title\n\nBody text\n\n- [x] done\n\n> quoted\n\n| a | b |\n\n| --- | --- |\n';
    expect(serializeBlocks(parseBlocks(markdown))).toBe(
      serializeBlocks(parseBlocks(serializeBlocks(parseBlocks(markdown))))
    );
  });
});
