import type { PageSyntax } from '../syntax/pageSyntax';

/**
 * The editor's Markdown commands, from AtlasKit's `MarkdownEditing`. Each returns the edit to
 * make, or null when the key should do what it normally does. They work on the text and the
 * syntax map only, so they're tested without an editor. Offsets are UTF-16, as CodeMirror counts.
 */

/** One change to a page's text. */
export interface TextEdit {
  /** The range replaced, in the text before the edit. */
  from: number;
  to: number;
  insert: string;
  /** The selection after the edit. */
  selection: { from: number; to: number };
}

export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

const caret = (at: number) => ({ from: at, to: at });

// ── Lines ─────────────────────────────────────────────────────────────────────

const isLineBreak = (c: number) => c === 0x0a || c === 0x0d || c === 0x85 || c === 0x2028 || c === 0x2029;

/** The line around `offset`, without its line ending (NSString's `getLineStart`). */
export function lineContent(text: string, offset: number): { from: number; to: number } {
  let from = Math.min(offset, text.length);
  while (from > 0 && !isLineBreak(text.charCodeAt(from - 1))) from--;
  let to = Math.min(offset, text.length);
  while (to < text.length && !isLineBreak(text.charCodeAt(to))) to++;
  return { from, to };
}

/** Where the line after the one ending at `end` starts. */
function nextLineStart(text: string, end: number): number {
  if (end >= text.length) return end;
  return text.charCodeAt(end) === 0x0d && text.charCodeAt(end + 1) === 0x0a ? end + 2 : end + 1;
}

function selectedLines(text: string, selection: { from: number; to: number }): { from: number; to: number }[] {
  const lines: { from: number; to: number }[] = [];
  let at = selection.from;
  for (;;) {
    const line = lineContent(text, at);
    lines.push(line);
    const end = nextLineStart(text, line.to);
    if (end <= at || end >= text.length) break;
    at = end;
    if (at >= selection.to) break;
  }
  return lines;
}

const isBlank = (s: string) => /^[ \t]*$/.test(s);

/** In code, math and frontmatter, Return and Tab are just characters. */
export function isInVerbatimBlock(offset: number, syntax: PageSyntax): boolean {
  for (const block of syntax.blocks) {
    if (!(block.from <= offset && offset <= block.to)) continue;
    for (const span of block.spans) {
      if (!(span.from < offset && offset <= span.to)) continue;
      if (span.kind.type === 'codeBlock' || span.kind.type === 'mathBlock' || span.kind.type === 'frontmatter') return true;
    }
  }
  return false;
}

/** Inside code, math, frontmatter or inline code and math: where `[[` and `/` are just text. */
export function isInCode(offset: number, syntax: PageSyntax): boolean {
  for (const block of syntax.blocks) {
    if (!(block.from <= offset && offset <= block.to)) continue;
    for (const span of block.spans) {
      if (!(span.from < offset && offset < span.to)) continue;
      const t = span.kind.type;
      if (t === 'inlineCode' || t === 'codeBlock' || t === 'mathBlock' || t === 'inlineMath' || t === 'frontmatter') return true;
    }
  }
  return false;
}

// ── List lines ────────────────────────────────────────────────────────────────

/** A list item line: indentation, marker, spaces, an optional checkbox. */
export interface ListLine {
  indent: number;
  /** Marker plus the spaces after it: the content offset relative to the indentation. */
  markerWidth: number;
}

export function listLine(line: string): ListLine | null {
  let k = 0;
  while (k < line.length && line[k] === ' ') k++;
  const indent = k;
  const m = k;
  if (k < line.length && '-*+'.includes(line[k])) {
    k++;
  } else {
    while (k < line.length && line[k] >= '0' && line[k] <= '9') k++;
    if (k === m || k - m > 9 || k >= line.length || (line[k] !== '.' && line[k] !== ')')) return null;
    k++;
  }
  if (!(k === line.length || line[k] === ' ' || line[k] === '\t')) return null;
  let spaces = 0;
  while (k + spaces < line.length && line[k + spaces] === ' ') spaces++;
  return { indent, markerWidth: k - m + Math.max(1, Math.min(spaces, 4)) };
}

/** The container markers that start a line: quotes, then at most one list item and its checkbox. */
interface LinePrefix {
  /** The prefix as written. */
  text: string;
  /** What the next line should start with. */
  continuation: string;
  /** The prefix without its innermost level: the list marker, or else the last `>`. */
  withoutLastLevel: string;
}

