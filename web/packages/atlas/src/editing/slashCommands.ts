import type { PageSyntax } from '../syntax/pageSyntax';
import { isInCode, isInVerbatimBlock, lineContent, type TextEdit } from './markdownEditing';

/**
 * A command in the `/` menu, from AtlasKit's `SlashCommand`. Typing `/` at the start of a line or
 * after a space opens it; the text typed after the `/` narrows it, and choosing a command
 * replaces the `/` and that text. Every command edits Markdown: what's saved is still exactly
 * what a person could have typed.
 */
export interface SlashCommand {
  id: string;
  title: string;
  /** Other words that find it, such as `h1` or `todo`. */
  keywords: string[];
  action: SlashAction;
}

export type SlashAction =
  /**
   * Makes the line a heading, list item, task or quote, keeping its text: the line's existing
   * heading, list, task or quote marker is replaced.
   */
  | { type: 'linePrefix'; prefix: string }
  /**
   * Inserts `text` where the `/` was, with the cursor `cursor` UTF-16 units into it (at its end
   * when null). A block goes on a line of its own, after a blank line if the line before has
   * text, so a `---` can't turn the paragraph above into a heading.
   */
  | { type: 'insert'; text: string; cursor: number | null; block: boolean };

const prefix = (p: string): SlashAction => ({ type: 'linePrefix', prefix: p });
export const insertAction = (text: string, cursor: number | null = null, block = false): SlashAction => ({ type: 'insert', text, cursor, block });

const two = (n: number) => String(n).padStart(2, '0');

/** The commands every editor has. `date` fills the date and time commands, in local time. */
export function builtInSlashCommands(date: Date = new Date()): SlashCommand[] {
  const table = '| Column | Column |\n| --- | --- |\n|  |  |';
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  return [
    { id: 'h1', title: 'Heading 1', keywords: ['h1', 'title'], action: prefix('# ') },
    { id: 'h2', title: 'Heading 2', keywords: ['h2', 'subtitle'], action: prefix('## ') },
    { id: 'h3', title: 'Heading 3', keywords: ['h3'], action: prefix('### ') },
    { id: 'bullet', title: 'Bulleted list', keywords: ['ul', 'unordered'], action: prefix('- ') },
    { id: 'number', title: 'Numbered list', keywords: ['ol', 'ordered'], action: prefix('1. ') },
    { id: 'task', title: 'Task', keywords: ['todo', 'checkbox', 'checklist'], action: prefix('- [ ] ') },
    { id: 'quote', title: 'Quote', keywords: ['blockquote'], action: prefix('> ') },
    { id: 'callout', title: 'Callout', keywords: ['note', 'admonition', 'info'], action: insertAction('> [!note]\n> ', null, true) },
    { id: 'code', title: 'Code block', keywords: ['fence', 'snippet'], action: insertAction('```\n\n```', 3, true) },
    { id: 'math', title: 'Math block', keywords: ['latex', 'equation', 'formula'], action: insertAction('$$\n\n$$', 3, true) },
    { id: 'table', title: 'Table', keywords: ['grid'], action: insertAction(table, table.length - 5, true) },
    { id: 'divider', title: 'Divider', keywords: ['hr', 'rule', 'line', 'separator'], action: insertAction('---', null, true) },
    { id: 'link', title: 'Link to page', keywords: ['wiki', 'page'], action: insertAction('[[') },
    { id: 'date', title: "Today's date", keywords: ['today', 'now'], action: insertAction(day) },
    { id: 'time', title: 'Current time', keywords: ['now', 'clock'], action: insertAction(time) },
  ];
}

/** The `/` being typed: its range, `/` included, and the text after it. */
export interface SlashContext {
  from: number;
  to: number;
  query: string;
}

/**
 * The `/` command being typed at `cursor`, if any: a `/` at the start of the line or after
 * whitespace, followed by up to 30 characters with no whitespace or `/`. Not in code, math or
 * frontmatter, so paths and dates (`and/or`, `1/2`) don't open the menu.
 */
export function slashContext(text: string, cursor: number, syntax: PageSyntax): SlashContext | null {
  if (cursor > text.length || isInCode(cursor, syntax) || isInVerbatimBlock(cursor, syntax)) return null;
  const line = lineContent(text, cursor);
  const before = text.slice(line.from, cursor);
  const slash = before.lastIndexOf('/');
  if (slash < 0) return null;
  const query = before.slice(slash + 1);
  if ([...query].length > 30 || /\s/u.test(query)) return null;
  if (slash > 0 && !/\s/u.test(before[slash - 1])) return null;
  return { from: cursor - query.length - 1, to: cursor, query };
}

/**
 * The commands `query` finds: those whose title or a keyword starts with it, or whose title has
 * a word starting with it, ignoring case. Titles that start with it come first; otherwise the
 * given order is kept. All of them for an empty query.
 */
export function matchingSlashCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (q === '') return [...commands];
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const found = commands.filter(
    (c) => c.title.toLowerCase().startsWith(q) || words(c.title).some((w) => w.startsWith(q)) || c.keywords.some((k) => k.toLowerCase().startsWith(q)),
  );
  return [...found.filter((c) => c.title.toLowerCase().startsWith(q)), ...found.filter((c) => !c.title.toLowerCase().startsWith(q))];
}

/** The indentation and heading, quote, list or task marker at the start of a line. */
function blockMarker(line: string): { indent: string; marker: string } {
  const m = /^([ \t]*)(#{1,6} |> ?|[-*+] \[[ xX]\] |[-*+] |\d{1,9}[.)] )?/.exec(line)!;
  return { indent: m[1], marker: m[2] ?? '' };
}

const isBlank = (s: string) => s.trim() === '';

/** Choosing `command`: the `/` and its query are removed and the command applied. */
export function applySlashCommand(command: SlashCommand, context: SlashContext, text: string): TextEdit {
  const line = lineContent(text, context.from);
  const lineText = text.slice(line.from, line.to);
  const slashAt = context.from - line.from;
  // The line's text with the `/` command taken out.
  const head = lineText.slice(0, slashAt);
  const tail = lineText.slice(slashAt + (context.to - context.from));

  const action = command.action;
  if (action.type === 'linePrefix') {
    const { indent, marker } = blockMarker(head);
    let body = head.slice(indent.length + marker.length);
    const cursorInBody = body.length;
    body += tail;
    if (tail === '') body = body.replace(/[ \t]+$/, '');
    const cursor = line.from + indent.length + action.prefix.length + Math.min(cursorInBody, body.length);
    return { from: line.from, to: line.to, insert: indent + action.prefix + body, selection: { from: cursor, to: cursor } };
  }

  let before = '';
  let after = '';
  if (action.block) {
    if (!isBlank(head)) {
      before = '\n\n';
    } else if (line.from > 0) {
      const previous = lineContent(text, line.from - 1);
      if (!isBlank(text.slice(previous.from, previous.to))) before = '\n';
    }
    if (!isBlank(tail)) after = '\n\n';
  }
  // A block on an otherwise empty line replaces the line's whitespace too.
  const from = action.block && isBlank(head) ? line.from : context.from;
  const at = from + before.length + (action.cursor ?? action.text.length);
  return { from, to: context.to, insert: before + action.text + after, selection: { from: at, to: at } };
}
