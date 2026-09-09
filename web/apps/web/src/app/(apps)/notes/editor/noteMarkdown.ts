/**
 * A note's stored format: Markdown.
 *
 * This module is the whole of it — `parseBlocks` reads a note body into the
 * editor's `Block[]`, `serializeBlocks` writes those blocks back out, and the
 * two are inverses (`__tests__/notes/noteMarkdown.test.ts` pins that
 * down). Notes used to be stored as `JSON.stringify(Block[])`, which made the
 * body unreadable to anything but this editor: the iOS Notes app opens the
 * same Drive file in a plain Markdown editor, so every note written on the web
 * arrived there as a wall of JSON. Markdown is what both ends already speak.
 *
 * Block content is *already* markdown-ish — the editor shows `**bold**` and
 * `[[wiki link]]` as the user types them — so a block only needs its
 * type-specific line prefix. What has no Markdown spelling at all is the
 * table extras: column widths, row heights and the style preset. Those ride in
 * an HTML comment ahead of the table, which every other Markdown renderer
 * ignores, so the file stays valid Markdown and a table opened elsewhere is
 * still a table. Drop the comment and the table survives with default sizing.
 *
 * Kept deliberately free of React and CSS imports: `lib/takeout/keep.ts` reads
 * the format too, and pulling the editor into the import bundle is what the
 * docs/sheets converters go out of their way to avoid.
 */

import type { Block, BlockType, TableData, TableStyle } from './blockEditorTypes';
import { DIVIDER_PATTERN } from './blockEditorConstants';

/** Width a column gets when the metadata comment carries none. */
export const DEFAULT_COLUMN_WIDTH = 160;

const TABLE_META_PREFIX = '<!-- neutrino:table ';
const TABLE_META_SUFFIX = '-->';

export function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function block(type: BlockType, content: string, checked?: boolean): Block {
  return checked === undefined
    ? { id: genId(), type, content }
    : { id: genId(), type, content, checked };
}

// ── Line grammar ────────────────────────────────────────────────────────────