const PREFIX = /^([ \t]*(?:>[ \t]?)*)([ \t]*)(?:([-*+]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?)?/;

function linePrefix(line: string): LinePrefix | null {
  const m = PREFIX.exec(line);
  if (!m) return null;
  const quotes = m[1] ?? '';
  const indent = m[2] ?? '';
  if (m[3] !== undefined) {
    let next = m[3];
    if (m[4] !== undefined && m[5] !== undefined) next = `${Number(m[4]) + 1}${m[5]}`;
    const spaces = m[6] ?? ' ';
    return {
      text: m[0],
      continuation: quotes + indent + next + spaces + (m[7] !== undefined ? '[ ] ' : ''),
      withoutLastLevel: quotes + indent,
    };
  }
  if (!quotes.includes('>')) return null;
  let q = quotes.replace(/[ \t]+$/, '');
  if (q.endsWith('>')) q = q.slice(0, -1);
  q = q.replace(/[ \t]+$/, '');
  return {
    text: quotes,
    continuation: /[ \t]$/.test(quotes) ? quotes : quotes + ' ',
    withoutLastLevel: q === '' ? '' : q + ' ',
  };
}

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Return: continues a list item, task or quote on the next line. On an item or quote line with
 * nothing after its marker, removes the marker instead, which ends the list.
 */
export function newline(text: string, selection: { from: number; to: number }, syntax: PageSyntax): TextEdit | null {
  if (selection.from !== selection.to || isInVerbatimBlock(selection.from, syntax)) return null;
  const cursor = selection.from;
  const line = lineContent(text, cursor);
  const content = text.slice(line.from, line.to);
  const prefix = linePrefix(content);
  if (!prefix || cursor < line.from + prefix.text.length) return null;

  if (isBlank(content.slice(prefix.text.length))) {
    // An empty item or quote line: drop its marker (and one level of quote).
    const kept = prefix.withoutLastLevel;
    return { from: line.from, to: line.to, insert: kept, selection: caret(line.from + kept.length) };
  }
  const insert = '\n' + prefix.continuation;
  // Trailing spaces before the cursor go: they'd become a hard break or stray whitespace.
  let start = cursor;
  while (start > line.from + prefix.text.length && text.charCodeAt(start - 1) === 0x20) start--;
  return { from: start, to: cursor, insert, selection: caret(start + insert.length) };
}

function previousListLine(text: string, before: number, match: (l: ListLine) => boolean): ListLine | null {
  let at = before;
  while (at > 0) {
    const line = lineContent(text, at - 1);
    const content = text.slice(line.from, line.to);
    if (isBlank(content)) return null;
    const item = listLine(content);
    if (item && match(item)) return item;
    at = line.from;
  }
  return null;
}

/** Changes each line's indentation by `delta(line)` spaces, keeping the selection on the same text. */
function reindent(text: string, lines: { from: number; to: number }[], selection: { from: number; to: number }, delta: (line: { from: number; to: number }) => number): TextEdit | null {
  const start = lines[0].from;
  const end = lines[lines.length - 1].to;
  let out = '';
  let shiftStart = 0;
  let shiftEnd = 0;
  let changed = false;
  lines.forEach((line, k) => {
    if (k > 0) out += text.slice(lines[k - 1].to, line.from);
    const content = text.slice(line.from, line.to);
    const d = delta(line);
    let next = content;
    if (d > 0) next = ' '.repeat(d) + content;
    else if (d < 0) next = content.slice(Math.min(-d, /^ */.exec(content)![0].length));
    const change = next.length - content.length;
    if (change !== 0) changed = true;
    if (line.from <= selection.from) shiftStart += change;
    shiftEnd += change;
    out += next;
  });
  if (!changed) return null;
  const newStart = Math.max(start, selection.from + shiftStart);
  return { from: start, to: end, insert: out, selection: { from: newStart, to: Math.max(newStart, selection.to + shiftEnd) } };
}

/** Tab: indents the selected list items one level, under the item before them. Null when any selected line isn't a list item. */
export function indent(text: string, selection: { from: number; to: number }, syntax: PageSyntax): TextEdit | null {
  if (isInVerbatimBlock(selection.from, syntax)) return null;
  const lines = selectedLines(text, selection);
  if (!lines.every((l) => listLine(text.slice(l.from, l.to)))) return null;
  const item = listLine(text.slice(lines[0].from, lines[0].to))!;
  // One level is the content offset of the sibling above (2 for `- `, 3 for `1. `).
  const sibling = previousListLine(text, lines[0].from, (l) => l.indent === item.indent);
  const unit = sibling ? sibling.markerWidth : item.markerWidth;
  return reindent(text, lines, selection, () => unit);
}

/** Shift-Tab: outdents the selected list items to their parent's level. */
export function outdent(text: string, selection: { from: number; to: number }, syntax: PageSyntax): TextEdit | null {
  if (isInVerbatimBlock(selection.from, syntax)) return null;
  const lines = selectedLines(text, selection);
  const items = lines.map((l) => listLine(text.slice(l.from, l.to)));
  if (!items.every(Boolean) || !items.some((i) => i!.indent > 0)) return null;
  return reindent(text, lines, selection, (line) => {
    const item = listLine(text.slice(line.from, line.to))!;
    if (item.indent === 0) return 0;
    const parent = previousListLine(text, line.from, (l) => l.indent < item.indent);
    return -(item.indent - (parent?.indent ?? 0));
  });
}

/**
 * Ticks or unticks the task whose checkbox is at `offset`, or, with `onLine`, the task on the
 * line containing `offset`. It changes the one character between the brackets (SPEC §8.2).
 */
export function toggleTask(offset: number, text: string, syntax: PageSyntax, onLine = false): TextEdit | null {
  const range = onLine ? lineContent(text, Math.min(offset, text.length)) : { from: offset, to: offset };
  for (const block of syntax.blocks) {
    if (!(block.from <= range.to && range.from <= block.to)) continue;
    for (const span of block.spans) {
      if (span.kind.type !== 'syntax' || span.kind.role !== 'taskMarker') continue;
      const hit = onLine ? range.from <= span.from && span.from < range.to : span.from <= offset && offset < span.to;
      if (!hit || span.to - span.from !== 3) continue;
      const box = span.from + 1;
      return { from: box, to: box + 1, insert: span.kind.checked ? ' ' : 'x', selection: caret(box + 1) };
    }
  }
  return null;
}

/**
 * Bold, italic, code and the like: wraps the selection in `marker`, or unwraps it when it
 * already is. With nothing selected, inserts the pair with the cursor between.
 */
export function toggleWrap(marker: string, text: string, selection: { from: number; to: number }): TextEdit {
  const m = marker.length;
  const s = selection.from;
  const e = selection.to;
  const has = (at: number) => at >= 0 && at + m <= text.length && text.slice(at, at + m) === marker;
  if (has(s - m) && has(e)) {
    // Markers just outside the selection.
    return { from: s - m, to: e + m, insert: text.slice(s, e), selection: { from: s - m, to: e - m } };
  }
  if (e - s >= 2 * m && has(s) && has(e - m)) {
    // Markers at the ends of the selection.
    const inner = text.slice(s + m, e - m);
    return { from: s, to: e, insert: inner, selection: { from: s, to: s + inner.length } };
  }
  return { from: s, to: e, insert: marker + text.slice(s, e) + marker, selection: { from: s + m, to: e + m } };
}

// ── Wiki-link completion ─────────────────────────────────────────────────────

/** One suggestion while a wiki link is typed. */
export interface LinkCompletion {
  /** What the list shows: the page's title, or a heading. */
  title: string;
  /** What replaces the typed text: the shortest target that reaches the page, or the heading as a link writes it. */
  target: string;
  /** A second line, such as the page's folder. */
  detail?: string | null;
}

/**
 * A wiki link being typed: the text after `[[`, up to the cursor, or after its `#` once the page
 * is named. `page` is null while the page is typed; once a `#` follows it, the page's target as
 * written ("" for `[[#`, this page), and `query` is the heading typed so far.
 */
export interface LinkCompletionContext {
  from: number;
  to: number;
  query: string;
  page: string | null;
}

/**
 * The wiki link being typed at `cursor`, if any: an unclosed `[[` earlier on the line, with no
 * `]`, `[` or `|` between it and the cursor. After a `#` it's the heading being typed; after
 * `#^`, a block reference, there's nothing to complete. Not inside code.
 */
export function linkCompletionContext(text: string, cursor: number, syntax: PageSyntax): LinkCompletionContext | null {
  if (cursor > text.length || isInCode(cursor, syntax)) return null;
  const line = lineContent(text, cursor);
  const before = text.slice(line.from, cursor);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  const typed = before.slice(open + 2);
  if (/[[\]|\n]/.test(typed)) return null;
  const hash = typed.indexOf('#');
  if (hash < 0) return { from: cursor - typed.length, to: cursor, query: typed, page: null };
  const heading = typed.slice(hash + 1);
  if (heading.startsWith('^')) return null;
  return { from: cursor - heading.length, to: cursor, query: heading, page: typed.slice(0, hash).replace(/^[ \t]+|[ \t]+$/g, '') };
}

/** Accepting a suggestion: the typed page or heading becomes its target, the link closed with `]]` unless it already was. The cursor goes after the link. */
export function acceptCompletion(completion: LinkCompletion, context: LinkCompletionContext, text: string): TextEdit {
  const closed = text.slice(context.to, context.to + 2) === ']]';
  const insert = completion.target + (closed ? '' : ']]');
  return { from: context.from, to: context.to, insert, selection: caret(context.from + insert.length + (closed ? 2 : 0)) };
}
