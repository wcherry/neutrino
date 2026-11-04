import type { PageSyntax } from '../syntax/pageSyntax';
import { listLine, type TextEdit } from './markdownEditing';
import { PageLines } from './moveLines';

const isBlank = (line: string) => /^[ \t]*$/.test(line);
const indentOf = (line: string) => /^ */.exec(line)![0].length;

/** A block a drag handle moves: UTF-16 offsets from the start of its first line to the end of its last. */
export interface DragBlock {
  from: number;
  to: number;
}

/**
 * The blocks a drag handle moves, in order, AtlasKit's `dragBlocks`: each top-level block (a
 * paragraph, heading, quote, callout, table, code or math block), and each top-level item of a
 * list, with its nested items. Not the frontmatter, which stays first.
 */
export function dragBlocks(text: string, syntax: PageSyntax): DragBlock[] {
  const page = new PageLines(text);
  const out: DragBlock[] = [];
  /** The last line of `start..<end` that isn't blank. */
  const trimmed = (start: number, end: number) => {
    let last = end - 1;
    while (last > start && isBlank(page.line(last))) last--;
    return last;
  };
  for (const block of syntax.blocks) {
    if (block.node.type === 'yaml' || block.node.type === 'footnoteDefinition') continue;
    const first = page.index(block.from);
    const last = page.index(Math.max(block.from, block.to - 1));
    if (block.node.type !== 'list') {
      out.push({ from: page.start(first), to: page.end(last) });
      continue;
    }
    // A list: each item at the list's own indent starts a block.
    const indent = indentOf(page.line(first));
    let start = first;
    for (let line = first + 1; line <= last; line++) {
      const content = page.line(line);
      if (listLine(content) && indentOf(content) <= indent) {
        out.push({ from: page.start(start), to: page.end(trimmed(start, line)) });
        start = line;
      }
    }
    out.push({ from: page.start(start), to: page.end(last) });
  }
  return out;
}

/**
 * Moves the drag block `block` to just before the block starting at `target`, or to the end of
 * the page when `target` is null, AtlasKit's `moveBlock`. Blank lines follow it so that nothing
 * runs together: a paragraph keeps a blank line on each side, list items moved among list items
 * keep none. The cursor goes to the start of the block where it lands. Null when it would stay
 * where it is.
 */
export function moveBlock(block: DragBlock, target: number | null, text: string): TextEdit | null {
  const lines = text.split('\n');
  const page = new PageLines(text);
  const a = page.index(block.from);
  const b = page.index(Math.max(block.from, block.to - 1));
  const t = target === null ? lines.length : page.index(target);
  if (!(t < a || t > b + 1)) return null; // onto itself, or where it already is
  if (target !== null && target !== page.start(t)) return null;

  const moving = lines.slice(a, b + 1);
  const isItem = listLine(moving[0]) !== null;
  const blank = (i: number) => i < 0 || i >= lines.length || isBlank(lines[i]);
  const item = (i: number) => i >= 0 && i < lines.length && listLine(lines[i]) !== null;

  // Take it out, with one blank line that separated it, so none doubles up: when it stood apart,
  // the one after it (or, last on the page, the one before).
  let removeFrom = a;
  let removeTo = b;
  if (blank(a - 1) && b + 1 < lines.length && blank(b + 1)) removeTo = b + 1;
  else if (a > 0 && blank(a - 1) && b + 1 >= lines.length) removeFrom = a - 1;
  lines.splice(removeFrom, removeTo - removeFrom + 1);
  let at = t > removeTo ? t - (removeTo - removeFrom + 1) : t;
  // To the end: before the blank lines the page ends with (its final newline).
  const trailing: string[] = [];
  if (target === null) {
    while (lines.length > 1 && isBlank(lines[lines.length - 1])) trailing.unshift(lines.pop()!);
    at = lines.length;
  }

  // Put it in, with the blank lines it needs on each side.
  const before = at > 0 && !blank(at - 1) && !(isItem && item(at - 1));
  const after = at < lines.length && !blank(at) && !(isItem && item(at));
  const inserted = [...(before ? [''] : []), ...moving, ...(after ? [''] : [])];
  lines.splice(at, 0, ...inserted);
  lines.push(...trailing);

  const result = lines.join('\n');
  const landed = at + (before ? 1 : 0);
  const cursor = lines.slice(0, landed).reduce((n, l) => n + l.length + 1, 0);
  return editBetween(text, result, { from: cursor, to: cursor });
}

const isTrail = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The edit that turns `old` into `next`, covering only what differs between them, so the view keeps its place. */
export function editBetween(old: string, next: string, selection: { from: number; to: number }): TextEdit | null {
  if (old === next) return null;
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && old.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < next.length - prefix && old.charCodeAt(old.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix++;
  // Not inside a surrogate pair.
  const splits = (s: string, i: number) => i > 0 && i < s.length && isTrail(s.charCodeAt(i));
  while (splits(old, prefix) || splits(next, prefix)) prefix--;
  while (suffix > 0 && (splits(old, old.length - suffix) || splits(next, next.length - suffix))) suffix--;
  return { from: prefix, to: old.length - suffix, insert: next.slice(prefix, next.length - suffix), selection };
}