const FENCE = /^\s*(`{3,}|~{3,})/;
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HEADING = /^\s*#{1,6}\s+\S/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
/** A table's `| --- | :-: |` rule: structure, not a row of data. */
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;

// ── Table extras ────────────────────────────────────────────────────────────

/**
 * What the metadata comment carries. Every field is positional and optional:
 * a table whose columns are all default width and which has no style writes no
 * comment at all, so a plain Markdown table stays plain.
 */
interface TableMeta {
  widths?: number[];
  /** Per-row height, `null` for a row that has none. */
  heights?: (number | null)[];
  style?: TableStyle;
}

/** A cell's text on one line: `|` would end the cell, a newline the row. */
function escapeCell(content: string): string {
  return content.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function unescapeCell(text: string): string {
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|').trim();
}

/** Split a table line on unescaped pipes only. */
function splitRow(inner: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      current += '\\|';
      i++;
    } else if (ch === '|') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map(unescapeCell);
}

function tableMetaFor(table: TableData): TableMeta | null {
  const meta: TableMeta = {};

  if (table.columns.some((c) => c.width !== DEFAULT_COLUMN_WIDTH)) {
    meta.widths = table.columns.map((c) => c.width);
  }
  if (table.rows.some((r) => typeof r.height === 'number')) {
    meta.heights = table.rows.map((r) => (typeof r.height === 'number' ? r.height : null));
  }
  // An all-false style object says no more than an absent one.
  if (table.style && Object.values(table.style).some((v) => v !== undefined && v !== false)) {
    meta.style = table.style;
  }

  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Whether this line is our table comment — asked separately from parsing it,
 * so that metadata we cannot read is still swallowed as the marker it is
 * rather than shown to the reader as a line of note text.
 */
function isTableMetaLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith(TABLE_META_PREFIX) && trimmed.endsWith(TABLE_META_SUFFIX);
}

function parseTableMeta(line: string): TableMeta | null {
  if (!isTableMetaLine(line)) return null;
  const trimmed = line.trim();
  const json = trimmed.slice(TABLE_META_PREFIX.length, -TABLE_META_SUFFIX.length).trim();
  try {
    const parsed = JSON.parse(json);
    // Hand-edited or truncated metadata must cost the table its sizing, never
    // its contents — the rows are parsed from the Markdown either way.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as TableMeta) : null;
  } catch {
    return null;
  }
}

function tableFromRows(rows: string[][], meta: TableMeta | null): TableData {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const widths = Array.isArray(meta?.widths) ? meta.widths : [];
  const heights = Array.isArray(meta?.heights) ? meta.heights : [];

  const table: TableData = {
    columns: Array.from({ length: columnCount }, (_, i) => ({
      id: genId(),
      width: typeof widths[i] === 'number' ? widths[i] : DEFAULT_COLUMN_WIDTH,
    })),
    rows: rows.map((cells, i) => {
      const height = heights[i];
      const row = {
        id: genId(),
        // A short row is padded so every row has a cell per column; the editor
        // indexes cells by position and a ragged table would render holes.
        cells: Array.from({ length: columnCount }, (_, c) => ({
          id: genId(),
          content: cells[c] ?? '',
        })),
      };
      return typeof height === 'number' ? { ...row, height } : row;
    }),
  };

  if (meta?.style && typeof meta.style === 'object') table.style = meta.style;
  return table;
}

// ── Blocks → Markdown ───────────────────────────────────────────────────────

export function numberedIndexInGroup(blocks: Block[], blockIndex: number): number {
  let count = 1;
  for (let i = blockIndex - 1; i >= 0; i--) {
    if (blocks[i].type === 'numbered') count++;
    else break;
  }
  return count;
}

/** A fence long enough to survive backticks inside the code itself. */
function codeFence(content: string): string {
  const longest = content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Render a single block as Markdown lines — block content is already stored
 * using the same `**bold**` / `[[wiki link]]` markdown-ish syntax shown in
 * the editor, so blocks only need their type-specific prefix. `blocks` and
 * `index` are the block's position in the *full* note, not just whatever
 * subset is being rendered (e.g. a copied selection) — a numbered item's
 * number depends on the unbroken run of numbered blocks before it there.
 */
export function blockToMarkdownLines(block: Block, blocks: Block[], index: number): string[] {
  switch (block.type) {
    case 'bullet':
      return [`- ${block.content}`];
    case 'numbered':
      return [`${numberedIndexInGroup(blocks, index)}. ${block.content}`];
    case 'task':
      return [`- [${block.checked ? 'x' : ' '}] ${block.content}`];
    case 'blockquote':
      return [`> ${block.content}`];
    case 'code': {
      const fence = codeFence(block.content);
      return [fence, block.content, fence];
    }
    case 'table': {
      const table = block.tableData;
      const rows = table?.rows ?? [];
      if (rows.length === 0) return [];

      const lines: string[] = [];
      const meta = table ? tableMetaFor(table) : null;
      if (meta) lines.push(`${TABLE_META_PREFIX}${JSON.stringify(meta)} ${TABLE_META_SUFFIX}`);

      rows.forEach((row, i) => {
        lines.push(`| ${row.cells.map((c) => escapeCell(c.content)).join(' | ')} |`);
        // GFM needs the rule after the first row for the rest to read as a
        // table at all, whether or not this table styles a header row.
        if (i === 0) lines.push(`| ${row.cells.map(() => '---').join(' | ')} |`);
      });
      return lines;
    }
    default:
      return [block.content];
  }
}

/** A single block's Markdown, e.g. for copying just that block to the clipboard. */
export function blockToMarkdown(block: Block, blocks: Block[], index: number): string {
  return blockToMarkdownLines(block, blocks, index).join('\n');
}

/** Render a note's blocks as Markdown — this is what a note is stored as. */
export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    lines.push(...blockToMarkdownLines(block, blocks, index));
    // The blank line between blocks is what keeps them separate blocks on the
    // way back in: consecutive prose lines are one paragraph in Markdown.
    lines.push('');
  });
  const markdown = lines.join('\n').trim();
  return markdown ? `${markdown}\n` : '';
}

// ── Markdown → blocks ───────────────────────────────────────────────────────

/**
 * Parse note Markdown into blocks.
 *
 * Headings keep their `#` prefix in a paragraph's content, which is exactly
 * how the editor itself stores one (see `toggleHeadingPrefix`) and how
 * `blocksToHtml` renders it. Blank lines produce no block: they are the
 * separator between blocks, and blocks are already spaced apart, so keeping
 * them would double a note's height every time it was opened and saved.
 */
export function markdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      // A paragraph block may hold newlines of its own, so consecutive prose
      // lines rejoin into the one block they were written as.
      blocks.push(block('paragraph', paragraph.join('\n')));
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code: everything up to the closing fence is content, verbatim.
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      flushParagraph();
      const fence = fenceMatch[1];
      const code: string[] = [];
      i++;
      for (; i < lines.length; i++) {
        // A closing fence is at least as long as the opening one, so code
        // holding a shorter run of backticks does not end its own block.
        if (lines[i].trim().startsWith(fence)) break;
        code.push(lines[i]);
      }
      // An unterminated fence still holds the user's lines.
      blocks.push(block('code', code.join('\n')));
      continue;
    }

    // A table: its optional metadata comment, then every `|` line under it.
    const isMeta = isTableMetaLine(line);
    if (isMeta || TABLE_ROW.test(line)) {
      const meta = isMeta ? parseTableMeta(line) : null;
      const start = isMeta ? i + 1 : i;
      if (TABLE_ROW.test(lines[start] ?? '')) {
        flushParagraph();
        const rows: string[][] = [];
        let j = start;
        for (; j < lines.length && TABLE_ROW.test(lines[j]); j++) {
          if (TABLE_RULE.test(lines[j])) continue;
          rows.push(splitRow(lines[j].trim().replace(/^\|/, '').replace(/\|$/, '')));
        }
        blocks.push({ id: genId(), type: 'table', content: '', tableData: tableFromRows(rows, meta) });
        i = j - 1;
        continue;
      }
      // A marker with no table under it is dropped rather than shown.
      if (isMeta) continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    let match: RegExpMatchArray | null;
    if ((match = line.match(TASK))) {
      flushParagraph();
      blocks.push(block('task', match[2].trim(), match[1] !== ' '));
    } else if ((match = line.match(BULLET))) {
      flushParagraph();
      blocks.push(block('bullet', match[1].trim()));
    } else if ((match = line.match(NUMBERED))) {
      flushParagraph();
      blocks.push(block('numbered', match[1].trim()));
    } else if ((match = line.match(QUOTE))) {
      flushParagraph();
      blocks.push(block('blockquote', match[1].trim()));
    } else if (HEADING.test(line) || DIVIDER_PATTERN.test(line)) {
      // Both are their own block, and both keep their syntax as content —
      // a heading so the editor can toggle its level, a divider because
      // `isDividerContent` is what renders the rule.
      flushParagraph();
      blocks.push(block('paragraph', line.trim()));
    } else {
      paragraph.push(line);
    }
  }

  flushParagraph();
  return blocks;
}

// ── The stored body ─────────────────────────────────────────────────────────

/** Read a note body into the editor's blocks. */
export function parseBlocks(content: string): Block[] {
  const blocks = content.trim() ? markdownToBlocks(content) : [];
  // The editor always needs somewhere to put the cursor.
  return blocks.length > 0 ? blocks : [{ id: genId(), type: 'paragraph', content: '' }];
}

/** Write the editor's blocks out as a note body. */
export function serializeBlocks(blocks: Block[]): string {
  return blocksToMarkdown(blocks);
}
