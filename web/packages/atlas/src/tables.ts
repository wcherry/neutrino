import { definition } from 'micromark-core-commonmark';
import { gfmTable } from 'micromark-extension-gfm-table';
import type { Code, Construct, Effects, Extension, State, Token, TokenizeContext } from 'micromark-util-types';

/**
 * GFM tables, opened and ended where cmark-gfm's table extension (and so AtlasKit) opens and
 * ends them. micromark's construct does the parsing; three of cmark's rules it lacks are added:
 * - A paragraph that has had a line shaped like a delimiter row which didn't match the line above
 *   it never becomes a table (cmark's `CMARK_NODE__TABLE_VISITED`): in `]\n-|-\n-|-` the second
 *   line fails against `]`, so the third isn't tried against the second.
 * - A body row of only a `|` has no cells, so it ends the table and starts a paragraph.
 * - The lines of a paragraph before a table's header row stay that paragraph's text: cmark
 *   splits the table off before it reads reference definitions, so `[r]: /u` there is text, and
 *   defines nothing.
 */

/** The paragraphs a table split, by source offset, per parse: no definitions are read in them. */
const splitParagraphs = new WeakMap<object, { from: number; to: number }[]>();

const isSpaceChar = (c: string) => c === ' ' || c === '\t' || c === '\v' || c === '\f';
const ESCAPABLE = '|!"#$%&\'()*+,./:;<=>?@[\\]^_`{}~-';

/** cmark-gfm's `scan_table_start`: a delimiter row, `|? :?-+:? (| :?-+:?)* |?`, with spaces around. */
export const isDelimiterRow = (line: string) => /^\|?[ \t\v\f]*:?-+:?[ \t\v\f]*(\|[ \t\v\f]*:?-+:?[ \t\v\f]*)*\|?[ \t\v\f]*$/.test(line);

/**
 * How many cells cmark-gfm's `row_from_string` reads in one line (from its first non-space), or
 * null for none: a line of only a `|` is no row.
 */
export function rowCells(line: string): number | null {
  const pipeEnd = (at: number) => {
    if (line[at] !== '|') return 0;
    let i = at + 1;
    while (i < line.length && isSpaceChar(line[i])) i++;
    return i - at;
  };
  let offset = pipeEnd(0);
  let cells = 0;
  while (offset < line.length) {
    let i = offset;
    while (i < line.length && line[i] !== '|') i += line[i] === '\\' && i + 1 < line.length && ESCAPABLE.includes(line[i + 1]) ? 2 : 1;
    const cell = i - offset;
    const pipe = pipeEnd(i);
    if (cell === 0 && pipe === 0) {
      // Only spaces are left, which `scan_table_row_end` takes; anything else isn't a row.
      if (!/^[ \t\v\f]*$/.test(line.slice(i))) return null;
      break;
    }
    cells++;
    offset = i + pipe;
  }
  return cells === 0 ? null : cells;
}

/** The width of a line's indentation, tabs to the next multiple of four from `column` (0-based). */
function indentWidth(text: string, column: number): number {
  let col = column;
  for (const c of text) {
    if (c === ' ') col++;
    else if (c === '\t') col += 4 - (col % 4);
    else break;
  }
  return col - column;
}

/** The lines of the paragraph open in `self`'s flow, if one is: text, where it starts, and whether it's lazy. */
function openParagraph(self: TokenizeContext): { lines: { text: string; indent: number; lazy: boolean }[]; from: number } | null {
  const chunks: Token[] = [];
  for (let k = self.events.length - 1; k >= 0; k--) {
    const [kind, token] = self.events[k];
    if (token.type === 'content') {
      if (kind === 'exit') return null;
      const lines = chunks.reverse().map((chunk) => {
        const raw = self.sliceSerialize(chunk).replace(/\r?\n$|\r$/, '');
        return { text: raw.replace(/^[ \t]+/, ''), indent: indentWidth(raw, chunk.start.column - 1), lazy: self.parser.lazy[chunk.start.line] === true };
      });
      return { lines, from: token.start.offset };
    }
    if (token.type === 'chunkContent' && kind === 'enter') chunks.push(token);
    else if (token.type !== 'chunkContent' && token.type !== 'lineEnding' && token.type !== 'linePrefix') return null;
  }
  return null;
}

/** The rest of the source line from `offset`. */
const lineAt = (source: string, offset: number) => {
  const end = source.slice(offset).search(/[\r\n]/);
  return end < 0 ? source.slice(offset) : source.slice(offset, offset + end);
};

/** What the parse found out that the tree doesn't keep: which lines were lazy continuations. */
export interface ParseInfo {
  lazy: Record<number, boolean>;
}

export function atlasTable(source: string, parse?: ParseInfo): Extension {
  const base = gfmTable().flow!.null as Construct;
  const table: Construct = {
    ...base,
    tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
      const self = this;
      if (parse) parse.lazy = self.parser.lazy;
      const here = self.now();
      const line = lineAt(source, here.offset).replace(/^[ \t]+/, '');

      // A body row follows the head or another row, as micromark's own `start` decides.
      let tail: string | null = null;
      for (let k = self.events.length - 1; k >= 0; k--) {
        const type = self.events[k][1].type;
        if (type !== 'lineEnding' && type !== 'linePrefix') { tail = type; break; }
      }
      if (tail === 'tableHead' || tail === 'tableRow') {
        return rowCells(line) === null ? nok : base.tokenize.call(self, effects, ok, nok);
      }

      // A header row interrupting a paragraph: cmark would have tried each earlier line as a
      // delimiter row for the lines above it, and one that failed closes the paragraph to tables.
      const paragraph = self.interrupt ? openParagraph(self) : null;
      if (paragraph) {
        const lines = [...paragraph.lines, { text: line, indent: 0, lazy: self.parser.lazy[here.line] === true }];
        for (let j = 1; j < lines.length; j++) {
          const d = lines[j];
          if (d.lazy || d.indent >= 4 || !isDelimiterRow(d.text)) continue;
          if (rowCells(lines[j - 1].text) !== rowCells(d.text)) return nok;
        }
      }
      const opened: State = (code: Code) => {
        if (paragraph) {
          const split = splitParagraphs.get(self.parser) ?? [];
          split.push({ from: paragraph.from, to: here.offset });
          splitParagraphs.set(self.parser, split);
        }
        return ok(code);
      };
      return base.tokenize.call(self, effects, opened, nok);
    },
  };
  const atlasDefinition: Construct = {
    ...definition,
    name: 'atlasDefinition',
    tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
      const at = this.now().offset;
      if (splitParagraphs.get(this.parser)?.some((r) => r.from <= at && at < r.to)) return nok;
      return definition.tokenize.call(this, effects, ok, nok);
    },
  };
  return { disable: { null: ['definition'] }, flow: { null: table }, contentInitial: { 91: atlasDefinition } };
}
