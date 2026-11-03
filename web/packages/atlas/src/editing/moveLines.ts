import type { PageSyntax } from '../syntax/pageSyntax';
import { listLine, type TextEdit } from './markdownEditing';

/** A page's lines, split at `\n`, with their UTF-16 offsets. */
class PageLines {
  /** Where each line starts. */
  private readonly starts = [0];

  constructor(private readonly text: string) {
    for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 0x0a) this.starts.push(k + 1);
  }

  get count(): number {
    return this.starts.length;
  }
  line(n: number): string {
    return this.text.slice(this.start(n), this.end(n));
  }
  start(n: number): number {
    return this.starts[n];
  }
  /** The end of the line, before its `\n`. */
  end(n: number): number {
    return n + 1 < this.starts.length ? this.starts[n + 1] - 1 : this.text.length;
  }
  /** The line holding `offset`; a `\n` belongs to the line it ends. */
  index(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  textOf(r: Lines): string {
    return this.text.slice(this.start(r.lo), this.end(r.hi));
  }
}

interface Lines {
  lo: number;
  hi: number;
}

const isBlank = (line: string) => /^[ \t]*$/.test(line);
const indentOf = (line: string) => /^ */.exec(line)![0].length;
const overlaps = (a: Lines, b: Lines) => a.lo <= b.hi && b.lo <= a.hi;

/**
 * ⌥⌘↑ and ⌥⌘↓: swaps the selected lines with the block above or below them. The lines moved, and
 * the lines they move past, grow to whole blocks so nothing is split: a list item takes its
 * nested items with it and passes a sibling with all of its own, and code and math blocks move
 * and are passed whole. Indentation is kept. Null at the top or bottom of the page, and next to
 * the frontmatter, which stays first. AtlasKit's `moveLines`.
 */
export function moveLines(direction: 'up' | 'down', text: string, selection: { from: number; to: number }, syntax: PageSyntax): TextEdit | null {
  const page = new PageLines(text);
  const last = selection.from === selection.to ? selection.from : Math.max(selection.from, selection.to - 1);
  const verbatim: Lines[] = [];
  let frontmatter: Lines | null = null;
  for (const block of syntax.blocks) {
    for (const span of block.spans) {
      const t = span.kind.type;
      if (t !== 'codeBlock' && t !== 'mathBlock' && t !== 'frontmatter') continue;
      const lines = { lo: page.index(span.from), hi: page.index(Math.max(span.from, span.to - 1)) };
      verbatim.push(lines);
      if (t === 'frontmatter') frontmatter = lines;
    }
  }
  /** `lines` grown to cover every code, math or frontmatter block it touches. */
  const whole = (lines: Lines): Lines => {
    let r = lines;
    for (;;) {
      const b = verbatim.find((v) => overlaps(v, r) && (v.lo < r.lo || v.hi > r.hi));
      if (!b) return r;
      r = { lo: Math.min(r.lo, b.lo), hi: Math.max(r.hi, b.hi) };
    }
  };
  const intersectsFrontmatter = (r: Lines) => frontmatter !== null && overlaps(frontmatter, r);
  /** `lines` with the nested lines after them, when they start with a list item. */
  const withChildren = (lines: Lines): Lines => {
    if (!listLine(page.line(lines.lo))) return lines;
    let indent = Infinity;
    for (let n = lines.lo; n <= lines.hi; n++) if (!isBlank(page.line(n))) indent = Math.min(indent, indentOf(page.line(n)));
    if (indent === Infinity) indent = 0;
    let end = lines.hi;
    while (end + 1 < page.count && !isBlank(page.line(end + 1)) && indentOf(page.line(end + 1)) > indent) end++;
    return whole({ lo: lines.lo, hi: end });
  };

  const moved = withChildren(whole({ lo: page.index(selection.from), hi: page.index(last) }));
  if (intersectsFrontmatter(moved)) return null;

  let passed: Lines;
  if (direction === 'up') {
    if (moved.lo === 0) return null;
    let start = moved.lo - 1;
    // Moving a list item past the nested lines of the sibling above passes the sibling too.
    if (listLine(page.line(moved.lo))) {
      const indent = indentOf(page.line(moved.lo));
      while (start > 0 && !isBlank(page.line(start)) && indentOf(page.line(start)) > indent && !isBlank(page.line(start - 1))) start--;
    }
    passed = whole({ lo: start, hi: moved.lo - 1 });
  } else {
    if (moved.hi + 1 >= page.count) return null;
    passed = withChildren(whole({ lo: moved.hi + 1, hi: moved.hi + 1 }));
  }
  if (intersectsFrontmatter(passed)) return null;

  const movedText = page.textOf(moved);
  const passedText = page.textOf(passed);
  const top = Math.min(moved.lo, passed.lo);
  const bottom = Math.max(moved.hi, passed.hi);
  const shift = (passedText.length + 1) * (direction === 'up' ? -1 : 1);
  return {
    from: page.start(top),
    to: page.end(bottom),
    insert: direction === 'up' ? movedText + '\n' + passedText : passedText + '\n' + movedText,
    selection: { from: selection.from + shift, to: selection.to + shift },
  };
}
